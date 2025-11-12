// ====== CONFIG: REPLACE WITH YOUR_FIREBASE_CONFIG ======
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

// Helpers for UI
const $ = id => document.getElementById(id);
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

// Small utility: Haversine distance in kilometers
function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371;
  const toRad = v => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Splash -> app
setTimeout(() => {
  hide($('splash'));
  show($('app'));
}, 900);

// Menu
$('menuBtn').onclick = () => $('sideMenu').classList.toggle('hidden');

// Role selection
let role = null;
$('roleHelper').onclick = () => {
  role = 'helper';
  hide($('chooseRole'));
  show($('auth'));
  $('authTitle').innerText = 'Register as Helper';
};
$('roleCustomer').onclick = () => {
  role = 'customer';
  hide($('chooseRole'));
  show($('auth'));
  $('authTitle').innerText = 'Register as Customer';
};

// Email sign up / sign in
$('emailSignUp').onclick = async () => {
  const email = $('email').value.trim(),
    pw = $('password').value;
  if (!email || !pw) return alert('Email and password required');
  try {
    const userCred = await auth.createUserWithEmailAndPassword(email, pw);
    await db.collection('users').doc(userCred.user.uid).set(
      {
        role: role || 'customer',
        email: email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await afterSignUp(userCred.user);
  } catch (e) {
    alert(e.message);
  }
};
$('emailSignIn').onclick = async () => {
  const email = $('email').value.trim(),
    pw = $('password').value;
  if (!email || !pw) return alert('Email and password required');
  try {
    const userCred = await auth.signInWithEmailAndPassword(email, pw);
    await afterSignIn(userCred.user);
  } catch (e) {
    alert(e.message);
  }
};

// After sign-up
async function afterSignUp(user) {
  const doc = await db.collection('users').doc(user.uid).get();
  const data = doc.exists ? doc.data() : {};
  if ((data.role || role) === 'helper') {
    hide($('auth'));
    show($('profile'));
    if (user.phoneNumber) $('helperPhone').value = user.phoneNumber;
    if (user.displayName) $('displayName').value = user.displayName;
  } else {
    hide($('auth'));
    show($('helpersList'));
    getCustomerLocationAndShowHelpers();
  }
}

// After sign-in
async function afterSignIn(user) {
  const ref = db.collection('users').doc(user.uid);
  const doc = await ref.get();
  role = doc.exists ? doc.data().role : 'customer';
  if (role === 'helper') {
    hide($('auth')); hide($('chooseRole')); hide($('helpersList'));
    show($('helperDashboard'));
    renderHelperDashboard(doc.data());
  } else {
    hide($('auth')); hide($('chooseRole')); hide($('helperDashboard'));
    show($('helpersList'));
    getCustomerLocationAndShowHelpers();
  }
}

// Save Helper profile
$('saveProfile').onclick = async () => {
  const user = auth.currentUser;
  if (!user) return alert('Not signed in');
  const ref = db.collection('users').doc(user.uid);

  const name = $('displayName').value.trim();
  const services = [$('serviceSelect').value];
  const price = $('price').value;
  const location = $('locationInput').value.trim();
  const phone = $('helperPhone').value.trim();

  let lat = null, lng = null;
  try {
    const pos = await getCurrentPositionPromise({ enableHighAccuracy: true, timeout: 7000 });
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
  } catch (err) {}

  await ref.set(
    {
      displayName: name,
      services,
      price,
      location,
      phone,
      role: 'helper',
      latitude: lat,
      longitude: lng,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  alert('Profile saved!');
  hide($('profile'));
  show($('helperDashboard'));
  renderHelperDashboard({ displayName: name, services, price, location, phone });
};

// Render Helper Dashboard
function renderHelperDashboard(info) {
  $('helperInfo').innerHTML = `
    <h3>${info.displayName || ''}</h3>
    <p>Service: ${(info.services || []).join(', ')}</p>
    <p>Price: ${info.price || ''}</p>
    <p>Location: ${info.location || ''}</p>
    <p>Phone: ${info.phone || ''}</p>`;
}

// Geolocation Promise
function getCurrentPositionPromise(opt) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) rej('Geolocation not supported');
    navigator.geolocation.getCurrentPosition(res, rej, opt);
  });
}

// Show helpers near customer
async function getCustomerLocationAndShowHelpers() {
  let lat = null, lng = null;
  try {
    const pos = await getCurrentPositionPromise({ enableHighAccuracy: true, timeout: 10000 });
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
  } catch (e) {
    const manual = prompt('Allow location or type your area name (e.g. "Downtown"):');
    if (manual) return showHelpersByTextLocation(manual);
    alert('Location required.');
    return;
  }

  const radiusKm = 10;
  const snap = await db.collection('users').where('role', '==', 'helper').get();
  const list = $('list');
  list.innerHTML = '';
  const helpers = [];

  snap.forEach(doc => {
    const d = doc.data();
    if (!d.latitude || !d.longitude) return;
    const dist = haversineKm(lat, lng, d.latitude, d.longitude);
    if (dist <= radiusKm) helpers.push({ ...d, dist });
  });

  helpers.sort((a, b) => a.dist - b.dist);
  if (!helpers.length) return (list.innerHTML = `<p>No helpers found within ${radiusKm} km.</p>`);

  helpers.forEach(d => {
    const div = document.createElement('div');
    div.className = 'helper-card';
    div.innerHTML = `
      <h3>${d.displayName || 'No name'}</h3>
      <p>${(d.services || []).join(', ')}</p>
      <p>Price: ${d.price || ''}</p>
      <p>Location: ${d.location || ''}</p>
      <p>Phone: ${d.phone || ''}</p>
      <p>Distance: ${d.dist.toFixed(1)} km</p>
      <button class="btn-primary" onclick="requestHire('${d.uid}')">Hire</button>`;
    list.appendChild(div);
  });
}

// Fallback text search
async function showHelpersByTextLocation(text) {
  const list = $('list');
  const q = text.toLowerCase();
  const snap = await db.collection('users').where('role', '==', 'helper').get();
  list.innerHTML = '';
  snap.forEach(doc => {
    const d = doc.data();
    if ((d.location || '').toLowerCase().includes(q)) {
      const div = document.createElement('div');
      div.className = 'helper-card';
      div.innerHTML = `
        <h3>${d.displayName}</h3>
        <p>${(d.services || []).join(', ')}</p>
        <p>Price: ${d.price}</p>
        <p>Location: ${d.location}</p>
        <p>Phone: ${d.phone}</p>`;
      list.appendChild(div);
    }
  });
}

// Hire request
window.requestHire = async function(helperUid) {
  const user = auth.currentUser;
  if (!user) return alert('Login first');
  await db.collection('hires').add({
    customer: user.uid,
    helper: helperUid,
    at: firebase.firestore.FieldValue.serverTimestamp()
  });
  alert('Request sent!');
};

// ===== MENU BUTTONS =====
$('logoutBtn').onclick = () => auth.signOut().then(() => location.reload());
$('settingsBtn').onclick = () => {
  hideAll();
  show($('settings'));
  $('sideMenu').classList.add('hidden');
};
$('aboutBtn').onclick = () => {
  hideAll();
  show($('about'));
  $('sideMenu').classList.add('hidden');
};
function hideAll() {
  ['auth', 'profile', 'helpersList', 'settings', 'about', 'helperDashboard']
    .forEach(id => $(id).classList.add('hidden'));
}

// ========= THEME TOGGLE WITH MEMORY ========= //
window.addEventListener('load', () => {
  const savedTheme = localStorage.getItem('sevaTheme');
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    $('themeSelect').value = 'dark';
  } else {
    document.documentElement.removeAttribute('data-theme');
    $('themeSelect').value = 'light';
  }
});

$('themeSelect').onchange = (e) => {
  const theme = e.target.value;
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('sevaTheme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('sevaTheme', 'light');
  }
};

// Forgot password
$('forgotBtn').onclick = async () => {
  const email = prompt('Enter your account email');
  if (!email) return;
  try {
    await auth.sendPasswordResetEmail(email);
    alert('Password reset email sent!');
  } catch (e) {
    alert(e.message);
  }
};

// Auth listener
auth.onAuthStateChanged(user => {
  if (user) {
    db.collection('users').doc(user.uid).get().then(d => {
      if (d.exists && d.data().role === 'helper') {
        role = 'helper';
        hide($('chooseRole')); hide($('auth')); hide($('helpersList'));
        show($('helperDashboard'));
        renderHelperDashboard(d.data());
      } else {
        role = 'customer';
        hide($('chooseRole')); hide($('auth')); hide($('helperDashboard'));
        show($('helpersList'));
        getCustomerLocationAndShowHelpers();
      }
    });
  } else {
    show($('chooseRole'));
  }
});