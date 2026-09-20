/* ============================================================
   FIREBASE CONFIGURATION TEMPLATE
   ============================================================
   INSTRUCTIONS:
   1. Copy this file to `firebase-config.js`
   2. Go to https://console.firebase.google.com
   3. Select your project → Project Settings (gear icon)
   4. Scroll to "Your apps" → click your web app (or add one)
   5. Fill in the values below with your credentials
   ============================================================ */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};

firebase.initializeApp(firebaseConfig);

/* Shared Firebase service handles used across all pages */
const rtdb = firebase.database();        // Realtime Database
const fbStorage = firebase.storage();    // Cloud Storage for models
const auth = firebase.auth();            // Firebase Authentication

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
