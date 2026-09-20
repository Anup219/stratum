/* ============================================================
   FIREBASE CONFIGURATION
   ============================================================
   INSTRUCTIONS:
   1. Go to https://console.firebase.google.com
   2. Select your project → Project Settings (gear icon)
   3. Scroll to "Your apps" → click your web app (or add one)
   4. Copy the firebaseConfig object values below
   ============================================================ */


const firebaseConfig = {
  apiKey: "AIzaSyAnAhZz8FNExu35jqU3EImBdLTQ0ZCYEu4",
  authDomain: "stratum-set.firebaseapp.com",
  databaseURL: "https://stratum-set-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "stratum-set",
  storageBucket: "stratum-set.firebasestorage.app",
  messagingSenderId: "970198506960",
  appId: "1:970198506960:web:35847d739b459c18b1edd5",
  measurementId: "G-V4YG5FDXYG"
};

firebase.initializeApp(firebaseConfig);

/* Shared Firebase service handles used across all pages */
const rtdb = firebase.database();   // Realtime Database
const fbStorage = firebase.storage();    // Cloud Storage for models
const auth = firebase.auth();        // Firebase Authentication

/* ============================================================
   KEY HELPERS
   Firebase RTDB keys cannot contain: . # $ [ ]
   We encode email dots as commas for user keys
   ============================================================ */
function emailToKey(email) {
  return email.replace(/\./g, ',');
}

function keyToEmail(key) {
  return key.replace(/,/g, '.');
}
