/* ============================================================
   LOCALSTORAGE BACKED DATABASE
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
  machineRate: 0, // ₹ per hour (₹0 for college lab)
  p1sHourlyRate: 0,
  baseFee: 0,      // ₹ flat setup fee (₹0 for college lab)
  wasteFactor: 1.10, // 1.05 - 1.15
  failureRatePct: 8, // %
  marginPct: 0,     // % (0% cost recovery)
  minimumOrderFee: 20, // ₹ nominal floor price
  supportTierMidPct: 15,
  supportTierSurchargeMid: 0,
  supportTierSurchargeHigh: 0,
  shapeFactor: 0.32,
  multiColorEnabled: true, // Toggle for multi-color surcharge
  multiColorFee: 5,        // ₹5 per multi-color print
  tier1MinQty: 5,
  tier1Discount: 10,  // %
  tier2MinQty: 10,
  tier2Discount: 15,  // %
  plate: { x: 256, y: 256, z: 256 }, // Bambu Lab P1S build limits
  spoolColors: DEFAULT_SPOOL_COLORS,
  materials: [
    { id:'pla',   name:'PLA',          pricePerGram:1.50, density:1.24, swatch:'#E7E4DC', active:true,  desc:'General purpose PLA filament. Excellent detail, low warping.' },
    { id:'petg',  name:'PETG',         pricePerGram:1.80, density:1.27, swatch:'#BFE3E0', active:true,  desc:'High toughness and water resistance. Ideal for functional parts.' },
    { id:'abs',   name:'ABS',          pricePerGram:1.60, density:1.04, swatch:'#D8D9DB', active:true,  desc:'Acrylonitrile Butadiene Styrene. High durability, impact resistant.' },
    { id:'resin', name:'Resin (SLA)',  pricePerGram:4.50, density:1.10, swatch:'#C9B8F2', active:true,  desc:'Standard UV photopolymer resin. Microscopic detail, ultra-smooth.' },
    { id:'nylon', name:'Nylon (SLS)',  pricePerGram:8.00, density:1.15, swatch:'#F2D9B8', active:false, desc:'SLS Nylon powder. Superior strength, no supports needed.' },
  ],
  qualities: [
    { id:'draft',    name:'Draft',    layer:'0.30mm', speed:18 },
    { id:'standard', name:'Standard', layer:'0.20mm', speed:10 },
    { id:'fine',     name:'Fine',     layer:'0.12mm', speed:5 },
  ],
  orders: [],
};

let db = JSON.parse(JSON.stringify(DEFAULT_DB)); // deep copy — never mutate DEFAULT_DB

/** Deep-merge config from source into DEFAULT_DB, preserving nested object defaults */
function mergeConfig(source) {
  const merged = { ...DEFAULT_DB, ...source };
  // Deep-merge nested objects so partial overrides don't lose default keys
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
    // Add a 5-second timeout in case Firebase is unconfigured or offline
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

  // Realtime updates listener for lab configuration
  rtdb.ref('stratum-db/config').on('value', snap => {
    const val = snap.val();
    if (val) {
      db = { ...db, ...val };
      try { localStorage.setItem('stratum_config', JSON.stringify(db)); } catch(e) {}
      renderColorSystem();
      recalc();
    }
  });

  // Cross-tab sync for config changes
  window.addEventListener('storage', e => {
    if (e.key === 'stratum_config' && e.newValue) {
      try {
        const updated = JSON.parse(e.newValue);
        db = { ...db, ...updated };
        renderColorSystem();
        recalc();
      } catch(err) {}
    }
  });
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

/* calculator state */
const state = {
  dims: { x: 80, y: 60, z: 40 },
  originalDims: { x: 80, y: 60, z: 40 },
  aspectLocked: true,
  materialId: 'pla',
  qualityId: 'standard',
  infill: 20,
  qty: 1,
  sliceResult: null,
  sliceError: null,
  fileHash: null,
  rawFileBuffer: null,
  diagnostics: [],
  triangleCount: 0,
  colorMode: 'single', // 'single' | 'ams'
  selectedAmsBayId: 1, // focused bay in AMS drawer
  singleColor: { id: 'white', name: 'Jade White', hex: '#F4F4F5' },
  amsSlots: [
    { id: 1, label: 'A1', name: 'Jade White', swatch: '#F4F4F5', active: true, isBase: true },
    { id: 2, label: 'A2', name: 'Bambu Orange', swatch: '#F97316', active: false, isBase: false },
    { id: 3, label: 'A3', name: 'Charcoal Black', swatch: '#18181B', active: false, isBase: false },
    { id: 4, label: 'A4', name: 'Cobalt Blue', swatch: '#2563EB', active: false, isBase: false }
  ]
};

function getAvailableSpoolColors() {
  if (Array.isArray(db.spoolColors)) {
    return db.spoolColors.filter(c => c.active !== false);
  }
  return DEFAULT_SPOOL_COLORS;
}

const BAMBU_PALETTE = DEFAULT_SPOOL_COLORS;

/* ============================================================
   THREE.JS 3D MODEL VIEWPORT SYSTEM
   ============================================================ */
let scene, camera, renderer, controls;
let currentMesh = null;
let defaultMesh = null;
let currentGeometry = null;
let _animFrameId = null; // track animation loop for cleanup
let currentUploadedFile = null;

let viewerSettings = {
  grid: true,
  axes: true,
  wireframe: false,
  unit: 'mm'
};
let gridHelper = null;
let axesGroup = null;

function createTextSprite(text, bgColor = '#22c55e') {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgColor;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(8, 8, 48, 48, 8);
    ctx.fill();
  } else {
    ctx.fillRect(8, 8, 48, 48);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 33);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(14, 14, 1);
  return sprite;
}

function init3DViewer() {
  const container = document.getElementById('canvas3dContainer');
  if (!container) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff); // Clean white background like 3Ding

  camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 1, 1000);
  camera.position.set(130, 110, 160);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // Cannot rotate below print bed
  controls.minDistance = 30;
  controls.maxDistance = 500;
  controls.target.set(0, 20, 0);

  // Studio Lighting (Clean, balanced)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight1.position.set(120, 200, 140);
  dirLight1.castShadow = true;
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0x94a3b8, 0.35);
  dirLight2.position.set(-120, 100, -120);
  scene.add(dirLight2);

  // 3Ding-style Build Plate Grid (Crisp light-gray grid at y = 0)
  gridHelper = new THREE.GridHelper(256, 26, 0x94a3b8, 0xe2e8f0);
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  // 3Ding-style Coordinate Axes with labeled Green Y indicator
  axesGroup = new THREE.Group();
  
  // X Axis (Orange-Red: #f97316 on bed width)
  const xMat = new THREE.LineBasicMaterial({ color: 0xf97316, linewidth: 2 });
  const xGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(120, 0.2, 0)]);
  axesGroup.add(new THREE.Line(xGeom, xMat));

  // Y Axis (Blue: #0284c7 along bed depth)
  const yMat = new THREE.LineBasicMaterial({ color: 0x0284c7, linewidth: 2 });
  const yGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, 0.2, 120)]);
  axesGroup.add(new THREE.Line(yGeom, yMat));

  // Z Axis (Thin Light-Green: #4ade80 pointing straight up)
  const zMat = new THREE.LineBasicMaterial({ color: 0x4ade80, linewidth: 1.5 });
  const zGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, 110, 0)]);
  axesGroup.add(new THREE.Line(zGeom, zMat));

  // Green "Y" badge sprite positioned on bed at end of blue Y axis (just like 3Ding!)
  const yBadge = createTextSprite('Y', '#22c55e');
  yBadge.position.set(0, 0.6, 124);
  axesGroup.add(yBadge);

  scene.add(axesGroup);

  createDefaultModel();
  updateModelInViewer();
  updateViewerSpecsOverlay();

  // Clean animation loop - NO AUTO SPINNING!
  function animate() {
    _animFrameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    const activeContainer = document.getElementById('fullScreenModal').style.display === 'flex'
      ? document.getElementById('fullCanvasContainer')
      : document.getElementById('canvas3dContainer');
      
    if (activeContainer) {
      camera.aspect = activeContainer.clientWidth / activeContainer.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(activeContainer.clientWidth, activeContainer.clientHeight);
    }
  });
}

function normalizeGeometryToBed(geometry, isCADZUp = false) {
  if (!geometry) return;
  if (isCADZUp) {
    // Convert CAD vertical axis (Z-up) to Three.js vertical axis (Y-up) so model stands upright
    geometry.rotateX(-Math.PI / 2);
  }
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  const centerX = (bbox.min.x + bbox.max.x) / 2;
  const centerZ = (bbox.min.z + bbox.max.z) / 2;
  const minY = bbox.min.y;

  // Center horizontally on X & Z, and place bottom surface exactly at y = 0
  geometry.translate(-centerX, -minY, -centerZ);
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
}

function createDefaultModel() {
  if (defaultMesh) scene.remove(defaultMesh);
  // Standing calibration model resting flat on build plate at y = 0
  const geometry = new THREE.BoxGeometry(40, 40, 40);
  geometry.translate(0, 20, 0); // Bottom touches y = 0
  const material = new THREE.MeshStandardMaterial({
    color: 0x475569, // Clean slate gray
    roughness: 0.38,
    metalness: 0.14,
    flatShading: false
  });
  defaultMesh = new THREE.Mesh(geometry, material);
  scene.add(defaultMesh);
}

function fitCameraToMesh(mesh) {
  if (!mesh || !camera || !controls) return;
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  
  const maxDim = Math.max(size.x, size.y, size.z, 40);
  const fov = camera.fov * (Math.PI / 180);
  let dist = Math.abs(maxDim / 2 / Math.tan(fov / 2));
  
  dist *= 1.8;
  camera.position.set(dist * 0.9, dist * 0.7, dist);
  controls.target.set(0, size.y / 2, 0);
  camera.lookAt(controls.target);
  controls.update();
}

function fitMeshToDimensions(mesh, targetX, targetY, targetZ) {
  if (!mesh) return;
  
  const geom = mesh.geometry;
  geom.computeBoundingBox();
  const box = geom.boundingBox;
  const size = new THREE.Vector3();
  box.getSize(size);
  
  // Three.js coordinates: X = width, Y = height, Z = depth
  // Slicer coordinates: targetX = width, targetY = depth, targetZ = height
  const scaleX = size.x > 0 ? targetX / size.x : 1;
  const scaleY = size.y > 0 ? targetZ / size.y : 1; // targetZ is vertical height in state.dims!
  const scaleZ = size.z > 0 ? targetY / size.z : 1; // targetY is horizontal depth in state.dims!
  
  mesh.scale.set(scaleX, scaleY, scaleZ);
  mesh.position.set(0, 0, 0); // Bottom rests directly on the build plate grid at y = 0
  controls.target.set(0, targetZ / 2, 0);
}

function updateModelInViewer() {
  if (!scene) return;
  
  const mat = getMaterial();
  if (!mat) return;
  
  const activeColorHex = (state.colorMode === 'ams' && state.amsSlots && state.amsSlots[0])
    ? state.amsSlots[0].swatch
    : (state.singleColor ? state.singleColor.hex : (currentGeometry ? '#475569' : mat.swatch));

  if (currentGeometry) {
    if (defaultMesh) { scene.remove(defaultMesh); defaultMesh = null; }
    if (currentMesh && currentMesh.geometry !== currentGeometry) {
      scene.remove(currentMesh);
      currentMesh = null;
    }
    if (!currentMesh) {
      const material = new THREE.MeshStandardMaterial({
        color: activeColorHex,
        roughness: 0.38,
        metalness: 0.14,
        wireframe: viewerSettings.wireframe
      });
      currentMesh = new THREE.Mesh(currentGeometry, material);
      scene.add(currentMesh);
      fitCameraToMesh(currentMesh);
    }
  } else {
    if (currentMesh) { scene.remove(currentMesh); currentMesh = null; }
    if (!defaultMesh) {
      createDefaultModel();
    }
  }
  
  const activeObj = currentMesh || defaultMesh;
  if (activeObj) {
    fitMeshToDimensions(activeObj, state.dims.x, state.dims.y, state.dims.z);
    if (activeObj.material) {
      activeObj.material.color.set(activeColorHex);
      activeObj.material.wireframe = viewerSettings.wireframe;
    }
  }
  updateViewerSpecsOverlay();
}

function updateViewerSpecsOverlay() {
  const dimsEl = document.getElementById('vModelDims');
  const triEl = document.getElementById('vModelTriangles');
  const fullFilenameEl = document.getElementById('vFullModelFilename');
  const fullDimsEl = document.getElementById('vFullModelDims');
  const fullTriEl = document.getElementById('vFullModelTriangles');
  const fullVolEl = document.getElementById('vFullModelVolume');

  const filename = currentUploadedFile ? currentUploadedFile.name : 'Calibration Model';
  if (fullFilenameEl) fullFilenameEl.textContent = filename;

  const { x, y, z } = state.dims;
  const dimsText = viewerSettings.unit === 'inch'
    ? `${(x / 25.4).toFixed(2)} x ${(y / 25.4).toFixed(2)} x ${(z / 25.4).toFixed(2)} inch`
    : `${x.toFixed(2)} x ${y.toFixed(2)} x ${z.toFixed(2)} mm`;

  if (dimsEl) dimsEl.textContent = dimsText;
  if (fullDimsEl) fullDimsEl.textContent = dimsText;

  const triangles = state.triangleCount > 0 ? state.triangleCount : 12;
  const triText = `${triangles.toLocaleString()} triangles`;
  if (triEl) triEl.textContent = triText;
  if (fullTriEl) fullTriEl.textContent = triText;

  if (fullVolEl) {
    let volCm3 = 0;
    if (state.sliceResult && state.sliceResult.model_filament_weight_g) {
      volCm3 = state.sliceResult.model_filament_weight_g / 1.24;
    } else {
      volCm3 = (x * y * z * 0.35) / 1000;
    }
    fullVolEl.textContent = viewerSettings.unit === 'inch'
      ? `${(volCm3 * 0.0610237).toFixed(2)} in³`
      : `${volCm3.toFixed(2)} cm³`;
  }
}

function toggleViewerGrid() {
  viewerSettings.grid = !viewerSettings.grid;
  if (gridHelper) gridHelper.visible = viewerSettings.grid;
  document.querySelectorAll('#btnToggleGrid, .btn-toggle-grid').forEach(btn => {
    btn.classList.toggle('active', viewerSettings.grid);
  });
}

function toggleViewerAxes() {
  viewerSettings.axes = !viewerSettings.axes;
  if (axesGroup) axesGroup.visible = viewerSettings.axes;
  document.querySelectorAll('#btnToggleAxes, .btn-toggle-axes').forEach(btn => {
    btn.classList.toggle('active', viewerSettings.axes);
  });
}

function toggleViewerWireframe() {
  viewerSettings.wireframe = !viewerSettings.wireframe;
  const activeObj = currentMesh || defaultMesh;
  if (activeObj && activeObj.material) {
    activeObj.material.wireframe = viewerSettings.wireframe;
  }
  document.querySelectorAll('#btnToggleWireframe, .btn-toggle-wireframe').forEach(btn => {
    btn.classList.toggle('active', viewerSettings.wireframe);
  });
}

function setViewerUnit(unit) {
  viewerSettings.unit = unit;
  document.querySelectorAll('#btnUnitMm, .btn-unit-mm').forEach(btn => {
    btn.classList.toggle('active', unit === 'mm');
  });
  document.querySelectorAll('#btnUnitInch, .btn-unit-inch').forEach(btn => {
    btn.classList.toggle('active', unit === 'inch');
  });
  updateViewerSpecsOverlay();
}

function resetViewerCamera() {
  if (!camera || !controls) return;
  const targetHeight = state.dims.z || 40;
  
  gsap.to(camera.position, {
    x: 140,
    y: 110,
    z: 160,
    duration: 0.6,
    ease: "power2.out"
  });
  
  gsap.to(controls.target, {
    x: 0,
    y: targetHeight / 2,
    z: 0,
    duration: 0.6,
    ease: "power2.out",
    onUpdate: () => controls.update()
  });
}

/* ============================================================
   UI VIEWER EXPANSION
   ============================================================ */
function openFullViewer() {
  const modal = document.getElementById('fullScreenModal');
  const fullContainer = document.getElementById('fullCanvasContainer');
  const canvas = renderer ? renderer.domElement : null;
  if (!modal || !fullContainer || !canvas) return;
  
  modal.style.display = 'flex';
  
  // Smooth GSAP zoom entrance
  gsap.fromTo(modal, { scale: 0.95, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: "power2.out" });
  
  fullContainer.appendChild(canvas);
  
  camera.aspect = fullContainer.clientWidth / fullContainer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(fullContainer.clientWidth, fullContainer.clientHeight);
  
  const activeObj = currentMesh || defaultMesh;
  fitCameraToMesh(activeObj);
  updateViewerSpecsOverlay();
}

function closeFullViewer() {
  const modal = document.getElementById('fullScreenModal');
  const inlineContainer = document.getElementById('canvas3dContainer');
  const canvas = renderer ? renderer.domElement : null;
  if (!modal || !inlineContainer || !canvas) return;

  gsap.to(modal, {
    scale: 0.95,
    opacity: 0,
    duration: 0.25,
    ease: "power2.in",
    onComplete: () => {
      modal.style.display = 'none';
      inlineContainer.appendChild(canvas);
      camera.aspect = inlineContainer.clientWidth / inlineContainer.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(inlineContainer.clientWidth, inlineContainer.clientHeight);
      
      const activeObj = currentMesh || defaultMesh;
      fitCameraToMesh(activeObj);
    }
  });
}

function renderPlate(x, y, z, overLimit) {
  const zPct = Math.min(100, (z / db.plate.z) * 100);
  const zfill = document.getElementById('zfill');
  if (zfill) zfill.style.height = zPct + '%';
  const zlab = document.getElementById('zlab');
  if (zlab) zlab.textContent = z + 'mm';
  
  updateModelInViewer();
}

/* ============================================================
   CUSTOMER: CONFIG PRESETS RENDERING
   ============================================================ */
function renderMatChips(){
  const wrap = document.getElementById('matChips');
  const active = db.materials.filter(m=>m.active);
  document.getElementById('matCount').textContent = active.length + ' available';
  wrap.innerHTML = active.map(m => `
    <button class="mat-chip ${m.id===state.materialId?'active':''}" onclick="selectMaterial('${m.id}')" type="button">
      <span class="swatch" style="background:${m.swatch}"></span>
      <span class="info"><strong>${m.name}</strong><span>₹${m.pricePerGram.toFixed(2)}/g</span></span>
    </button>`).join('');
  if(!active.find(m=>m.id===state.materialId) && active[0]){ state.materialId = active[0].id; }
  renderColorSystem();
}

function selectMaterial(id){
  state.materialId = id;
  const mat = getMaterial();
  if (mat && state.amsSlots[0]) {
    state.amsSlots[0].swatch = mat.swatch;
    state.amsSlots[0].name = `${mat.name} Natural`;
  }
  // Disable infill control for SLA Resin (always 100% solid)
  const infillRange = document.getElementById('infillRange');
  const infillVal = document.getElementById('infillVal');
  const infillGroup = infillRange ? infillRange.closest('.config-field') : null;
  if (id === 'resin') {
    if (infillRange) { infillRange.disabled = true; infillRange.style.opacity = '0.4'; }
    if (infillVal) infillVal.textContent = '100% (Solid)';
    if (infillGroup) infillGroup.title = 'SLA Resin prints are always 100% solid';
  } else {
    if (infillRange) { infillRange.disabled = false; infillRange.style.opacity = '1'; }
    if (infillVal) infillVal.textContent = state.infill + '%';
    if (infillGroup) infillGroup.title = '';
  }
  renderMatChips();
  scheduleSlicing(150);
}

function setColorMode(mode) {
  const isMultiOn = db.multiColorEnabled !== false;
  if (mode === 'ams' && !isMultiOn) {
    showToast("Multi-color printing (Bambu AMS) is currently disabled by the lab.");
    return;
  }
  state.colorMode = mode;
  const btnSingle = document.getElementById('btnSingleColor');
  const btnAms = document.getElementById('btnAmsMultiColor');
  const panelSingle = document.getElementById('singleColorPanel');
  const panelAms = document.getElementById('amsMultiPanel');

  if (btnSingle && btnAms) {
    btnSingle.classList.toggle('active', mode === 'single');
    btnAms.classList.toggle('active', mode === 'ams');
  }
  if (panelSingle && panelAms) {
    panelSingle.style.display = mode === 'single' ? 'flex' : 'none';
    panelAms.style.display = mode === 'ams' ? 'flex' : 'none';
  }

  renderColorSystem();
  updateModelInViewer();
  recalc();
}

function renderColorSystem() {
  const isMultiOn = db.multiColorEnabled !== false;
  const fee = db.multiColorFee ?? 5;

  const btnSingle = document.getElementById('btnSingleColor');
  const btnAms = document.getElementById('btnAmsMultiColor');
  const panelSingle = document.getElementById('singleColorPanel');
  const panelAms = document.getElementById('amsMultiPanel');
  const surchargePill = document.getElementById('amsSurchargePill');

  // 1. Enforce Multi-Color Enabled/Disabled State
  if (!isMultiOn) {
    if (state.colorMode === 'ams') {
      state.colorMode = 'single';
      if (btnSingle) btnSingle.classList.add('active');
      if (panelSingle) panelSingle.style.display = 'flex';
      if (panelAms) panelAms.style.display = 'none';
    }
    if (btnAms) {
      btnAms.disabled = true;
      btnAms.classList.remove('active');
      btnAms.classList.add('disabled-by-lab');
      btnAms.title = 'Bambu AMS multi-color printing is currently disabled by the lab';
    }
    if (surchargePill) {
      surchargePill.textContent = 'Disabled';
    }
  } else {
    if (btnAms) {
      btnAms.disabled = false;
      btnAms.classList.remove('disabled-by-lab');
      btnAms.removeAttribute('title');
    }
    if (surchargePill) {
      surchargePill.textContent = fee > 0 ? `+₹${fee}` : 'Free';
    }
  }

  // 2. Single Color View
  const palette = getAvailableSpoolColors();
  if (state.singleColor && !palette.some(c => c.hex.toLowerCase() === state.singleColor.hex.toLowerCase())) {
    if (palette[0]) {
      state.singleColor = { id: palette[0].id, name: palette[0].name, hex: palette[0].hex };
      if (state.amsSlots[0]) {
        state.amsSlots[0].swatch = palette[0].hex;
        state.amsSlots[0].name = palette[0].name;
      }
    }
  }

  const bullet = document.getElementById('singleColorBullet');
  if (bullet && state.singleColor) {
    bullet.style.background = state.singleColor.hex;
  }
  const colorNameLabel = document.getElementById('selectedColorName');
  if (colorNameLabel && state.singleColor) {
    colorNameLabel.textContent = state.singleColor.name;
  }
  const singlePalette = document.getElementById('singlePaletteSwatches');
  if (singlePalette) {
    if (palette.length === 0) {
      singlePalette.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">No active spool colors configured</span>';
    } else {
      singlePalette.innerHTML = palette.map(c => `
        <div class="swatch-circle ${c.isDark ? 'dark-color' : ''} ${state.singleColor && state.singleColor.hex.toLowerCase() === c.hex.toLowerCase() ? 'active' : ''}"
             style="background:${c.hex};"
             title="${c.name} (${c.hex})"
             onclick="selectSingleColor('${c.id}')"></div>
      `).join('');
    }
  }

  // 3. AMS View
  const baysRack = document.getElementById('amsBaysRack');
  if (baysRack) {
    baysRack.innerHTML = state.amsSlots.map(s => {
      const isSelected = s.id === state.selectedAmsBayId;
      return `
        <div class="ams-bay-card ${s.active ? 'active' : 'inactive'} ${isSelected ? 'selected-for-color' : ''}"
             onclick="handleBayClick(${s.id})"
             title="${s.isBase ? 'Slot ' + s.label + ' (Base Filament - Always Active)' : 'Click to toggle or configure Slot ' + s.label}">
          <span class="bay-toggle-indicator"></span>
          <div class="ams-spool-visual" style="background:${s.swatch};">
            <div class="spool-core"></div>
          </div>
          <span class="bay-badge">${s.label}${s.isBase ? ' · Base' : ''}</span>
          <span class="bay-color-name">${s.name}</span>
        </div>
      `;
    }).join('');
  }

  // Active count status pill
  const activeCount = state.amsSlots.filter(s => s.active).length;
  const amsStatusPill = document.getElementById('amsStatusPill');
  if (amsStatusPill) {
    if (activeCount <= 1) {
      amsStatusPill.textContent = '1 / 4 Spool (Single)';
      amsStatusPill.style.color = 'var(--text-secondary)';
      amsStatusPill.style.background = 'var(--bg-deep)';
    } else {
      amsStatusPill.textContent = isMultiOn ? `${activeCount} Spools (+₹${fee})` : `${activeCount} Spools (Free)`;
      amsStatusPill.style.color = 'var(--signal-bright)';
      amsStatusPill.style.background = 'rgba(224, 90, 43, 0.12)';
    }
  }

  // Active Bay Drawer
  const activeBay = state.amsSlots.find(s => s.id === state.selectedAmsBayId) || state.amsSlots[0];
  const bayLabel = document.getElementById('activeBayLabel');
  const bayColorText = document.getElementById('activeBayColorName');
  if (bayLabel) bayLabel.textContent = `Slot ${activeBay.label}${activeBay.isBase ? ' (Base)' : ''}`;
  if (bayColorText) bayColorText.textContent = activeBay.name;

  const amsPalette = document.getElementById('amsPaletteSwatches');
  if (amsPalette) {
    if (palette.length === 0) {
      amsPalette.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">No active spool colors configured</span>';
    } else {
      amsPalette.innerHTML = palette.map(c => `
        <div class="swatch-circle ${c.isDark ? 'dark-color' : ''} ${activeBay.swatch.toLowerCase() === c.hex.toLowerCase() ? 'active' : ''}"
             style="background:${c.hex};"
             title="Assign ${c.name} to Slot ${activeBay.label}"
             onclick="selectAmsBayColor('${c.id}')"></div>
      `).join('');
    }
  }
}

function selectSingleColor(colorId) {
  const palette = getAvailableSpoolColors();
  const c = palette.find(p => p.id === colorId) || palette[0];
  if (!c) return;
  state.singleColor = { id: c.id, name: c.name, hex: c.hex };
  if (state.amsSlots[0]) {
    state.amsSlots[0].swatch = c.hex;
    state.amsSlots[0].name = c.name;
  }
  renderColorSystem();
  updateModelInViewer();
}

function handleBayClick(slotId) {
  const slot = state.amsSlots.find(s => s.id === slotId);
  if (!slot) return;
  state.selectedAmsBayId = slotId;

  if (!slot.isBase) {
    // Toggle active state for auxiliary slots
    slot.active = !slot.active;
  }

  renderColorSystem();
  recalc();
}

function selectAmsBayColor(colorId) {
  const palette = getAvailableSpoolColors();
  const c = palette.find(p => p.id === colorId) || palette[0];
  if (!c) return;
  const slot = state.amsSlots.find(s => s.id === state.selectedAmsBayId);
  if (!slot) return;

  slot.swatch = c.hex;
  slot.name = c.name;
  slot.active = true;

  if (slot.isBase) {
    state.singleColor = { id: c.id, name: c.name, hex: c.hex };
  }

  renderColorSystem();
  updateModelInViewer();
  recalc();
}

function renderQualSeg(){
  const wrap = document.getElementById('qualSeg');
  wrap.innerHTML = db.qualities.map(q => `
    <button class="${q.id===state.qualityId?'active':''}" onclick="selectQuality('${q.id}')" type="button">
      <strong>${q.name}</strong><span>${q.layer}</span>
    </button>`).join('');
}
function selectQuality(id){
  state.qualityId = id;
  renderQualSeg();
  scheduleSlicing(150);
}

function renderMaterialsStrip() {
  const grid = document.getElementById('matGrid');
  if(!grid) return;
  grid.innerHTML = db.materials.map(m=>`
    <div class="mat-card gsap-fade-up" style="opacity:${m.active?1:0.4}">
      <div class="top">
        <span class="swatch" style="background:${m.swatch}"></span>
        <span class="name">${m.name}</span>
      </div>
      <div class="price">₹${m.pricePerGram.toFixed(2)}<span> / gram</span></div>
      <div class="desc">${m.desc || ''}</div>
    </div>
  `).join('');
  enable3DTiltEffect('.mat-card', ['.name', '.price', '.desc', '.swatch']);
}

function enable3DTiltEffect(selector, popSelectors = []) {
  document.querySelectorAll(selector).forEach(card => {
    card.style.transformStyle = "preserve-3d";
    
    popSelectors.forEach(childSel => {
      card.querySelectorAll(childSel).forEach(child => {
        child.style.transform = "translateZ(0px)";
        child.style.transition = "transform 0.25s ease-out";
      });
    });

    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const xc = rect.width / 2;
      const yc = rect.height / 2;
      const angleX = -(y - yc) / 5;
      const angleY = (x - xc) / 5;
      
      gsap.to(card, {
        rotateX: angleX,
        rotateY: angleY,
        y: -10,
        scale: 1.02,
        duration: 0.2,
        ease: "power1.out",
        overwrite: "auto"
      });
      
      popSelectors.forEach(childSel => {
        card.querySelectorAll(childSel).forEach(child => {
          child.style.transform = "translateZ(25px)";
        });
      });
    });

    card.addEventListener('mouseleave', () => {
      gsap.to(card, {
        rotateX: 0,
        rotateY: 0,
        y: 0,
        scale: 1,
        duration: 0.45,
        ease: "power2.out",
        overwrite: "auto"
      });
      
      popSelectors.forEach(childSel => {
        card.querySelectorAll(childSel).forEach(child => {
          child.style.transform = "translateZ(0px)";
        });
      });
    });
  });
}

/* ============================================================
   FILE UPLOAD STL PARSING
   ============================================================ */
const dz = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
dz.addEventListener('click', ()=>fileInput.click());
['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e=>{ if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); });

function fmtSize(bytes){
  if(bytes < 1024) return bytes + ' B';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}

async function handleFile(file){
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'stl' && ext !== 'obj') {
    showToast("Only 3D design files (.stl, .obj) are allowed.");
    clearFile();
    return;
  }
  currentUploadedFile = file;
  document.getElementById('fname').textContent = file.name;
  document.getElementById('fsize').textContent = fmtSize(file.size);
  document.getElementById('fileChip').classList.add('show');

  let bbox = null;
  let triCount = 0;
  if(/\.stl$/i.test(file.name)){
    try{
      const buf = await file.arrayBuffer();
      state.rawFileBuffer = buf;
      state.fileHash = file.name + '_' + file.size + '_' + file.lastModified;
      const loader = new THREE.STLLoader();
      const geometry = loader.parse(buf);
      if (geometry) {
        normalizeGeometryToBed(geometry, true);
        currentGeometry = geometry;
        if (geometry.attributes && geometry.attributes.position) {
          triCount = Math.round(geometry.attributes.position.count / 3);
        }
        geometry.computeBoundingBox();
        const gb = geometry.boundingBox;
        bbox = {
          x: Math.max(1, Math.round((gb.max.x - gb.min.x) * 10) / 10),
          y: Math.max(1, Math.round((gb.max.z - gb.min.z) * 10) / 10),
          z: Math.max(1, Math.round((gb.max.y - gb.min.y) * 10) / 10)
        };
      }
      if (!triCount && buf.byteLength >= 84) {
        const dv = new DataView(buf);
        triCount = dv.getUint32(80, true);
      }
      if (!bbox) {
        bbox = parseSTLBoundingBox(buf);
      }
    }catch(e) {
      console.error(e);
      bbox = null;
    }
  } else if(/\.obj$/i.test(file.name)){
    try {
      const text = await file.text();
      state.rawFileBuffer = null;
      state.fileHash = file.name + '_' + file.size + '_' + file.lastModified;
      
      // Parse OBJ file vertices into BufferGeometry
      const vertices = [];
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('v ')) {
          const parts = line.split(/\s+/);
          if (parts.length >= 4) {
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
              vertices.push(x, y, z);
            }
          }
        }
      }
      if (vertices.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        normalizeGeometryToBed(geometry, false);
        currentGeometry = geometry;
        triCount = Math.round(vertices.length / 3);
        
        geometry.computeBoundingBox();
        const gb = geometry.boundingBox;
        bbox = {
          x: Math.max(1, Math.round((gb.max.x - gb.min.x) * 10) / 10),
          y: Math.max(1, Math.round((gb.max.z - gb.min.z) * 10) / 10),
          z: Math.max(1, Math.round((gb.max.y - gb.min.y) * 10) / 10)
        };
      } else {
        bbox = parseOBJBoundingBox(text);
      }
    } catch(e) {
      console.error(e);
      bbox = null;
    }
  }

  // Update Triangle Count & Viewer
  state.triangleCount = triCount;
  updateViewerSpecsOverlay();

  const badge = document.getElementById('detectBadge');
  const badgeText = document.getElementById('detectText');
  if(bbox){
    state.dims = { ...bbox };
    state.originalDims = { ...bbox };
    document.getElementById('dimX').value = bbox.x;
    document.getElementById('dimY').value = bbox.y;
    document.getElementById('dimZ').value = bbox.z;
    badge.classList.remove('manual');
    badgeText.textContent = 'Dimensions detected from model';
    badge.classList.add('show');
  } else {
    badge.classList.add('manual');
    badgeText.textContent = 'Could not auto-read size — enter dimensions manually';
    badge.classList.add('show');
  }
  updateModelInViewer();
  scheduleSlicing(0);
}

function parseOBJBoundingBox(text) {
  let minX=Infinity, minY=Infinity, minZ=Infinity;
  let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
  let found = false;
  
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          found = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
      }
    }
  }
  
  if (!found) return null;
  
  return {
    x: Math.max(1, Math.round((maxX - minX) * 10) / 10),
    y: Math.max(1, Math.round((maxY - minY) * 10) / 10),
    z: Math.max(1, Math.round((maxZ - minZ) * 10) / 10)
  };
}

function clearFile(){
  fileInput.value = '';
  document.getElementById('fileChip').classList.remove('show');
  document.getElementById('detectBadge').classList.remove('show');
  currentGeometry = null;
  currentUploadedFile = null;
  state.rawFileBuffer = null;
  state.fileHash = null;
  state.triangleCount = 0;
  state.dims = { x: 40, y: 40, z: 40 };
  state.originalDims = { x: 40, y: 40, z: 40 };
  document.getElementById('dimX').value = 40;
  document.getElementById('dimY').value = 40;
  document.getElementById('dimZ').value = 40;
  setSlicingError(null);
  renderDiagnostics([]);
  updateModelInViewer();
  resetViewerCamera();
  scheduleSlicing(0);
}

function parseSTLBoundingBox(buffer){
  if(buffer.byteLength < 84) return null;
  const dv = new DataView(buffer);
  const triCount = dv.getUint32(80, true);
  if(triCount === 0 || triCount > 2000000) return null;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  let offset = 84;
  for(let i=0;i<triCount;i++){
    offset += 12;
    for(let v=0; v<3; v++){
      const x = dv.getFloat32(offset, true); offset+=4;
      const y = dv.getFloat32(offset, true); offset+=4;
      const z = dv.getFloat32(offset, true); offset+=4;
      if(x<minX) minX=x; if(x>maxX) maxX=x;
      if(y<minY) minY=y; if(y>maxY) maxY=y;
      if(z<minZ) minZ=z; if(z>maxZ) maxZ=z;
    }
    offset += 2;
  }
  if(!isFinite(minX)) return null;
  return {
    x: Math.max(1, Math.round((maxX-minX)*10)/10),
    y: Math.max(1, Math.round((maxY-minY)*10)/10),
    z: Math.max(1, Math.round((maxZ-minZ)*10)/10),
  };
}

/* ============================================================
   ASPECT RATIO LOCK & NON-UNIFORM SCALING
   ============================================================ */
function updateAspectLockUI() {
  const btn = document.getElementById('aspectLockBtn');
  const label = document.getElementById('aspectLockLabel');
  const icon = document.getElementById('aspectLockIcon');
  const warn = document.getElementById('aspectRatioWarning');

  if (state.aspectLocked) {
    if (btn) {
      btn.classList.add('locked');
      btn.classList.remove('unlocked');
      btn.title = "Aspect ratio locked. Scaling maintains proportional geometry.";
    }
    if (label) label.textContent = "Proportional";
    if (icon) {
      icon.innerHTML = '<rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />';
    }
    if (warn) warn.style.display = 'none';
  } else {
    if (btn) {
      btn.classList.remove('locked');
      btn.classList.add('unlocked');
      btn.title = "Aspect ratio unlocked. Axes scale independently.";
    }
    if (label) label.textContent = "Independent";
    if (icon) {
      icon.innerHTML = '<rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />';
    }
    if (warn) warn.style.display = 'flex';
  }
}

const aspectLockBtn = document.getElementById('aspectLockBtn');
if (aspectLockBtn) {
  aspectLockBtn.addEventListener('click', () => {
    state.aspectLocked = !state.aspectLocked;
    updateAspectLockUI();
  });
}

/* ============================================================
   USER FORM EVENT WIRING (DEBOUNCED RE-SLICING)
   ============================================================ */
['dimX','dimY','dimZ'].forEach((id,i)=>{
  const key = ['x','y','z'][i];
  document.getElementById(id).addEventListener('input', e=>{
    const newVal = Math.max(1, parseFloat(e.target.value) || 1);
    state.dims[key] = newVal;

    if (state.aspectLocked && state.originalDims && state.originalDims[key] > 0) {
      const scale = newVal / state.originalDims[key];
      ['x','y','z'].forEach((otherKey, otherIdx) => {
        if (otherKey !== key) {
          const scaledVal = Math.max(1, Math.round(state.originalDims[otherKey] * scale * 10) / 10);
          state.dims[otherKey] = scaledVal;
          const otherInput = document.getElementById(['dimX','dimY','dimZ'][otherIdx]);
          if (otherInput) otherInput.value = scaledVal;
        }
      });
    }

    const overLimit = isOverBuildPlate(state.dims);
    renderPlate(state.dims.x, state.dims.y, state.dims.z, overLimit);
    scheduleSlicing(500);
  });
});

document.getElementById('infillRange').addEventListener('input', e=>{
  state.infill = parseInt(e.target.value);
  document.getElementById('infillVal').textContent = state.infill + '%';
  scheduleSlicing(400);
});

document.getElementById('qtyInput').addEventListener('input', e=>{
  state.qty = Math.max(1, parseInt(e.target.value) || 1);
  recalc();
});
function stepQty(delta){
  state.qty = Math.max(1, state.qty + delta);
  document.getElementById('qtyInput').value = state.qty;
  recalc();
}

/* ============================================================
   SLICING ENGINE (BAMBU LAB P1S) & MESH SANITY VALIDATOR
   ============================================================ */
let _sliceTimer = null;
const clientSliceCache = new Map();

function isOverBuildPlate(dims) {
  return dims.x > db.plate.x || dims.y > db.plate.y || dims.z > db.plate.z;
}

function showSlicingLoading(show) {
  state.slicingInProgress = show;
  const overlay = document.getElementById('slicingOverlay');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
}

function setSlicingError(msg) {
  state.sliceError = msg;
  const banner = document.getElementById('slicingErrorBanner');
  const text = document.getElementById('slicingErrorText');
  if (banner && text) {
    if (msg) {
      text.textContent = msg;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }
}

function scheduleSlicing(debounceMs = 500) {
  clearTimeout(_sliceTimer);
  showSlicingLoading(true);
  _sliceTimer = setTimeout(() => {
    executeSlicing();
  }, debounceMs);
}

/**
 * Validates STL Mesh Sanity (Manifold, Watertight, Degenerate Faces)
 */
function clientValidateSTL(buf, targetDims) {
  if (!buf || buf.byteLength < 84) {
    return { valid: false, error: "File buffer is too small to be a valid 3D model." };
  }
  const dv = new DataView(buf);
  const triCount = dv.getUint32(80, true);
  if (triCount < 4) {
    return { valid: false, error: "Model geometry contains fewer than 4 faces." };
  }

  let degenerateCount = 0;
  let minX=Infinity, minY=Infinity, minZ=Infinity;
  let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
  let surfaceArea = 0;
  let signedVolume = 0;
  const edgeCounts = new Map();

  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    offset += 12; // skip normal
    const v0 = [dv.getFloat32(offset, true), dv.getFloat32(offset+4, true), dv.getFloat32(offset+8, true)]; offset += 12;
    const v1 = [dv.getFloat32(offset, true), dv.getFloat32(offset+4, true), dv.getFloat32(offset+8, true)]; offset += 12;
    const v2 = [dv.getFloat32(offset, true), dv.getFloat32(offset+4, true), dv.getFloat32(offset+8, true)]; offset += 12;
    offset += 2; // attribute

    for (const v of [v0, v1, v2]) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }

    const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
    const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const area = 0.5 * Math.sqrt(cx*cx + cy*cy + cz*cz);

    if (area < 1e-7) degenerateCount++;
    else surfaceArea += area;

    signedVolume += (v0[0] * (v1[1]*v2[2] - v2[1]*v1[2]) +
                     v1[0] * (v2[1]*v0[2] - v0[1]*v2[2]) +
                     v2[0] * (v0[1]*v1[2] - v1[1]*v0[2])) / 6.0;

    const addEdge = (a, b) => {
      const ka = `${Math.round(a[0]*100)/100},${Math.round(a[1]*100)/100},${Math.round(a[2]*100)/100}`;
      const kb = `${Math.round(b[0]*100)/100},${Math.round(b[1]*100)/100},${Math.round(b[2]*100)/100}`;
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edgeCounts.set(k, (edgeCounts.get(k) || 0) + 1);
    };
    addEdge(v0, v1); addEdge(v1, v2); addEdge(v2, v0);
  }

  const checkDims = targetDims || {
    x: Math.round((maxX - minX)*10)/10,
    y: Math.round((maxY - minY)*10)/10,
    z: Math.round((maxZ - minZ)*10)/10
  };

  const diagnostics = [];

  // 1. Build volume check
  if (checkDims.x > db.plate.x || checkDims.y > db.plate.y || checkDims.z > db.plate.z) {
    diagnostics.push({
      id: 'out_of_bounds',
      severity: 'error',
      title: 'Model Exceeds Bambu P1S Build Volume',
      description: `Model size (${checkDims.x}×${checkDims.y}×${checkDims.z} mm) exceeds the 256×256×256 mm build chamber limits.`,
      slicingImpact: 'OrcaSlicer refuses toolpath generation because extruder motion coordinates exceed mechanical axis limits.',
      filamentSupportImpact: 'No supports or model perimeter can physically fit on the heated bed plate.',
      action: 'Scale down proportionally or split the part into interlocking segments in CAD.'
    });
    return {
      valid: false,
      error: `Model dimensions (${checkDims.x}×${checkDims.y}×${checkDims.z} mm) exceed Bambu P1S maximum build volume (${db.plate.x}×${db.plate.y}×${db.plate.z} mm).`,
      diagnostics
    };
  }

  // 2. Degenerate faces check
  const degenerateRatio = degenerateCount / triCount;
  if (degenerateCount > 0) {
    const isSevere = degenerateRatio > 0.05;
    diagnostics.push({
      id: 'degenerate_faces',
      severity: isSevere ? 'error' : 'warning',
      title: 'Degenerate (Zero-Area) Faces Detected',
      description: `Found ${degenerateCount} degenerate triangles (${(degenerateRatio * 100).toFixed(1)}% of total geometry) where vertices collapse into a single line or point.`,
      slicingImpact: 'Slicers calculate polygon surface normal vectors by taking the cross product of vertex edges; zero-area faces cause division-by-zero math errors and corrupted slicing outlines.',
      filamentSupportImpact: 'Can cause support generator to place random rogue support pillars inside closed walls.',
      action: 'Run "Mesh Clean" or remove duplicate vertices in Blender or CAD software.'
    });
    if (isSevere) {
      return {
        valid: false,
        error: `Mesh has ${degenerateCount} degenerate (zero-area) faces. Slicer cannot generate valid toolpaths.`,
        diagnostics
      };
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const c of edgeCounts.values()) {
    if (c === 1) openEdges++;
    else if (c > 2) nonManifoldEdges++;
  }

  // 3. Watertightness check
  if (openEdges > 0) {
    const isSevere = openEdges > Math.max(16, edgeCounts.size * 0.05);
    diagnostics.push({
      id: 'not_watertight',
      severity: isSevere ? 'error' : 'warning',
      title: isSevere ? 'Mesh is Not Watertight (Holes in Surface)' : 'Minor Surface Holes Detected',
      description: `Detected ${openEdges} open boundary edges where adjacent triangle faces do not meet.`,
      slicingImpact: 'The slicing engine cannot distinguish between the solid interior and empty space. Slicing through holes produces missing layers, missing perimeters, or inverted infill.',
      filamentSupportImpact: 'Tree supports fail to calculate anchor points on non-solid boundaries, leading to mid-air support failures.',
      action: 'Use "Close Holes" or "Make Solid" in Fusion 360, MeshMixer, or Bambu Studio.'
    });
    if (isSevere) {
      return {
        valid: false,
        error: `Mesh is not watertight: detected ${openEdges} open boundary edges. Slicing on Bambu P1S will produce printing errors.`,
        diagnostics
      };
    }
  }

  // 4. Non-manifold geometry
  if (nonManifoldEdges > 0) {
    const isSevere = nonManifoldEdges > Math.max(10, edgeCounts.size * 0.04);
    diagnostics.push({
      id: 'non_manifold',
      severity: isSevere ? 'error' : 'warning',
      title: 'Non-Manifold Geometry (Intersecting Faces)',
      description: `Detected ${nonManifoldEdges} edges connected to 3 or more faces (internal self-intersections or shared edges).`,
      slicingImpact: 'Forces the slicer to generate overlapping toolpaths in the same XYZ coordinates, causing nozzle drag, loud grinding, and possible layer shifts.',
      filamentSupportImpact: 'Internal shells confuse tree support branches, causing support plastic to be generated inside internal hollow cavities where it cannot be removed.',
      action: 'Combine bodies using Boolean "Union" in CAD so the mesh forms a single outer shell.'
    });
    if (isSevere) {
      return {
        valid: false,
        error: `Non-manifold geometry: detected ${nonManifoldEdges} non-manifold edges. Repair mesh before slicing.`,
        diagnostics
      };
    }
  }

  // 5. Tall & narrow bed adhesion check
  const heightRatio = checkDims.z / (Math.min(checkDims.x, checkDims.y) || 1);
  if (heightRatio > 3.5 && checkDims.z > 60) {
    diagnostics.push({
      id: 'unstable_bed',
      severity: 'warning',
      title: 'Bed Adhesion Warning (Tall & Narrow)',
      description: `Model height (${checkDims.z}mm) is ${heightRatio.toFixed(1)}× larger than its base width. Small bed contact area.`,
      slicingImpact: 'At high P1S CoreXY speeds (up to 500mm/s), rapid bed vibrations and nozzle drag can topple the part off the textured PEI sheet.',
      filamentSupportImpact: 'Requires a wide brim (5–10mm) or stabilizing support trunks around the base to prevent detachment.',
      action: 'Rotate the part so its widest flat surface lies flat on the build plate, or enable a Brim.'
    });
  }

  return {
    valid: true,
    volumeCm3: Math.abs(signedVolume) / 1000.0,
    surfaceAreaMm2: surfaceArea,
    diagnostics
  };
}

/**
 * Calibrated Bambu Lab P1S Slicing Engine
 */
function runClientBambuP1SEngine({ dims, meshStats, materialId, qualityId, infill }) {
  const native = state.originalDims || dims;
  const scaleX = native.x > 0 ? dims.x / native.x : 1;
  const scaleY = native.y > 0 ? dims.y / native.y : 1;
  const scaleZ = native.z > 0 ? dims.z / native.z : 1;
  const volScale = scaleX * scaleY * scaleZ;
  const areaScale = (scaleX * scaleY + scaleY * scaleZ + scaleZ * scaleX) / 3;

  const mat = getMaterial();
  const density = mat.density || 1.24;

  const combinedDiagnostics = [...(meshStats?.diagnostics || [])];

  // Handle SLA Resin exception (Spec Section 1: Resin exception)
  if (materialId === 'resin') {
    const solidVol = (meshStats?.volumeCm3 || (dims.x * dims.y * dims.z * 0.28 / 1000)) * volScale;
    const modelWeightG = solidVol * density;
    const supportWeightG = modelWeightG * 0.15; // 15% resin supports
    const layerH = qualityId === 'fine' ? 0.025 : 0.05;
    const layerCount = Math.ceil(dims.z / layerH);
    const printTimeSeconds = Math.round(300 + (layerCount * 7.5));

    return {
      engine: 'SLA Resin Engine (Approximate)',
      total_filament_weight_g: Math.round((modelWeightG + supportWeightG) * 10) / 10,
      model_filament_weight_g: Math.round(modelWeightG * 10) / 10,
      support_filament_weight_g: Math.round(supportWeightG * 10) / 10,
      estimated_print_time_seconds: printTimeSeconds,
      isSLA: true,
      isApproximate: true,
      diagnostics: combinedDiagnostics
    };
  }

  // Base physical solid volume
  const solidVolCm3 = (meshStats?.volumeCm3 || ((dims.x * dims.y * dims.z * 0.30) / 1000.0)) * volScale;
  const surfaceAreaMm2 = (meshStats?.surfaceAreaMm2 || (2 * (dims.x*dims.y + dims.y*dims.z + dims.z*dims.x))) * areaScale;

  // Bambu P1S layer presets (0.4mm nozzle)
  const layerHeights = { draft: 0.30, standard: 0.20, fine: 0.12 };
  const layerH = layerHeights[qualityId] || 0.20;
  const layerCount = Math.ceil(dims.z / layerH);

  // Shell volume vs Core infill
  const wallLoops = qualityId === 'fine' ? 3 : 2;
  const wallThickness = wallLoops * 0.42;
  const shellVolCm3 = Math.min(solidVolCm3 * 0.85, (surfaceAreaMm2 * wallThickness) / 1000.0);
  const coreVolCm3 = Math.max(0, solidVolCm3 - shellVolCm3);

  const infillFactor = (Math.max(5, Math.min(100, infill)) / 100) * 0.95; // Gyroid infill packing
  const printedModelVolCm3 = shellVolCm3 + (coreVolCm3 * infillFactor);
  const modelWeightG = printedModelVolCm3 * density;

  // Bambu Tree Support estimation (Geometry aspect & overhangs)
  const overhangRatio = Math.min(1.0, (dims.x * dims.y) / (dims.z * dims.z + 80));
  const baseSupportProb = overhangRatio > 0.4 ? 0.09 : 0.20;
  const supportVolCm3 = (solidVolCm3 * baseSupportProb) * (1 + (dims.z / 150) * 0.25);
  const printedSupportVolCm3 = supportVolCm3 * 0.14; // tree support sparse density
  const supportWeightG = printedSupportVolCm3 * density;

  const totalFilamentWeightG = modelWeightG + supportWeightG;

  // Slicing & Filament Support Diagnostic
  const supportRatio = modelWeightG > 0 ? (supportWeightG / modelWeightG) * 100 : 0;
  if (supportWeightG > 0) {
    if (supportRatio >= 15) {
      combinedDiagnostics.push({
        id: 'high_support_overhead',
        severity: 'warning',
        title: `High Support Filament Overhead (${supportRatio.toFixed(0)}%)`,
        description: `Overhangs require ${supportWeightG.toFixed(1)}g of tree supports (${supportRatio.toFixed(0)}% of model weight) to prevent sagging.`,
        slicingImpact: 'The slicer must generate tree support trunks and dense interface roofs below steep overhangs, extending overall print duration.',
        filamentSupportImpact: 'All support material is sacrificial waste. Interface contact points can leave rough scars on the finished surface.',
        action: 'Rotate the model on the build plate to reduce severe overhangs and minimize tree support generation.'
      });
    } else {
      combinedDiagnostics.push({
        id: 'supports_active',
        severity: 'info',
        title: `Tree Supports Enabled (${supportWeightG.toFixed(1)}g)`,
        description: `Minor overhangs require tree supports (${supportWeightG.toFixed(1)}g plastic).`,
        slicingImpact: 'Bambu tree supports automatically branch around the model to cradle cantilevered features.',
        filamentSupportImpact: 'Consumes small amount of extra filament that is removed and discarded post-print.',
        action: 'Inspect support contact areas in the 3D viewer.'
      });
    }
  }

  // P1S Time Modeling (Volumetric flow limits + coreXY acceleration)
  const p1sWarmupSeconds = 360; // 6 mins bed calibration & heatup
  const volumetricSpeeds = { draft: 18.5, standard: 12.0, fine: 6.8 }; // cm³/hr
  const speedCm3Hr = volumetricSpeeds[qualityId] || 12.0;
  const printHours = (printedModelVolCm3 + printedSupportVolCm3) / speedCm3Hr;
  const layerChangeOverheadSeconds = layerCount * 0.65;
  const totalTimeSeconds = Math.round(p1sWarmupSeconds + (printHours * 3600) + layerChangeOverheadSeconds);

  return {
    engine: 'Bambu Lab P1S Slicer Profile',
    total_filament_weight_g: Math.round(totalFilamentWeightG * 10) / 10,
    model_filament_weight_g: Math.round(modelWeightG * 10) / 10,
    support_filament_weight_g: Math.round(supportWeightG * 10) / 10,
    estimated_print_time_seconds: totalTimeSeconds,
    diagnostics: combinedDiagnostics
  };
}

let isAdvisoryExpanded = false;

function toggleAdvisoryAccordion() {
  isAdvisoryExpanded = !isAdvisoryExpanded;
  const content = document.getElementById('advisoryContent');
  const arrow = document.getElementById('advisoryToggleArrow');
  if (content) {
    if (isAdvisoryExpanded) {
      content.classList.add('expanded');
      if (arrow) arrow.style.transform = 'rotate(180deg)';
    } else {
      content.classList.remove('expanded');
      if (arrow) arrow.style.transform = 'rotate(0deg)';
    }
  }
}

function renderDiagnostics(diagnostics = []) {
  const panel = document.getElementById('slicingAdvisoryPanel');
  if (!panel) return;

  // STRICT REQUIREMENT: Only show if user uploaded a file AND the engine detects an actual problem (warning or error)
  const hasUserFile = !!(state.rawFileBuffer || currentUploadedFile);
  const problems = (diagnostics || []).filter(d => d.severity === 'error' || d.severity === 'warning');

  if (!hasUserFile || problems.length === 0) {
    panel.innerHTML = '';
    panel.style.display = 'none';
    return;
  }

  const hasError = problems.some(d => d.severity === 'error');
  const bannerTypeClass = hasError ? 'advisory-type-error' : 'advisory-type-warning';
  const iconSvg = hasError
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

  const titleText = hasError
    ? `${problems.length} Critical Print Risk${problems.length > 1 ? 's' : ''} Detected`
    : `${problems.length} Printability Warning${problems.length > 1 ? 's' : ''} Detected`;

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="advisory-accordion ${bannerTypeClass}">
      <div class="advisory-accordion-header" onclick="toggleAdvisoryAccordion()" role="button" tabindex="0" title="Click to expand/collapse advisory details">
        <div class="advisory-header-left">
          <span class="advisory-status-icon">${iconSvg}</span>
          <span class="advisory-header-title">${titleText}</span>
        </div>
        <div class="advisory-header-right">
          <span class="advisory-pill">${hasError ? 'Action Required' : 'Review Fix'}</span>
          <span class="advisory-toggle-icon" id="advisoryToggleArrow" style="transform: rotate(${isAdvisoryExpanded ? '180deg' : '0deg'});">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        </div>
      </div>
      <div class="advisory-accordion-content ${isAdvisoryExpanded ? 'expanded' : ''}" id="advisoryContent">
        <div class="advisory-cards-container">
          ${problems.map(d => {
            const sevClass = d.severity === 'error' ? 'severity-error' : 'severity-warning';
            const badgeLabel = d.severity === 'error' ? 'Critical Risk' : 'Advisory';
            return `
              <div class="advisory-card ${sevClass}">
                <div class="advisory-head">
                  <div class="advisory-title-group">
                    <h4 class="advisory-title">${d.title}</h4>
                  </div>
                  <span class="advisory-badge">${badgeLabel}</span>
                </div>
                <div class="advisory-body">
                  <div class="advisory-section">
                    <span class="advisory-section-label">Why this causes a problem</span>
                    <span class="advisory-text">${d.slicingImpact || d.description}</span>
                  </div>
                  ${d.filamentSupportImpact ? `
                  <div class="advisory-section">
                    <span class="advisory-section-label">Filament &amp; Support Impact</span>
                    <span class="advisory-text">${d.filamentSupportImpact}</span>
                  </div>` : ''}
                  ${d.action ? `
                  <div class="advisory-action-box">
                    <strong>Suggested Fix:</strong> <span>${d.action}</span>
                  </div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

/**
 * Executes Slicing via Backend API or Embedded P1S Engine
 */
async function executeSlicing() {
  const dims = state.dims;
  const overLimit = isOverBuildPlate(dims);

  if (overLimit) {
    const d = [{
      id: 'out_of_bounds',
      severity: 'error',
      title: 'Model Exceeds Bambu P1S Build Volume',
      description: `Model size (${dims.x}×${dims.y}×${dims.z} mm) exceeds the 256×256×256 mm build chamber limits.`,
      slicingImpact: 'OrcaSlicer refuses toolpath generation because extruder motion coordinates exceed mechanical axis limits.',
      filamentSupportImpact: 'No supports or model perimeter can physically fit on the heated bed plate.',
      action: 'Scale down proportionally or split the part into interlocking segments in CAD.'
    }];
    setSlicingError(`Model dimensions (${dims.x}×${dims.y}×${dims.z} mm) exceed Bambu Lab P1S maximum build volume (${db.plate.x}×${db.plate.y}×${db.plate.z} mm).`);
    renderDiagnostics(d);
    showSlicingLoading(false);
    recalc();
    return;
  }

  let meshStats = null;
  if (state.rawFileBuffer) {
    const val = clientValidateSTL(state.rawFileBuffer, dims);
    if (!val.valid) {
      setSlicingError(val.error);
      renderDiagnostics(val.diagnostics || []);
      showSlicingLoading(false);
      recalc();
      return;
    }
    meshStats = val;
  }

  setSlicingError(null);

  // Cache lookup
  const cacheKey = `${state.fileHash || 'default'}|${dims.x},${dims.y},${dims.z}|${state.materialId}|${state.qualityId}|${state.infill}`;
  if (clientSliceCache.has(cacheKey)) {
    state.sliceResult = clientSliceCache.get(cacheKey);
    renderDiagnostics(state.sliceResult?.diagnostics || []);
    showSlicingLoading(false);
    recalc();
    return;
  }

  // Attempt backend API call if running in local development environment
  let sliced = null;
  const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocalDev) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const res = await fetch('http://localhost:3001/api/slice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileHash: state.fileHash,
          dims: state.dims,
          materialId: state.materialId,
          qualityId: state.qualityId,
          infill: state.infill
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.slice) {
          sliced = data.slice;
        }
      } else if (res.status === 422) {
        const data = await res.json();
        setSlicingError(data.error || 'Slicing validation error.');
        renderDiagnostics(data.diagnostics || []);
        showSlicingLoading(false);
        recalc();
        return;
      }
    } catch (err) {
      // Local backend offline: use calibrated engine
    }
  }

  if (!sliced) {
    sliced = runClientBambuP1SEngine({
      dims,
      meshStats,
      materialId: state.materialId,
      qualityId: state.qualityId,
      infill: state.infill
    });
  }

  clientSliceCache.set(cacheKey, sliced);
  state.sliceResult = sliced;
  renderDiagnostics(sliced?.diagnostics || []);
  showSlicingLoading(false);
  recalc();
}

/* ============================================================
   COST & BILLING CALCULATION ENGINE (BAMBU LAB P1S)
   ============================================================ */
function getMaterial(){ return db.materials.find(m=>m.id===state.materialId) || db.materials.find(m=>m.active); }
function getQuality(){ return db.qualities.find(q=>q.id===state.qualityId) || db.qualities[1]; }

/**
 * Shared pricing calculation — single source of truth for both
 * live UI display (recalc) and order submission (requestQuote).
 */
function computePrice({ sliceResult, material, qty, colorMode, amsSlots }) {
  const modelWeight = sliceResult.model_filament_weight_g || 0;
  const supportWeight = sliceResult.support_filament_weight_g || 0;
  const totalWeight = modelWeight + supportWeight;
  const printTimeSeconds = sliceResult.estimated_print_time_seconds || 0;
  const printHours = printTimeSeconds / 3600;

  const wasteFactor = db.wasteFactor || 1.10;
  const p1sHourlyRate = db.p1sHourlyRate ?? db.machineRate ?? 0;
  const failureRatePct = db.failureRatePct ?? 8;
  const marginPct = db.marginPct ?? 0;
  const minOrderFee = db.minimumOrderFee ?? 20;

  // 1. Material cost
  const modelMaterialCost = modelWeight * material.pricePerGram * wasteFactor;
  const supportMaterialCost = supportWeight * material.pricePerGram * wasteFactor;
  const totalMaterialCost = totalWeight * material.pricePerGram * wasteFactor;

  // 2. Machine cost
  const machineCost = printHours * p1sHourlyRate;

  // 3. Setup & QA fee with 3-tier support surcharge
  const supportRatio = modelWeight > 0 ? (supportWeight / modelWeight) * 100 : 0;
  let supportSurcharge = 0;
  if (supportWeight > 0) {
    if (supportRatio >= (db.supportTierMidPct || 15)) {
      supportSurcharge = db.supportTierSurchargeHigh || 0;
    } else if (supportRatio >= (db.supportTierLowPct || 5)) {
      supportSurcharge = db.supportTierSurchargeMid || 0;
    }
    // Below supportTierLowPct: no surcharge
  }
  const setupQAFee = (db.baseFee || 0) + supportSurcharge;

  // 4. Multi-color (AMS) surcharge
  const activeColorCount = (colorMode === 'ams')
    ? (amsSlots ? amsSlots.filter(s => s.active).length : 1)
    : 1;
  const isMultiColor = activeColorCount > 1;
  const isMultiOn = db.multiColorEnabled !== false;
  const multiColorCharge = (isMultiColor && isMultiOn) ? (db.multiColorFee || 5) : 0;

  // 5. Failure / scrap buffer
  const failureBuffer = (totalMaterialCost + machineCost) * (failureRatePct / 100);

  // 6. Unit subtotal & Margin
  const unitSubtotal = totalMaterialCost + machineCost + setupQAFee + failureBuffer + multiColorCharge;
  const unitCost = unitSubtotal * (1 + marginPct / 100);

  // 7. Bulk discount
  let discountPct = 0;
  if (qty >= db.tier2MinQty) discountPct = db.tier2Discount / 100;
  else if (qty >= db.tier1MinQty) discountPct = db.tier1Discount / 100;

  const rawTotal = unitCost * qty * (1 - discountPct);
  const total = Math.max(minOrderFee, rawTotal);

  return {
    modelWeight, supportWeight, totalWeight,
    printTimeSeconds, printHours,
    modelMaterialCost, supportMaterialCost, totalMaterialCost,
    machineCost, setupQAFee, supportRatio,
    activeColorCount, isMultiColor, isMultiOn, multiColorCharge,
    failureBuffer, unitSubtotal, unitCost,
    discountPct, rawTotal, total
  };
}

function recalc(){
  const { x, y, z } = state.dims;
  const mat = getMaterial();
  const qual = getQuality();
  if(!mat || !qual) return;

  const overLimit = isOverBuildPlate(state.dims);
  document.getElementById('warnMsg').classList.toggle('show', overLimit);
  renderPlate(x, y, z, overLimit);

  // If over limit or slicing error, do not quote
  if (overLimit || state.sliceError || !state.sliceResult) {
    document.getElementById('bdTotal').textContent = '—';
    document.getElementById('turnaround').textContent = overLimit
      ? 'Resize to fit Bambu P1S build volume (256×256×256 mm) to get a quote'
      : (state.sliceError || 'Slicing model...');
    return;
  }

  const p = computePrice({
    sliceResult: state.sliceResult,
    material: mat,
    qty: state.qty,
    colorMode: state.colorMode,
    amsSlots: state.amsSlots
  });

  const {
    modelWeight, supportWeight, printTimeSeconds, printHours,
    modelMaterialCost, supportMaterialCost,
    machineCost, setupQAFee,
    isMultiColor, isMultiOn, multiColorCharge,
    failureBuffer, unitCost, discountPct, total
  } = p;

  // Populate UI
  document.getElementById('bdMatName').textContent = mat.name;
  document.getElementById('bdMat').textContent = '₹' + modelMaterialCost.toFixed(2) + ' · ' + modelWeight.toFixed(0) + 'g';

  // Support material line item
  const supportRow = document.getElementById('bdSupportRow');
  if (supportRow) {
    if (supportWeight > 0) {
      supportRow.style.display = 'flex';
      document.getElementById('bdSupportWeight').textContent = supportWeight.toFixed(1) + 'g';
      document.getElementById('bdSupportCost').textContent = '₹' + supportMaterialCost.toFixed(2);
    } else {
      supportRow.style.display = 'none';
    }
  }

  // Multi-color AMS Surcharge row
  const multiRow = document.getElementById('bdMultiColorRow');
  if (multiRow) {
    if (isMultiColor && isMultiOn) {
      multiRow.style.display = 'flex';
      document.getElementById('bdMultiColorCost').textContent = '+₹' + multiColorCharge.toFixed(2);
    } else {
      multiRow.style.display = 'none';
    }
  }

  // Purge & Scrap buffer row
  const scrapVal = document.getElementById('bdScrapVal');
  if (scrapVal) {
    scrapVal.textContent = '₹' + failureBuffer.toFixed(2);
  }

  // SLA Resin tag
  const resinTag = document.getElementById('resinTag');
  if (resinTag) {
    resinTag.style.display = mat.id === 'resin' ? 'inline-flex' : 'none';
  }

  const printMinsRaw = Math.max(1, Math.round(printTimeSeconds / 60));
  const totalDisplayMins = printMinsRaw + 20; // 20 mins additional time
  document.getElementById('bdHours').textContent = totalDisplayMins + ' mins';
  const bdMach = document.getElementById('bdMachine');
  if (bdMach) bdMach.textContent = '₹' + machineCost.toFixed(2);
  const bdFin = document.getElementById('bdFinish');
  if (bdFin) bdFin.textContent = '₹' + setupQAFee.toFixed(2);
  document.getElementById('bdQtyLabel').textContent = '× ' + state.qty + (state.qty===1?' unit':' units');
  document.getElementById('bdUnit').textContent = '₹' + unitCost.toFixed(2);

  const discRow = document.getElementById('bdDiscountRow');
  if(discountPct > 0){
    discRow.style.display = 'flex';
    document.getElementById('bdDiscount').textContent = '−₹' + (unitCost * state.qty * discountPct).toFixed(2);
  } else {
    discRow.style.display = 'none';
  }
  document.getElementById('bdTotal').textContent = '₹' + total.toFixed(2);

  const note = document.getElementById('discountNote');
  if (db.tier1MinQty && db.tier2MinQty) {
    note.textContent = `${db.tier1MinQty}+ saves ${db.tier1Discount}%, ${db.tier2MinQty}+ saves ${db.tier2Discount}%`;
  }

  const days = Math.max(1, Math.ceil((printHours * state.qty) / 8)) + 1;
  document.getElementById('turnaround').textContent = 'Estimated ready for lab pickup in ' + days + (days===1?' day':' days');
}

/* ============================================================
   CUSTOMER TRANSACTION & SESSION LOGIC
   ============================================================ */
function showToast(msg){
  const t = document.getElementById('toast');
  if (!t) return;
  // Use textContent by default for safety; allow explicit HTML via a flag
  if (typeof msg === 'string' && (msg.includes('<') || msg.includes('&'))) {
    // Sanitize: only allow known safe tags (span with class)
    const temp = document.createElement('div');
    temp.innerHTML = msg;
    // Strip all tags except <span>
    temp.querySelectorAll('*').forEach(el => {
      if (el.tagName !== 'SPAN') {
        el.replaceWith(document.createTextNode(el.textContent));
      }
    });
    t.innerHTML = temp.innerHTML;
  } else {
    t.textContent = msg;
  }
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(()=>t.classList.remove('show'), 3600);
}

async function getRTDBAdminEmails() {
  const snap = await rtdb.ref('stratum-db/admin_emails').once('value');
  const val = snap.val();
  let list = Array.isArray(val) && val.length > 0 ? val : ['anupchowdhury219@gmail.com'];
  return list.filter(e => e !== 'admin@stratum.com');
}

let myOrdersListenerRef = null;

function toggleProfileDropdown() {
  const dd = document.getElementById('profileDropdown');
  if (!dd) return;
  const isHidden = dd.style.display === 'none' || dd.style.display === '';
  dd.style.display = isHidden ? 'flex' : 'none';
}

document.addEventListener('click', e => {
  const btn = document.getElementById('profileBtn');
  const dd = document.getElementById('profileDropdown');
  if (btn && dd && !btn.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0][0].toUpperCase();
}

let userOrdersCache = {};

function showUserOrderDetailModal(orderId) {
  const o = userOrdersCache[orderId];
  if (!o) return;
  
  const statusLabels = {
    queued: 'Queued',
    printing: 'Printing',
    post: 'Finishing',
    ready: 'Ready',
    shipped: 'Shipped'
  };
  
  document.getElementById('uOrderRefVal').textContent = 'Reference: ' + o.id;
  document.getElementById('uOrderMaterial').textContent = o.material;
  document.getElementById('uOrderQty').textContent = o.qty + (o.qty === 1 ? ' unit' : ' units');
  document.getElementById('uOrderTotal').textContent = '₹' + Number(o.total).toFixed(2);
  document.getElementById('uOrderDate').textContent = o.date;
  document.getElementById('uOrderStatus').textContent = statusLabels[o.status] || o.status;
  document.getElementById('uOrderModelName').textContent = o.modelName || 'Default Torus Model';
  
  const modal = document.getElementById('userOrderDetailsModal');
  modal.style.display = 'flex';
  gsap.fromTo(modal, { scale: 0.95, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "power2.out" });
}

function closeUserOrderDetailModal() {
  const modal = document.getElementById('userOrderDetailsModal');
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

/* User Account Dashboard Logic */
let isEditProfileMode = false;
let currentUserProfile = {};

function openUserDashboard() {
  const modal = document.getElementById('userDashboardModal');
  if (!modal) return;
  modal.style.display = 'flex';
  isEditProfileMode = false;
  document.getElementById('profileViewMode').style.display = 'grid';
  document.getElementById('profileEditMode').style.display = 'none';
  document.getElementById('editProfileBtn').style.display = 'inline-flex';
  switchDashboardTab('profile');
  gsap.fromTo(modal, { scale: 0.95, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "power2.out" });
}

function closeUserDashboard() {
  const modal = document.getElementById('userDashboardModal');
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

function openTermsModal() {
  const modal = document.getElementById('termsModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const card = modal.querySelector('.card');
  if (window.gsap) {
    gsap.fromTo(modal, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" });
    if (card) gsap.fromTo(card, { scale: 0.95, y: 15 }, { scale: 1, y: 0, duration: 0.25, ease: "power2.out" });
  }
}
window.openTermsModal = openTermsModal;

function closeTermsModal() {
  const modal = document.getElementById('termsModal');
  if (!modal) return;
  const card = modal.querySelector('.card');
  if (window.gsap) {
    if (card) gsap.to(card, { scale: 0.95, y: 10, duration: 0.18, ease: "power2.in" });
    gsap.to(modal, {
      opacity: 0,
      duration: 0.2,
      ease: "power2.in",
      onComplete: () => {
        modal.style.display = 'none';
        modal.style.opacity = '1';
        if (card) { card.style.transform = ''; }
      }
    });
  } else {
    modal.style.display = 'none';
  }
}
window.closeTermsModal = closeTermsModal;

function openPrivacyModal() {
  const modal = document.getElementById('privacyModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const card = modal.querySelector('.card');
  if (window.gsap) {
    gsap.fromTo(modal, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" });
    if (card) gsap.fromTo(card, { scale: 0.95, y: 15 }, { scale: 1, y: 0, duration: 0.25, ease: "power2.out" });
  }
}
window.openPrivacyModal = openPrivacyModal;

function closePrivacyModal() {
  const modal = document.getElementById('privacyModal');
  if (!modal) return;
  const card = modal.querySelector('.card');
  if (window.gsap) {
    if (card) gsap.to(card, { scale: 0.95, y: 10, duration: 0.18, ease: "power2.in" });
    gsap.to(modal, {
      opacity: 0,
      duration: 0.2,
      ease: "power2.in",
      onComplete: () => {
        modal.style.display = 'none';
        modal.style.opacity = '1';
        if (card) { card.style.transform = ''; }
      }
    });
  } else {
    modal.style.display = 'none';
  }
}
window.closePrivacyModal = closePrivacyModal;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeTermsModal();
    closePrivacyModal();
  }
});

function switchDashboardTab(tab) {
  const tabProfile = document.getElementById('dashTabProfile');
  const tabOrders = document.getElementById('dashTabOrders');
  const btnProfile = document.getElementById('tabBtnProfile');
  const btnOrders = document.getElementById('tabBtnOrders');
  
  if (tab === 'profile') {
    tabProfile.style.display = 'block';
    tabOrders.style.display = 'none';
    btnProfile.style.borderBottom = '2px solid var(--signal)';
    btnProfile.style.color = 'var(--text-primary)';
    btnProfile.style.fontWeight = '600';
    btnOrders.style.borderBottom = 'none';
    btnOrders.style.color = 'var(--text-secondary)';
    btnOrders.style.fontWeight = '500';
  } else {
    tabProfile.style.display = 'none';
    tabOrders.style.display = 'block';
    btnOrders.style.borderBottom = '2px solid var(--signal)';
    btnOrders.style.color = 'var(--text-primary)';
    btnOrders.style.fontWeight = '600';
    btnProfile.style.borderBottom = 'none';
    btnProfile.style.color = 'var(--text-secondary)';
    btnProfile.style.fontWeight = '500';
  }
}

function toggleEditProfile() {
  isEditProfileMode = !isEditProfileMode;
  const viewMode = document.getElementById('profileViewMode');
  const editMode = document.getElementById('profileEditMode');
  const btn = document.getElementById('editProfileBtn');
  
  if (isEditProfileMode) {
    viewMode.style.display = 'none';
    editMode.style.display = 'flex';
    btn.style.display = 'none';
    
    document.getElementById('inputName').value = currentUserProfile.name || '';
    document.getElementById('inputPhone').value = currentUserProfile.phone || '';
    document.getElementById('inputDept').value = currentUserProfile.dept || '';
    document.getElementById('inputAddress').value = currentUserProfile.address || '';
  } else {
    viewMode.style.display = 'grid';
    editMode.style.display = 'none';
    btn.style.display = 'inline-flex';
  }
}

async function saveUserProfile() {
  const user = auth.currentUser;
  if (!user) return;
  
  const name = document.getElementById('inputName').value.trim();
  const phone = document.getElementById('inputPhone').value.trim();
  const dept = document.getElementById('inputDept').value.trim();
  const address = document.getElementById('inputAddress').value.trim();
  
  if (!name || !phone || !dept || !address) {
    showToast("Please fill out all fields.");
    return;
  }
  
  showToast("Saving profile updates...");
  try {
    const updatedProfile = {
      ...currentUserProfile,
      name,
      phone,
      dept,
      address
    };
    await rtdb.ref(`stratum-db/users/${user.uid}`).set(updatedProfile);
    showToast("Profile updated successfully!");
    toggleEditProfile();
  } catch (e) {
    console.error(e);
    showToast("Failed to update profile.");
  }
}

let myProfileListenerRef = null;

function subscribeMyOrders(email, uid) {
  if (myOrdersListenerRef) {
    myOrdersListenerRef.off();
  }
  if (myProfileListenerRef) {
    myProfileListenerRef.off();
  }
  
  const ddOrders = document.getElementById('dashOrdersContainer');
  if (!ddOrders) return;
  
  // Listen to profile details
  myProfileListenerRef = rtdb.ref(`stratum-db/users/${uid}`);
  myProfileListenerRef.on('value', snap => {
    const profile = snap.val() || {};
    currentUserProfile = profile;
    const name = profile.name || email;
    
    const avatarEl = document.getElementById('profileAvatar');
    const badgeNameEl = document.getElementById('userBadgeName');
    if (avatarEl) avatarEl.textContent = getInitials(name);
    if (badgeNameEl) badgeNameEl.textContent = name;
    
    // Update Dashboard Header
    const dUserName = document.getElementById('dashboardUserName');
    const dUserEmail = document.getElementById('dashboardUserEmail');
    const dAvatar = document.getElementById('dashboardAvatar');
    if (dUserName) dUserName.textContent = name;
    if (dUserEmail) dUserEmail.textContent = email;
    if (dAvatar) dAvatar.textContent = getInitials(name);
    
    // Update Dashboard Profile Info
    const valName = document.getElementById('valName');
    const valPhone = document.getElementById('valPhone');
    const valDept = document.getElementById('valDept');
    const valAddress = document.getElementById('valAddress');
    
    if (valName) valName.textContent = profile.name || '—';
    if (valPhone) valPhone.textContent = profile.phone || '—';
    if (valDept) valDept.textContent = profile.dept || '—';
    if (valAddress) valAddress.textContent = profile.address || '—';
  });
  
  myOrdersListenerRef = rtdb.ref('stratum-db/orders').orderByChild('customer').equalTo(email);
  myOrdersListenerRef.on('value', snap => {
    const data = snap.val();
    userOrdersCache = {};
    if (data) {
      const orders = Object.values(data);
      orders.sort((a, b) => b.id.localeCompare(a.id));
      
      orders.forEach(o => {
        userOrdersCache[o.id] = o;
      });
      
      if (orders.length > 0) {
        ddOrders.innerHTML = orders.map(o => {
          const statusLabels = {
            queued: 'Queued',
            printing: 'Printing',
            post: 'Finishing',
            ready: 'Ready',
            shipped: 'Shipped'
          };
          const statusText = statusLabels[o.status] || o.status;
          
          const steps = ['queued', 'printing', 'post', 'ready', 'shipped'];
          const stepLabels = ['Queued', 'Printing', 'Finishing', 'Ready', 'Shipped'];
          const currentIndex = steps.indexOf(o.status);
          
          let progressWidth = 0;
          if (currentIndex !== -1) {
            progressWidth = (currentIndex / (steps.length - 1)) * 100;
          }
          
          const stepsHTML = steps.map((s, idx) => {
            let cls = '';
            if (idx === currentIndex) cls = 'active';
            else if (idx < currentIndex) cls = 'completed';
            
            return `
              <div class="tracker-step ${cls}">
                <div class="tracker-step-dot">${idx + 1}</div>
                <div class="tracker-step-label">${stepLabels[idx]}</div>
              </div>
            `;
          }).join('');
          
          return `
            <div class="order-track-card" onclick="showUserOrderDetailModal('${o.id}')" style="cursor:pointer; transition:border-color 0.2s; margin-bottom:12px; border:1px solid var(--border-color);" onmouseover="this.style.borderColor='var(--signal)'" onmouseout="this.style.borderColor='var(--border-color)'">
              <div class="order-track-header">
                <h3>Order Reference: ${o.id}</h3>
                <div class="order-track-meta">
                  <span>Material: <strong>${o.material}</strong></span>
                  <span>Quantity: <strong>${o.qty} ${o.qty === 1 ? 'unit' : 'units'}</strong></span>
                  <span>Total: <strong>₹${Number(o.total).toFixed(2)}</strong></span>
                  <span>Date: <strong>${o.date}</strong></span>
                </div>
              </div>
              <div class="tracker-steps">
                <div class="tracker-line-container" style="position: absolute; left: 32px; right: 32px; top: 15px; height: 3px; background: var(--border-color-strong); z-index: 1;">
                  <div class="tracker-progress-bar" style="width: ${progressWidth}%; height: 100%; background: var(--success); transition: width 0.4s ease;"></div>
                </div>
                ${stepsHTML}
              </div>
            </div>
          `;
        }).join('');
      } else {
        ddOrders.innerHTML = '<span style="color:var(--text-muted); font-size:13px;">No orders found in your account history</span>';
      }
    } else {
      ddOrders.innerHTML = '<span style="color:var(--text-muted); font-size:13px;">No orders found in your account history</span>';
    }
  });
}

function unsubscribeMyOrders() {
  if (myOrdersListenerRef) {
    myOrdersListenerRef.off();
    myOrdersListenerRef = null;
  }
  if (myProfileListenerRef) {
    myProfileListenerRef.off();
    myProfileListenerRef = null;
  }
  userOrdersCache = {};
  currentUserProfile = {};
  
  const ddOrders = document.getElementById('dashOrdersContainer');
  if (ddOrders) ddOrders.innerHTML = '<span style="color:var(--text-muted); font-size:13px;">No orders found in your account history</span>';
  
  const valName = document.getElementById('valName');
  const valPhone = document.getElementById('valPhone');
  const valDept = document.getElementById('valDept');
  const valAddress = document.getElementById('valAddress');
  if (valName) valName.textContent = '—';
  if (valPhone) valPhone.textContent = '—';
  if (valDept) valDept.textContent = '—';
  if (valAddress) valAddress.textContent = '—';
  
  const avatarEl = document.getElementById('profileAvatar');
  const badgeNameEl = document.getElementById('userBadgeName');
  if (avatarEl) avatarEl.textContent = 'U';
  if (badgeNameEl) badgeNameEl.textContent = 'User';
}

function initAuthListener() {
  auth.onAuthStateChanged(async (user) => {
    const userHeader = document.getElementById('userHeaderStatus');
    const guestHeader = document.getElementById('guestHeaderActions');
    const adminLink = document.querySelector('.admin-link');
    const adminPanelLink = document.getElementById('adminPanelLink');
    
    if (user) {
      sessionStorage.setItem('stratum_user_email', user.email);
      subscribeMyOrders(user.email, user.uid);
      const admins = await getRTDBAdminEmails();
      const isAdmin = admins.includes(user.email);
      
      if (isAdmin) {
        sessionStorage.setItem('stratum_user_role', 'admin');
        if (adminPanelLink) adminPanelLink.style.display = 'inline-flex';
      } else {
        sessionStorage.setItem('stratum_user_role', 'user');
        if (adminPanelLink) adminPanelLink.style.display = 'none';
      }
      
      if (userHeader) userHeader.style.display = 'flex';
      if (guestHeader) guestHeader.style.display = 'none';
      const emailEl = document.getElementById('userBadgeEmail');
      if (emailEl) emailEl.textContent = user.email;
      
    } else {
      sessionStorage.removeItem('stratum_user_email');
      sessionStorage.removeItem('stratum_user_role');
      unsubscribeMyOrders();
      if (userHeader) userHeader.style.display = 'none';
      if (guestHeader) guestHeader.style.display = 'flex';
      if (adminPanelLink) adminPanelLink.style.display = 'none';
      if (adminLink) {
        adminLink.href = '/login';
        adminLink.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Sign In`;
      }
    }
  });
}

async function logoutCustomer() {
  try {
    await auth.signOut();
    sessionStorage.removeItem('stratum_user_email');
    sessionStorage.removeItem('stratum_user_role');
    showToast("Logged out successfully.");
  } catch (error) {
    console.error("Logout failed:", error);
  }
}

let pendingOrderData = null;

async function requestQuote() {
  const email = sessionStorage.getItem('stratum_user_email');
  const role = sessionStorage.getItem('stratum_user_role');
  
  if (!email || !role) {
    localStorage.setItem('stratum_pending_quote', 'true');
    localStorage.setItem('stratum_pending_config', JSON.stringify(state));
    showToast("Please sign in to place a print quote request.");
    setTimeout(() => {
      window.location.href = '/login';
    }, 1200);
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    showToast("Session expired. Please sign in again.");
    return;
  }
  
  if (state.sliceError || isOverBuildPlate(state.dims)) {
    showToast(state.sliceError || "Model exceeds Bambu Lab P1S build volume.");
    return;
  }
  if (!state.sliceResult) {
    showToast("Please wait for slicing to finish before placing request.");
    return;
  }

  const mat = getMaterial();

  // Use shared pricing function — single source of truth
  const p = computePrice({
    sliceResult: state.sliceResult,
    material: mat,
    qty: state.qty,
    colorMode: state.colorMode,
    amsSlots: state.amsSlots
  });

  const ordersSnap = await rtdb.ref('stratum-db/orders').once('value');
  const currentOrders = ordersSnap.val() ? Object.values(ordersSnap.val()) : [];
  const orderId = 'ST-' + (10480 + currentOrders.length);

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const today = new Date();
  const dateStr = months[today.getMonth()] + ' ' + today.getDate();

  const colorsListStr = (state.colorMode === 'ams')
    ? state.amsSlots.filter(s => s.active).map(s => `${s.label}: ${s.name}`).join(', ')
    : (state.singleColor ? state.singleColor.name : mat.name);

  const newOrder = {
    id: orderId,
    customer: email,
    material: mat.name,
    qty: state.qty,
    total: p.total,
    status: 'queued',
    date: dateStr,
    printer: 'Bambu Lab P1S',
    dimensions: `${state.dims.x} × ${state.dims.y} × ${state.dims.z} mm`,
    modelWeightG: p.modelWeight,
    supportWeightG: p.supportWeight,
    printHours: Math.round(p.printHours * 10) / 10,
    multiColor: p.isMultiColor,
    colorsCount: p.activeColorCount,
    colorsList: colorsListStr,
    modelUrl: '',
    modelName: ''
  };

  if (currentUploadedFile) {
    showToast("Processing model file...");
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(currentUploadedFile);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = e => reject(e);
      });
      newOrder.modelData = base64;
      newOrder.modelName = currentUploadedFile.name;
    } catch (e) {
      console.error("File processing failed:", e);
    }
  }

  const userProfileSnap = await rtdb.ref(`stratum-db/users/${user.uid}`).once('value');
  const userProfile = userProfileSnap.val() || {};

  if (!userProfile.phone || !userProfile.address || !userProfile.dept) {
    pendingOrderData = newOrder;
    document.getElementById('detailsPhone').value = userProfile.phone || '';
    document.getElementById('detailsDept').value = userProfile.dept || '';
    document.getElementById('detailsAddress').value = userProfile.address || '';
    
    const detailsModal = document.getElementById('detailsModal');
    detailsModal.style.display = 'flex';
    gsap.fromTo(detailsModal, { scale: 0.95, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "power2.out" });
  } else {
    newOrder.customerName = userProfile.name || email;
    newOrder.phone = userProfile.phone;
    newOrder.dept = userProfile.dept;
    newOrder.address = userProfile.address;
    await submitOrderDirect(newOrder);
  }
}

async function submitOrderDirect(order) {
  showToast("Saving order request...");
  try {
    await rtdb.ref(`stratum-db/orders/${order.id}`).set(order);
    localStorage.removeItem('stratum_pending_quote');
    localStorage.removeItem('stratum_pending_config');
    showToast(`Quote request saved successfully! Reference Code: <span class="ref">${order.id}</span>.`);
    clearFile();
  } catch (e) {
    console.error(e);
    showToast("Failed to place quote request.");
  }
  recalc();
}

async function submitQuoteWithDetails() {
  const phone = document.getElementById('detailsPhone').value.trim();
  const dept = document.getElementById('detailsDept').value.trim();
  const address = document.getElementById('detailsAddress').value.trim();
  
  if (!phone || !dept || !address) {
    showToast("Please fill out all contact, department, and address fields.");
    return;
  }
  
  const user = auth.currentUser;
  if (!user || !pendingOrderData) return;
  
  try {
    const userProfileSnap = await rtdb.ref(`stratum-db/users/${user.uid}`).once('value');
    const userProfile = userProfileSnap.val() || {};
    userProfile.phone = phone;
    userProfile.dept = dept;
    userProfile.address = address;
    await rtdb.ref(`stratum-db/users/${user.uid}`).set(userProfile);
    
    pendingOrderData.customerName = userProfile.name || user.email;
    pendingOrderData.phone = phone;
    pendingOrderData.dept = dept;
    pendingOrderData.address = address;
    
    await submitOrderDirect(pendingOrderData);
    closeDetailsModal();
  } catch (e) {
    console.error(e);
    showToast("Failed to save contact details.");
  }
}

function closeDetailsModal() {
  const detailsModal = document.getElementById('detailsModal');
  if (!detailsModal) return;
  gsap.to(detailsModal, {
    scale: 0.95,
    opacity: 0,
    duration: 0.2,
    ease: "power2.in",
    onComplete: () => {
      detailsModal.style.display = 'none';
      pendingOrderData = null;
    }
  });
}

/* ============================================================
   PAGE INITIALIZATION
   ============================================================ */
async function init(){
  try {
    initSquareGridBackground();
    await loadDB();
    renderMatChips();
    renderQualSeg();
    renderColorSystem();
    renderMaterialsStrip();
    enable3DTiltEffect('.how-step', ['.layer-num', 'h3', 'p']);
    updateAspectLockUI();
    scheduleSlicing(0);
    initAuthListener();
    
    // Check for pending order checkout redirects
    const pendingQuote = localStorage.getItem('stratum_pending_quote');
    const pendingConfig = localStorage.getItem('stratum_pending_config');
    if (pendingQuote === 'true' && pendingConfig && sessionStorage.getItem('stratum_user_email')) {
      try {
        const savedState = JSON.parse(pendingConfig);
        state.dims = savedState.dims;
        state.materialId = savedState.materialId;
        state.qualityId = savedState.qualityId;
        state.infill = savedState.infill;
        state.qty = savedState.qty;
        
        document.getElementById('dimX').value = state.dims.x;
        document.getElementById('dimY').value = state.dims.y;
        document.getElementById('dimZ').value = state.dims.z;
        document.getElementById('infillRange').value = state.infill;
        document.getElementById('infillVal').textContent = state.infill + '%';
        document.getElementById('qtyInput').value = state.qty;
      } catch (e) {}
      
      setTimeout(() => {
        requestQuote();
      }, 1500);
    }
    init3DViewer();
  } catch (e) {
    console.error("UI Initialization Error:", e);
  }
  
  let progress = { value: 0 };
  gsap.to(progress, {
    value: 100,
    duration: 1.2,
    ease: "power2.inOut",
    onUpdate: () => {
      const fill = document.getElementById('preloader-bar-fill');
      if (fill) fill.style.width = progress.value + '%';
    },
    onComplete: () => {
      const preloader = document.getElementById('preloader');
      if (preloader) {
        gsap.to(preloader, {
          opacity: 0,
          duration: 0.5,
          onComplete: () => {
            preloader.style.display = 'none';
            gsap.registerPlugin(ScrollTrigger);
            
            // Hero reveals
            gsap.to(".hero-anim", { opacity: 1, y: 0, duration: 0.8, stagger: 0.15, ease: "power2.out" });
            
            // Config cards scale-in on scroll trigger
            gsap.to(".gsap-scale-in", {
              scrollTrigger: { trigger: "#calculator", start: "top 80%" },
              opacity: 1,
              scale: 1,
              duration: 0.8,
              stagger: 0.15,
              ease: "power2.out"
            });
            
            // Materials list scroll trigger
            gsap.to(".materials-strip h2", {
              scrollTrigger: { trigger: ".materials-strip", start: "top 80%" },
              opacity: 1,
              y: 0,
              duration: 0.6,
              ease: "power2.out"
            });
            gsap.to(".mat-card", {
              scrollTrigger: { trigger: ".mat-grid", start: "top 80%" },
              opacity: 1,
              y: 0,
              duration: 0.7,
              stagger: 0.1,
              ease: "power2.out"
            });

            // How steps
            gsap.to(".how-step", {
              scrollTrigger: { trigger: ".how-grid", start: "top 85%" },
              opacity: 1,
              y: 0,
              duration: 0.8,
              stagger: 0.15,
              ease: "power2.out"
            });
          }
        });
      }
    }
  });
}

/**
 * Top Fade Square Grid Background (Pure JS implementation with proper square proportions)
 */
function initSquareGridBackground() {
  document.body.style.backgroundColor = '#f1f5f9';
  let gridBg = document.getElementById('topFadeGridBg');
  if (!gridBg) {
    gridBg = document.createElement('div');
    gridBg.id = 'topFadeGridBg';
    document.body.prepend(gridBg);
  }
  
  Object.assign(gridBg.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    width: '100vw',
    height: '100vh',
    zIndex: '-1',
    pointerEvents: 'none',
    backgroundColor: 'transparent',
    backgroundImage: `
      linear-gradient(to right, #94a3b8 1.5px, transparent 1.5px),
      linear-gradient(to bottom, #94a3b8 1.5px, transparent 1.5px)
    `,
    backgroundSize: '28px 28px', // Proper squares with equal width and height
    opacity: '0.45', // Crisp, visible gray grid
    WebkitMaskImage: 'radial-gradient(ellipse 85% 75% at 50% 0%, #000 65%, transparent 100%)',
    maskImage: 'radial-gradient(ellipse 85% 75% at 50% 0%, #000 65%, transparent 100%)'
  });
}

init();
