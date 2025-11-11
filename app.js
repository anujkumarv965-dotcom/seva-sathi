// ====== CONFIG: REPLACE WITH YOUR FIREBASE CONFIG ======
const firebaseConfig = {
  apiKey: "AIzaSyCjgaTzSx3C6z1eWH4xRAGiHIwVYiRgfrM",
  authDomain: "seva-sathi-49ab3.firebaseapp.com",
  projectId: "seva-sathi-49ab3",
  storageBucket: "seva-sathi-49ab3.firebasestorage.app",
  messagingSenderId: "517044329871",
  appId: "1:517044329871:web:613c1c3cfb6a62dfa37ffa"
};
// =======================================================
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Simple UI helpers
const $ = id => document.getElementById(id);
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

// Splash → app
setTimeout(()=>{ hide($('splash')); show($('app')); }, 1500);

// Menu
$('menuBtn').onclick = ()=> $('sideMenu').classList.toggle('hidden');

// Role selection
let role = null;
$('roleHelper').onclick = ()=> { role='helper'; $('chooseRole').classList.add('hidden'); $('auth').classList.remove('hidden'); $('authTitle').innerText = 'Register as Helper'; }
$('roleCustomer').onclick = ()=> { role='customer'; $('chooseRole').classList.add('hidden'); $('auth').classList.remove('hidden'); $('authTitle').innerText = 'Register as Customer'; }

// Email sign up / sign in
$('emailSignUp').onclick = async ()=>{
  const email = $('email').value.trim(), pw = $('password').value;
  if(!email||!pw) return alert('Email and password required');
  try{
    const userCred = await auth.createUserWithEmailAndPassword(email,pw);
    await afterSignIn(userCred.user);
  }catch(e){ alert(e.message) }
};
$('emailSignIn').onclick = async ()=>{
  const email = $('email').value.trim(), pw = $('password').value;
  if(!email||!pw) return alert('Email and password required');
  try{
    const userCred = await auth.signInWithEmailAndPassword(email,pw);
    await afterSignIn(userCred.user);
  }catch(e){ alert(e.message) }
};

// Phone auth (OTP)
$('sendOtp').onclick = async ()=>{
  const phone = $('phone').value.trim();
  if(!phone) return alert('Enter phone with country code (+91...)');
  // setup recaptcha (invisible)
  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container',{size:'invisible'});
  try{
    const confirmationResult = await auth.signInWithPhoneNumber(phone, window.recaptchaVerifier);
    window.confirmationResult = confirmationResult;
    $('otpBlock').classList.remove('hidden');
    alert('OTP sent');
  }catch(e){ alert('OTP error: '+e.message) }
};
$('verifyOtp').onclick = async ()=>{
  const code = $('otp').value.trim();
  if(!code) return alert('Enter OTP');
  try{
    const res = await window.confirmationResult.confirm(code);
    await afterSignIn(res.user);
  }catch(e){ alert('OTP verify error: '+e.message) }
};

// After sign in: fill role-specific profile or show list
async function afterSignIn(user){
  const uid = user.uid;
  // store basic profile if doesn't exist
  const userRef = db.collection('users').doc(uid);
  const doc = await userRef.get();
  if(!doc.exists){
    // set base fields
    await userRef.set({
      uid, email:user.email||null, phone:user.phoneNumber||null, role:role||'customer',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  // if helper -> ask to complete profile
  const uDoc = await userRef.get();
  const data = uDoc.data();
  if(data.role === 'helper'){
    $('auth').classList.add('hidden');
    $('profile').classList.remove('hidden');
  }else{
    // customer view: show helpers near them
    $('auth').classList.add('hidden');
    $('helpersList').classList.remove('hidden');
    showHelpersNearUser();
  }
}

// Save profile (for helpers)
$('saveProfile').onclick = async ()=>{
  const name = $('displayName').value.trim();
  const services = Array.from($('serviceSelect').selectedOptions).map(o=>o.value);
  const location = $('locationInput').value.trim();
  const user = auth.currentUser;
  if(!user) return alert('Not signed in');
  const userRef = db.collection('users').doc(user.uid);
  await userRef.set({
    displayName:name, services, location, role:'helper', uid:user.uid, phone:user.phoneNumber||null, email:user.email||null
  }, {merge:true});
  alert('Profile saved');
  $('profile').classList.add('hidden');
  // go to customer view or helper view
  if(role==='helper') showHelperDashboard();
};

// Show helper dashboard (simple)
function showHelperDashboard(){
  $('main').innerHTML = `<div class="card"><h2>Welcome Helper</h2><p>Profile saved.</p></div>`;
}

// Show helpers near user (simple text match with location)
async function showHelpersNearUser(){
  // Get user saved location (you could use geolocation API for precise distance)
  const user = auth.currentUser;
  const uDoc = await db.collection('users').doc(user.uid).get();
  const userLoc = (uDoc.exists && uDoc.data().location) || '';
  const list = $('list');
  list.innerHTML = 'Loading...';
  const snap = await db.collection('users').where('role','==','helper').get();
  list.innerHTML = '';
  snap.forEach(doc=>{
    const d = doc.data();
    // very simple proximity: contains same area keyword
    const near = userLoc && d.location && d.location.toLowerCase().includes(userLoc.split(' ')[0].toLowerCase());
    const card = document.createElement('div'); card.className='helper';
    card.innerHTML = `<strong>${d.displayName||'No name'}</strong><div>${(d.services||[]).join(', ')}</div><div>${d.location||''}</div>
      <button onclick="requestHire('${d.uid}')">Hire</button>`;
    if(near) card.style.borderLeft='4px solid var(--accent)';
    list.appendChild(card);
  });
}
window.requestHire = async function(helperUid){
  const user = auth.currentUser;
  if(!user) return alert('Login first');
  const hireRef = db.collection('hires').doc();
  await hireRef.set({ customer:user.uid, helper:helperUid, at: firebase.firestore.FieldValue.serverTimestamp(), status:'requested' });
  alert('Request sent to helper');
}

// Logout & menu
$('logoutBtn').onclick = ()=> auth.signOut().then(()=> location.reload());
$('settingsBtn').onclick = ()=> { hideAll(); $('settings').classList.remove('hidden'); };
$('aboutBtn').onclick = ()=> { hideAll(); $('about').classList.remove('hidden'); };
function hideAll(){
  ['auth','profile','helpersList','settings','about'].forEach(id=>$(id).classList.add('hidden'));
}

// Theme selection
$('themeSelect').onchange = (e)=>{
  const v = e.target.value;
  if(v==='dark') document.documentElement.setAttribute('data-theme','dark');
  else if(v==='light') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.removeAttribute('data-theme');
};

// Forgot password
$('forgotBtn').onclick = async ()=>{
  const email = prompt('Enter your account email to reset password');
  if(!email) return;
  try{ await auth.sendPasswordResetEmail(email); alert('Password reset sent to email'); } catch(e){ alert(e.message) }
};

// Auto-auth listener
auth.onAuthStateChanged(user=>{
  if(user){
    // if already logged in, set role from DB then go to app
    db.collection('users').doc(user.uid).get().then(d=>{
      if(d.exists && d.data().role==='helper'){ role='helper'; showHelperDashboard(); } 
      else { role='customer'; $('chooseRole').classList.add('hidden'); $('helpersList').classList.remove('hidden'); showHelpersNearUser(); }
    });
  } else {
    // show choose role
    $('chooseRole').classList.remove('hidden');
  }
});