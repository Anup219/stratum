function checkAdminAccess() {
  const role = sessionStorage.getItem('stratum_user_role');
  if (role !== 'admin') {
    window.location.href = '/login';
  }
}
checkAdminAccess();

function getInitials(name) {
  if (!name) return 'A';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0][0].toUpperCase();
}

// Live listener to verify auth state and admin status
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    sessionStorage.removeItem('stratum_user_email');
    sessionStorage.removeItem('stratum_user_role');
    window.location.href = '/login';
    return;
  }
  const snap = await rtdb.ref('stratum-db/admin_emails').once('value');
  const admins = (snap.val() || ['anupchowdhury219@gmail.com']).filter(e => e !== 'admin@stratum.com');
  if (!admins.includes(user.email)) {
    sessionStorage.removeItem('stratum_user_email');
    sessionStorage.removeItem('stratum_user_role');
    window.location.href = '/login';
  } else {
    sessionStorage.setItem('stratum_user_email', user.email);
    sessionStorage.setItem('stratum_user_role', 'admin');
    
    // Reveal admin panel now that auth is verified
    const adminView = document.getElementById('view-admin');
    if (adminView) adminView.classList.add('auth-verified');
    
    // Fetch profile details for admin name & initials avatar
    rtdb.ref(`stratum-db/users/${user.uid}`).once('value', userSnap => {
      const profile = userSnap.val() || {};
      const name = profile.name || user.email;
      const nameBadge = document.getElementById('adminNameBadge');
      const avatarEl = document.getElementById('adminAvatar');
      if (nameBadge) nameBadge.textContent = name;
      if (avatarEl) avatarEl.textContent = getInitials(name);
    });
  }
});

/* ============================================================
   DATABASE INITIALIZATION & PERSISTENCE
   ============================================================ */
const DEFAULT_SPOOL_COLORS = [
  { id: 'white',  name: 'Jade White',     hex: '#F4F4F5', isDark: false, active: true },
  { id: 'black',  name: 'Charcoal Black', hex: '#18181B', isDark: true,  active: true },
  { id: 'orange', name: 'Bambu Orange',   hex: '#F97316', isDark: false, active: true },
  { id: 'blue',   name: 'Cobalt Blue',    hex: '#2563EB', isDark: true,  active: true },
  { id: 'red',    name: 'Crimson Red',    hex: '#DC2626', isDark: true,  active: true },
  { id: 'green',  name: 'Forest Green',   hex: '#16A34A', isDark: true,  active: true },
  { id: 'yellow', name: 'Bambu Yellow',   hex: '#EAB308', isDark: false, active: true },
  { id: 'gray',   name: 'Cool Gray',      hex: '#9CA3AF', isDark: false, active: true },
  { id: 'purple', name: 'Purple Iris',    hex: '#9333EA', isDark: true,  active: true },
  { id: 'teal',   name: 'Cyan Blue',      hex: '#06B6D4', isDark: false, active: true }
];

const DEFAULT_DB = {
  machineRate: 0,
  p1sHourlyRate: 0,
  baseFee: 0,
  wasteFactor: 1.10,
  failureRatePct: 8,
  marginPct: 0,
  minimumOrderFee: 20,
  supportTierMidPct: 15,
  supportTierSurchargeMid: 0,
  supportTierSurchargeHigh: 0,
  shapeFactor: 0.32,
  multiColorEnabled: true,
  multiColorFee: 5,
  tier1MinQty: 5,
  tier1Discount: 10,
  tier2MinQty: 10,
  tier2Discount: 15,
  plate: { x: 256, y: 256, z: 256 }, // Bambu Lab P1S build plate
  spoolColors: DEFAULT_SPOOL_COLORS,
  materials: [
    { id:'pla',   name:'PLA',          pricePerGram:1.50, density:1.24, swatch:'#E7E4DC', active:true },
    { id:'petg',  name:'PETG',         pricePerGram:1.80, density:1.27, swatch:'#BFE3E0', active:true },
    { id:'abs',   name:'ABS',          pricePerGram:1.60, density:1.04, swatch:'#D8D9DB', active:true },
    { id:'resin', name:'Resin (SLA)',  pricePerGram:4.50, density:1.10, swatch:'#C9B8F2', active:true },
    { id:'nylon', name:'Nylon (SLS)',  pricePerGram:8.00, density:1.15, swatch:'#F2D9B8', active:false },
  ],
  qualities: [
    { id:'draft',    name:'Draft',    layer:'0.30mm', speed:18 },
    { id:'standard', name:'Standard', layer:'0.20mm', speed:10 },
    { id:'fine',     name:'Fine',     layer:'0.12mm', speed:5 },
  ],
  orders: [],
};

let db = JSON.parse(JSON.stringify(DEFAULT_DB)); // deep copy, never mutate DEFAULT_DB

/** Deep-merge config from source into DEFAULT_DB, preserving nested object defaults */
function mergeConfig(source) {
  const merged = { ...DEFAULT_DB, ...source };
  if (source.plate) merged.plate = { ...DEFAULT_DB.plate, ...source.plate };
  return merged;
}

async function loadDB() {
  try {
    const cached = localStorage.getItem('stratum_config');
    if (cached) {
      const parsed = JSON.parse(cached);
      db = mergeConfig(parsed);
    }
  } catch (e) {}

  try {
    const snap = await Promise.race([
      rtdb.ref('stratum-db').once('value'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase DB load timeout')), 5000))
    ]);
    const val = snap.val();
    if (val && val.config) {
      db = mergeConfig(val.config);
      db.orders = val.orders ? Object.values(val.orders) : [];
      db.orders.sort((a, b) => b.id.localeCompare(a.id));
      try { localStorage.setItem('stratum_config', JSON.stringify(db)); } catch(e) {}
    } else {
      db = JSON.parse(JSON.stringify(DEFAULT_DB));
      try { await saveDB(); } catch(e) {}
    }
  } catch (e) {
    console.error("Firebase loadDB error (using defaults):", e);
    if (!localStorage.getItem('stratum_config')) {
      db = JSON.parse(JSON.stringify(DEFAULT_DB));
    }
  }

  // Realtime updates listener for config
  rtdb.ref('stratum-db/config').on('value', snap => {
    const val = snap.val();
    if (val) {
      db = { ...db, ...val };
      try { localStorage.setItem('stratum_config', JSON.stringify(db)); } catch(e) {}
      const activePage = document.querySelector('.side-nav-btn.active');
      if (activePage && activePage.dataset.page === 'pricing') {
        renderPricingTables();
      }
    }
  });

  // Realtime updates listener for orders
  rtdb.ref('stratum-db/orders').on('value', snap => {
    const ordersVal = snap.val();
    db.orders = ordersVal ? Object.values(ordersVal) : [];
    db.orders.sort((a, b) => b.id.localeCompare(a.id));
    
    const activePage = document.querySelector('.side-nav-btn.active');
    if (activePage && activePage.dataset.page === 'orders') {
      renderOrdersTable();
    }
  });

  // Realtime updates listener for admin emails
  rtdb.ref('stratum-db/admin_emails').on('value', snap => {
    const val = snap.val();
    let list = Array.isArray(val) && val.length > 0 ? val : ['anupchowdhury219@gmail.com'];
    adminEmails = list.filter(e => e !== 'admin@stratum.com');
    renderAdminEmailsList();
  });

  showAdminPage('orders');
}

async function saveDB() {
  try {
    localStorage.setItem('stratum_config', JSON.stringify(db));
  } catch(e) {}
  await rtdb.ref('stratum-db/config').update({
    machineRate: db.machineRate ?? 0,
    p1sHourlyRate: db.p1sHourlyRate ?? 0,
    baseFee: db.baseFee ?? 0,
    wasteFactor: db.wasteFactor || 1.10,
    failureRatePct: db.failureRatePct ?? 8,
    marginPct: db.marginPct ?? 0,
    minimumOrderFee: db.minimumOrderFee ?? 20,
    supportTierMidPct: db.supportTierMidPct || 15,
    supportTierSurchargeMid: db.supportTierSurchargeMid ?? 0,
    supportTierSurchargeHigh: db.supportTierSurchargeHigh ?? 0,
    shapeFactor: db.shapeFactor,
    multiColorEnabled: db.multiColorEnabled !== false,
    multiColorFee: db.multiColorFee || 5,
    tier1MinQty: db.tier1MinQty,
    tier1Discount: db.tier1Discount,
    tier2MinQty: db.tier2MinQty,
    tier2Discount: db.tier2Discount,
    plate: db.plate,
    spoolColors: db.spoolColors || DEFAULT_SPOOL_COLORS,
    materials: db.materials,
    qualities: db.qualities
  });
}

loadDB();

const STATUS_LABEL = { queued:'Queued', printing:'Printing', post:'Post-processing', ready:'Ready', shipped:'Shipped' };
const STATUS_CLASS = { queued:'s-queued', printing:'s-printing', post:'s-post', ready:'s-ready', shipped:'s-shipped' };

/* ============================================================
   DRAWER NAVIGATION (MOBILE & TABLET)
   ============================================================ */
function toggleAdminDrawer() {
  const sidebar = document.getElementById('adminSidebar');
  const backdrop = document.getElementById('adminDrawerBackdrop');
  if (!sidebar) return;
  const isOpen = sidebar.classList.contains('drawer-open');
  if (isOpen) {
    closeAdminDrawer();
  } else {
    sidebar.classList.add('drawer-open');
    if (backdrop) backdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeAdminDrawer() {
  const sidebar = document.getElementById('adminSidebar');
  const backdrop = document.getElementById('adminDrawerBackdrop');
  if (sidebar) sidebar.classList.remove('drawer-open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAdminDrawer();
});

/* ============================================================
   PAGE ROUTING & TRANSITIONS
   ============================================================ */
function showAdminPage(page){
  closeAdminDrawer();
  document.querySelectorAll('.side-nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  ['orders','pricing','admins'].forEach(p=>{
    const el = document.getElementById('page-'+p);
    if(el) el.hidden = p !== page;
  });
  
  const titles = {
    orders: ['Orders', 'Every job currently in the system'],
    pricing: ['Pricing & Billing Rules', 'Configure costs, setups, materials, and discounts'],
    admins: ['User Access Control', 'Manage administrative privileges for staff']
  };

  document.getElementById('adminTitle').textContent = titles[page][0];
  document.getElementById('adminSub').textContent = titles[page][1];
  document.getElementById('orderSearchWrap').style.display = page==='orders' ? 'flex' : 'none';
  
  if(page==='orders') renderOrdersTable();
  if(page==='pricing') renderPricingTables();
  if(page==='admins') renderAdminEmailsList();
}

function transitionToPage(page) {
  const bars = document.querySelectorAll('.transition-bar');
  const tl = gsap.timeline({
    onComplete: () => {
      showAdminPage(page);
      gsap.to(bars, {
        scaleX: 0,
        transformOrigin: "right",
        duration: 0.4,
        stagger: 0.08,
        ease: "power2.inOut"
      });
    }
  });
  
  tl.to(bars, {
    scaleX: 1,
    transformOrigin: "left",
    duration: 0.45,
    stagger: 0.08,
    ease: "power2.inOut"
  });
}

async function logoutAdmin() {
  try {
    await auth.signOut();
    sessionStorage.removeItem('stratum_user_email');
    sessionStorage.removeItem('stratum_user_role');
    localStorage.removeItem('stratum_pending_quote');
    localStorage.removeItem('stratum_pending_config');
    window.location.href = '/login';
  } catch (e) {
    console.error("Sign out failed:", e);
  }
}

/* ============================================================
   ORDERS LOG BOARD
   ============================================================ */
function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}

function renderOrdersTable(){
  renderStatusFilters();
  const q = (document.getElementById('orderSearch').value || '').toLowerCase();
  const rows = db.orders.filter(o=>{
    const matchesStatus = activeStatusFilter==='all' || o.status===activeStatusFilter;
    const matchesSearch = !q || o.id.toLowerCase().includes(q) || o.customer.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const tbody = document.getElementById('ordersBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-secondary); text-align: center; padding: 32px 0;">No orders found.</td></tr>';
    return;
  }

  // Build rows with DOM methods to prevent XSS
  tbody.innerHTML = '';
  rows.forEach(o => {
    const tr = document.createElement('tr');

    // Order ID
    const tdId = document.createElement('td');
    tdId.className = 'cell-mono';
    tdId.textContent = o.id;
    tr.appendChild(tdId);

    // Customer Name Column
    const tdCust = document.createElement('td');
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'cust-toggle-link';
    a.style.cssText = 'color:var(--accent-color); font-weight:600; text-decoration:none; display:inline-flex; align-items:center; cursor:pointer; gap:4px;';
    a.innerHTML = `${_esc(o.customerName || o.customer)} <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transition:transform 0.2s ease; opacity:0.8;"><path d="M6 9l6 6 6-6"/></svg>`;
    a.addEventListener('click', e => {
      e.preventDefault();
      toggleCustomerDetailsRow(o.id, a);
    });
    tdCust.appendChild(a);
    tr.appendChild(tdCust);

    // Material
    const tdMat = document.createElement('td');
    tdMat.textContent = o.material;
    tr.appendChild(tdMat);

    // Model File Column
    const tdModel = document.createElement('td');
    if (o.modelData) {
      const aFile = document.createElement('a');
      aFile.href = '#';
      aFile.style.cssText = 'color:var(--accent-color); font-weight:600; text-decoration:none; display:inline-flex; align-items:center; cursor:pointer;';
      aFile.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> ${_esc(o.modelName || 'Download')}`;
      aFile.addEventListener('click', e => {
        e.preventDefault();
        downloadBase64File(o.modelData, o.modelName || 'model.stl');
      });
      tdModel.appendChild(aFile);
    } else {
      const span = document.createElement('span');
      span.textContent = 'None (Default Torus)';
      span.style.cssText = 'color:var(--text-muted); font-size:11px;';
      tdModel.appendChild(span);
    }
    tr.appendChild(tdModel);

    const cellsAfter = [
      { cls: 'cell-mono', val: o.qty },
      { cls: 'cell-mono', val: '\u20B9' + Number(o.total).toFixed(2) },
    ];
    cellsAfter.forEach(({ cls, val }) => {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      td.textContent = val;
      tr.appendChild(td);
    });

    const tdStatus = document.createElement('td');
    const sel = document.createElement('select');
    sel.className = 'status-select';
    sel.addEventListener('change', () => updateOrderStatus(o.id, sel.value));
    Object.keys(STATUS_LABEL).forEach(statusKey => {
      const opt = document.createElement('option');
      opt.value = statusKey;
      opt.textContent = STATUS_LABEL[statusKey];
      opt.selected = o.status === statusKey;
      sel.appendChild(opt);
    });
    tdStatus.appendChild(sel);
    tr.appendChild(tdStatus);

    const tdDate = document.createElement('td');
    tdDate.className = 'cell-mono';
    tdDate.textContent = o.date;
    tr.appendChild(tdDate);

    // Detail dropdown row
    const trDetail = document.createElement('tr');
    trDetail.id = 'detail-row-' + o.id;
    trDetail.style.display = 'none';
    
    const tdDetail = document.createElement('td');
    tdDetail.colSpan = 8;
    tdDetail.style.cssText = 'background:var(--bg-surface-elevated); padding:16px 24px; border-bottom:1px solid var(--border-color);';
    
    tdDetail.innerHTML = `
      <div class="expanded-details-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap:16px; font-size:13px; line-height:1.5; color:var(--text-primary);">
        <div><strong>Email:</strong> <span style="font-family:var(--font-mono); word-break:break-all;">${_esc(o.customer)}</span></div>
        <div><strong>Phone:</strong> <span>${_esc(o.phone || 'N/A')}</span></div>
        <div><strong>Department:</strong> <span>${_esc(o.dept || 'N/A')}</span></div>
        <div style="grid-column: 1 / -1; margin-top: 4px;"><strong>Address:</strong> <span style="white-space:pre-line; display:block; margin-top:4px; padding:8px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:4px;">${_esc(o.address || 'N/A')}</span></div>
      </div>
    `;
    trDetail.appendChild(tdDetail);

    tbody.appendChild(tr);
    tbody.appendChild(trDetail);
  });
}

function toggleCustomerDetailsRow(orderId, anchor) {
  const row = document.getElementById('detail-row-' + orderId);
  if (!row) return;
  const chevron = anchor.querySelector('.chevron-icon');
  
  const isHidden = row.style.display === 'none';
  if (isHidden) {
    row.style.display = 'table-row';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    gsap.fromTo(row.querySelector('.expanded-details-grid'), { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" });
  } else {
    row.style.display = 'none';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    await rtdb.ref(`stratum-db/orders/${orderId}/status`).set(newStatus);
    showToast(`Order ${orderId} updated to ${STATUS_LABEL[newStatus]}`);
  } catch (e) {
    console.error(e);
    showToast("Failed to update status.");
  }
}

function renderStatusFilters(){
  const opts = ['all','queued','printing','post','ready','shipped'];
  document.getElementById('statusFilters').innerHTML = opts.map(s=>`
    <button class="filter-chip ${activeStatusFilter===s?'active':''}" onclick="setStatusFilter('${s}')">
      ${s==='all' ? 'All' : STATUS_LABEL[s]}
    </button>`).join('');
}
function setStatusFilter(s){ activeStatusFilter = s; renderStatusFilters(); renderOrdersTable(); }
let activeStatusFilter = 'all';
let _searchDebounce;
document.getElementById('orderSearch').addEventListener('input', () => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(renderOrdersTable, 200);
});

/* ============================================================
   PRICING & BILLING FACTOR CONTROLS
   ============================================================ */
function renderPricingTables(){
  document.getElementById('baseFeeInput').value = db.baseFee ?? 0;
  if(document.getElementById('p1sHourlyRateInput')) {
    document.getElementById('p1sHourlyRateInput').value = db.p1sHourlyRate ?? db.machineRate ?? 0;
  }
  if(document.getElementById('wasteFactorInput')) {
    document.getElementById('wasteFactorInput').value = db.wasteFactor ?? 1.10;
  }
  if(document.getElementById('failureRatePctInput')) {
    document.getElementById('failureRatePctInput').value = db.failureRatePct ?? 8;
  }
  if(document.getElementById('marginPctInput')) {
    document.getElementById('marginPctInput').value = db.marginPct ?? 0;
  }
  if(document.getElementById('minimumOrderFeeInput')) {
    document.getElementById('minimumOrderFeeInput').value = db.minimumOrderFee ?? 20;
  }
  if(document.getElementById('supportTierMidInput')) {
    document.getElementById('supportTierMidInput').value = db.supportTierSurchargeMid ?? 0;
  }
  if(document.getElementById('supportTierHighInput')) {
    document.getElementById('supportTierHighInput').value = db.supportTierSurchargeHigh ?? 0;
  }
  
  // Multi-color surcharge controls
  const isMultiOn = db.multiColorEnabled !== false;
  const multiFee = db.multiColorFee ?? 5;
  const multiToggle = document.getElementById('multiColorToggle');
  const multiStatus = document.getElementById('multiColorStatusText');
  const multiFeeInput = document.getElementById('multiColorFeeInput');
  if (multiToggle) multiToggle.classList.toggle('on', isMultiOn);
  if (multiStatus) {
    multiStatus.textContent = isMultiOn ? `Enabled (+₹${multiFee})` : 'Disabled (Single Color Only)';
    multiStatus.style.color = isMultiOn ? 'var(--signal)' : 'var(--text-muted)';
  }
  if (multiFeeInput) multiFeeInput.value = multiFee;

  document.getElementById('tier1MinQtyInput').value = db.tier1MinQty ?? 5;
  document.getElementById('tier1DiscountInput').value = db.tier1Discount ?? 10;
  document.getElementById('tier2MinQtyInput').value = db.tier2MinQty ?? 10;
  document.getElementById('tier2DiscountInput').value = db.tier2Discount ?? 15;

  document.getElementById('materialsBody').innerHTML = db.materials.map((m,i)=>`
    <tr>
      <td><input class="swatch-input" type="color" value="${m.swatch}" onchange="updateMaterial(${i},'swatch',this.value)"></td>
      <td><input class="admin-input" style="max-width:140px" type="text" value="${m.name}" onchange="updateMaterial(${i},'name',this.value)"></td>
      <td><input class="admin-input" type="number" step="0.01" value="${m.pricePerGram}" onchange="updateMaterial(${i},'pricePerGram',parseFloat(this.value)||0)"></td>
      <td><input class="admin-input" type="number" step="0.01" value="${m.density}" onchange="updateMaterial(${i},'density',parseFloat(this.value)||0)"></td>
      <td><button class="toggle ${m.active?'on':''}" onclick="toggleMaterial(${i})"><span class="knob"></span></button></td>
      <td><div class="row-actions"><button class="icon-btn-dark" onclick="removeMaterial(${i})" title="Remove">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>
      </button></div></td>
    </tr>`).join('');

  const colorsBody = document.getElementById('spoolColorsBody');
  if (colorsBody) {
    const colors = Array.isArray(db.spoolColors) ? db.spoolColors : DEFAULT_SPOOL_COLORS;
    if (colors.length === 0) {
      colorsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px; font-size:12px;">No spool colors configured yet. Click <strong>+ Add spool color</strong> below to add colors online.</td></tr>`;
    } else {
      colorsBody.innerHTML = colors.map((c, i) => `
        <tr>
          <td><input class="swatch-input" type="color" value="${c.hex}" onchange="updateSpoolColor(${i},'hex',this.value)"></td>
          <td><input class="admin-input" style="max-width:180px" type="text" value="${c.name}" onchange="updateSpoolColor(${i},'name',this.value)"></td>
          <td><input class="admin-input" style="max-width:110px; font-family:var(--font-mono); font-size:12px;" type="text" value="${c.hex}" onchange="updateSpoolColor(${i},'hex',this.value)"></td>
          <td><button class="toggle ${c.active !== false ? 'on' : ''}" onclick="toggleSpoolColor(${i})"><span class="knob"></span></button></td>
          <td><div class="row-actions"><button class="icon-btn-dark" onclick="removeSpoolColor(${i})" title="Remove">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>
          </button></div></td>
        </tr>`).join('');
    }
  }

  document.getElementById('qualityBody').innerHTML = db.qualities.map((q,i)=>`
    <tr>
      <td><strong>${q.name}</strong> <span style="color:var(--text-secondary); font-family:var(--font-mono); font-size:11px;">(${q.layer})</span></td>
      <td><input class="admin-input" type="number" value="${q.speed}" onchange="updateQuality(${i},'speed',parseFloat(this.value)||1)"></td>
      <td><span style="font-family:var(--font-mono); font-size:12px; color:var(--text-muted);">${q.layer} Preset</span></td>
    </tr>`).join('');
    
  renderAdminEmailsList();
}

function toggleMultiColorSurcharge() {
  db.multiColorEnabled = db.multiColorEnabled === false ? true : false;
  const toggleBtn = document.getElementById('multiColorToggle');
  const statusText = document.getElementById('multiColorStatusText');
  const fee = db.multiColorFee ?? 5;
  if (toggleBtn) toggleBtn.classList.toggle('on', db.multiColorEnabled);
  if (statusText) {
    statusText.textContent = db.multiColorEnabled ? `Enabled (+₹${fee})` : 'Disabled (Single Color Only)';
    statusText.style.color = db.multiColorEnabled ? 'var(--signal)' : 'var(--text-muted)';
  }
  saveDB();
}

function saveBillingControls() {
  db.baseFee = parseFloat(document.getElementById('baseFeeInput').value) || 0;
  const p1sRate = parseFloat(document.getElementById('p1sHourlyRateInput')?.value) || 0;
  db.p1sHourlyRate = p1sRate;
  db.machineRate = p1sRate;
  db.wasteFactor = parseFloat(document.getElementById('wasteFactorInput')?.value) || 1.10;
  db.failureRatePct = parseFloat(document.getElementById('failureRatePctInput')?.value) || 8;
  db.marginPct = parseFloat(document.getElementById('marginPctInput')?.value) || 0;
  db.minimumOrderFee = parseFloat(document.getElementById('minimumOrderFeeInput')?.value) || 20;
  db.supportTierSurchargeMid = parseFloat(document.getElementById('supportTierMidInput')?.value) || 0;
  db.supportTierSurchargeHigh = parseFloat(document.getElementById('supportTierHighInput')?.value) || 0;

  db.multiColorFee = parseFloat(document.getElementById('multiColorFeeInput')?.value) || 5;
  const isMultiOn = db.multiColorEnabled !== false;
  const statusText = document.getElementById('multiColorStatusText');
  if (statusText) {
    statusText.textContent = isMultiOn ? `Enabled (+₹${db.multiColorFee})` : 'Disabled (Single Color Only)';
  }

  db.tier1MinQty = parseInt(document.getElementById('tier1MinQtyInput').value) || 0;
  db.tier1Discount = parseFloat(document.getElementById('tier1DiscountInput').value) || 0;
  db.tier2MinQty = parseInt(document.getElementById('tier2MinQtyInput').value) || 0;
  db.tier2Discount = parseFloat(document.getElementById('tier2DiscountInput').value) || 0;

  saveDB();
  
  const flag = document.getElementById('billingRulesSaved');
  if (flag) {
    flag.classList.add('show');
    setTimeout(()=>flag.classList.remove('show'), 1500);
  }
}

function updateMaterial(i, field, value){ db.materials[i][field] = value; saveDB(); }
function toggleMaterial(i){ db.materials[i].active = !db.materials[i].active; saveDB(); renderPricingTables(); }
function removeMaterial(i){ if(db.materials.length<=1) return; db.materials.splice(i,1); saveDB(); renderPricingTables(); }
function addMaterial(){
  db.materials.push({ id:'mat'+Date.now(), name:'New Material', pricePerGram:5.50, density:1.2, swatch:'#CBCEC8', active:true, desc:'Custom print material.' });
  saveDB();
  renderPricingTables();
}
function updateQuality(i, field, value){ db.qualities[i][field] = value; saveDB(); }

function isHexDark(hex) {
  if (!hex) return false;
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return (r * 0.299 + g * 0.587 + b * 0.114) < 140;
}

function updateSpoolColor(i, field, value) {
  if (!db.spoolColors || !db.spoolColors[i]) return;
  db.spoolColors[i][field] = value;
  if (field === 'hex') {
    db.spoolColors[i].isDark = isHexDark(value);
    renderPricingTables();
  }
  saveDB();
}

function toggleSpoolColor(i) {
  if (!db.spoolColors || !db.spoolColors[i]) return;
  db.spoolColors[i].active = db.spoolColors[i].active === false ? true : false;
  saveDB();
  renderPricingTables();
}

function removeSpoolColor(i) {
  if (!Array.isArray(db.spoolColors)) return;
  db.spoolColors.splice(i, 1);
  saveDB();
  renderPricingTables();
  showToast("Spool color removed.");
}

function addSpoolColor() {
  if (!Array.isArray(db.spoolColors)) {
    db.spoolColors = [];
  }
  const newId = 'color_' + Date.now();
  db.spoolColors.push({
    id: newId,
    name: 'New Spool Color',
    hex: '#3B82F6',
    isDark: true,
    active: true
  });
  saveDB();
  renderPricingTables();
  showToast("New spool color added.");
}

/* ============================================================
   TOAST HELPER
   ============================================================ */
function showToast(msg){
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(()=>t.classList.remove('show'), 3000);
}

/* ============================================================
   USER ACCESS CONTROL - EMAIL PROMOTION
   ============================================================ */
let adminEmails = ['anupchowdhury219@gmail.com'];

function getAdminEmails() {
  return adminEmails;
}

async function grantAdminAccess() {
  const emailInput = document.getElementById('newAdminEmail');
  const email = (emailInput.value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    showToast("Please enter a valid email address.");
    return;
  }
  const admins = [...getAdminEmails()];
  if (admins.includes(email)) {
    showToast("This email already has administrator access.");
    return;
  }
  admins.push(email);
  try {
    await rtdb.ref('stratum-db/admin_emails').set(admins);
    emailInput.value = '';
    showToast(`Administrative access granted to ${email}.`);
  } catch (e) {
    console.error(e);
    showToast("Failed to grant admin access.");
  }
}

async function revokeAdminAccess(email) {
  const currentEmail = sessionStorage.getItem('stratum_user_email');
  if (email === currentEmail) {
    showToast("Cannot revoke your own administrative access.");
    return;
  }
  let admins = [...getAdminEmails()];
  admins = admins.filter(a => a !== email);
  try {
    await rtdb.ref('stratum-db/admin_emails').set(admins);
    showToast(`Administrative access revoked for ${email}.`);
  } catch (e) {
    console.error(e);
    showToast("Failed to revoke admin access.");
  }
}

function renderAdminEmailsList() {
  const list = document.getElementById('adminEmailsList');
  if (!list) return;
  const admins = getAdminEmails();
  list.innerHTML = '';
  admins.forEach(email => {
    const li = document.createElement('li');
    li.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:var(--bg-surface-elevated);padding:8px 12px;border-radius:4px;border:1px solid var(--border-color);color:var(--text-primary);';
    const span = document.createElement('span');
    span.textContent = email;
    li.appendChild(span);
    const currentEmail = sessionStorage.getItem('stratum_user_email');
    if (email !== currentEmail) {
      const btn = document.createElement('button');
      btn.textContent = 'Revoke';
      btn.style.cssText = 'background:none;border:none;color:#d32f2f;cursor:pointer;font-size:11px;font-weight:600;';
      btn.addEventListener('click', () => revokeAdminAccess(email));
      li.appendChild(btn);
    } else {
      const badge = document.createElement('span');
      badge.textContent = 'You';
      badge.style.cssText = 'font-size:11px;color:var(--text-muted);';
      li.appendChild(badge);
    }
    list.appendChild(li);
  });
}

function downloadBase64File(base64, fileName) {
  try {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Base64 download failed:", e);
    showToast("Failed to decode and download model file.");
  }
}

function showUserInfoModal(name, email, phone, dept, address) {
  document.getElementById('modalCustomerName').textContent = name;
  document.getElementById('modalCustomerEmail').textContent = email;
  document.getElementById('modalCustomerPhone').textContent = phone;
  document.getElementById('modalCustomerDept').textContent = dept;
  document.getElementById('modalCustomerAddress').textContent = address;
  
  const modal = document.getElementById('userInfoModal');
  modal.style.display = 'flex';
  gsap.fromTo(modal, { scale: 0.95, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "power2.out" });
}

function closeUserInfoModal() {
  const modal = document.getElementById('userInfoModal');
  if (!modal) return;
  gsap.to(modal, {
    scale: 0.95,
    opacity: 0,
    duration: 0.2,
    ease: "power2.in",
    onComplete: () => {
      modal.style.display = 'none';
    }
  });
}

// Init admin
showAdminPage('orders');
