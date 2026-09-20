/* ============================================================
   USER DATABASE & REGISTRATION SYSTEM
   ============================================================ */
async function getRTDBUser(uid) {
  const snap = await rtdb.ref(`stratum-db/users/${uid}`).once('value');
  return snap.val();
}

async function saveRTDBUser(uid, email, name) {
  await rtdb.ref(`stratum-db/users/${uid}`).set({ email, name });
}

async function getRTDBAdminEmails() {
  const snap = await rtdb.ref('stratum-db/admin_emails').once('value');
  let val = snap.val();
  const defaults = ['anupchowdhury219@gmail.com'];
  if (Array.isArray(val) && val.length > 0) {
    let updated = false;
    if (val.includes('admin@stratum.com')) {
      val = val.filter(e => e !== 'admin@stratum.com');
      updated = true;
    }
    defaults.forEach(d => {
      if (!val.includes(d)) {
        val.push(d);
        updated = true;
      }
    });
    if (updated) {
      await rtdb.ref('stratum-db/admin_emails').set(val);
    }
    await rtdb.ref('stratum-db/init_flag').set(true);
    return val;
  }
  await rtdb.ref('stratum-db/admin_emails').set(defaults);
  await rtdb.ref('stratum-db/init_flag').set(true);
  return defaults;
}

function getFriendlyErrorMessage(error) {
  if (!error) return "An unknown error occurred.";
  switch (error.code) {
    case 'auth/invalid-email':
      return "Please enter a valid email address.";
    case 'auth/user-disabled':
      return "This account has been disabled. Please contact support.";
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return "Incorrect email or password.";
    case 'auth/email-already-in-use':
      return "An account with this email address already exists.";
    case 'auth/weak-password':
      return "Password should be at least 8 characters.";
    case 'auth/network-request-failed':
      return "Network connection error. Please check your internet connection.";
    default:
      if (error.message && error.message.includes("permission_denied")) {
        return "Database permission denied. Please log in or check configuration.";
      }
      return error.message || "An unexpected error occurred. Please try again.";
  }
}

async function checkFirstAdminPromotion(email, uid) {
  const initSnap = await rtdb.ref('stratum-db/init_flag').once('value');
  if (!initSnap.exists()) {
    const admins = await getRTDBAdminEmails();
    if (!admins.includes(email)) {
      admins.push(email);
      await rtdb.ref('stratum-db/admin_emails').set(admins);
    }
    await rtdb.ref('stratum-db/init_flag').set(true);
    return true;
  }
  return false;
}

/* ============================================================
   TAB SWITCHER
   ============================================================ */
function switchTab(tab) {
  const isSignIn = tab === 'signin';
  
  document.getElementById('tab-signin').classList.toggle('active', isSignIn);
  document.getElementById('tab-signup').classList.toggle('active', !isSignIn);
  
  document.getElementById('signinForm').style.display = isSignIn ? 'block' : 'none';
  document.getElementById('signupForm').style.display = isSignIn ? 'none' : 'block';
  
  document.getElementById('authErrorMsg').classList.remove('show');
}

/* ============================================================
   PASSWORD SHOW/HIDE CONTROLS
   ============================================================ */
function togglePwdVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const container = input.parentElement;
  const svg = container.querySelector('.eyeIcon');
  
  if (input.type === 'password') {
    input.type = 'text';
    if (svg) {
      svg.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;
    }
  } else {
    input.type = 'password';
    if (svg) {
      svg.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    }
  }
}

function showError(msg) {
  const err = document.getElementById('authErrorMsg');
  err.textContent = msg;
  err.classList.add('show');
}

async function handleSignIn() {
  const email = (document.getElementById('signinEmail').value || '').trim().toLowerCase();
  const password = document.getElementById('signinPassword').value;
  
  if (!email || !password) {
    showError("Please enter email and password.");
    return;
  }
  
  try {
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    const user = userCredential.user;
    const admins = await getRTDBAdminEmails();
    
    sessionStorage.setItem('stratum_user_email', user.email);
    
    if (admins.includes(user.email)) {
      sessionStorage.setItem('stratum_user_role', 'admin');
      window.location.href = '/admin';
      return;
    }
    
    const promoted = await checkFirstAdminPromotion(user.email, user.uid);
    if (promoted) {
      sessionStorage.setItem('stratum_user_role', 'admin');
      window.location.href = '/admin';
    } else {
      sessionStorage.setItem('stratum_user_role', 'user');
      window.location.href = 'stratum.html';
    }
  } catch (error) {
    console.error("Sign in failed:", error);
    showError(getFriendlyErrorMessage(error));
  }
}

async function handleSignUp() {
  const name = (document.getElementById('signupName').value || '').trim();
  const email = (document.getElementById('signupEmail').value || '').trim().toLowerCase();
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupConfirm').value;
  
  if (!name || !email || !password || !confirm) {
    showError("Please fill out all signup fields.");
    return;
  }
  if (email.length > 254 || name.length > 80) {
    showError("Input exceeds maximum allowed length.");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError("Please enter a valid email address.");
    return;
  }
  if (password.length < 8) {
    showError("Password must be at least 8 characters.");
    return;
  }
  if (password !== confirm) {
    showError("Passwords do not match.");
    return;
  }
  
  try {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    const user = userCredential.user;
    
    await saveRTDBUser(user.uid, email, name);
    sessionStorage.setItem('stratum_user_email', email);
    
    const admins = await getRTDBAdminEmails();
    if (admins.includes(email)) {
      sessionStorage.setItem('stratum_user_role', 'admin');
      window.location.href = '/admin';
      return;
    }
    
    const promoted = await checkFirstAdminPromotion(email, user.uid);
    if (promoted) {
      sessionStorage.setItem('stratum_user_role', 'admin');
      window.location.href = '/admin';
    } else {
      sessionStorage.setItem('stratum_user_role', 'user');
      window.location.href = 'stratum.html';
    }
  } catch (error) {
    console.error("Sign up failed:", error);
    showError(getFriendlyErrorMessage(error));
  }
}

async function handleForgotPassword() {
  const emailInput = document.getElementById('signinEmail');
  const email = (emailInput ? emailInput.value : '').trim().toLowerCase();
  
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError("Enter your email address in the field above, then click Forgot password.");
    return;
  }
  
  try {
    await auth.sendPasswordResetEmail(email);
    showError("Password reset email sent! Check your inbox.");
  } catch (error) {
    console.error("Password reset failed:", error);
    showError(getFriendlyErrorMessage(error));
  }
}
