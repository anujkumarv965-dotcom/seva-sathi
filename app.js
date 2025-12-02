// ====== CONFIG: YOUR FIREBASE CONFIG (unchanged) ======
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
const storage = firebase.storage();
let messaging = null;

// Small DOM helpers
const $ = id => document.getElementById(id);
const show = el => el && el.classList && el.classList.remove('hidden');
const hide = el => el && el.classList && el.classList.add('hidden');

// Haversine
function haversineKm(lat1, lon1, lat2, lon2){
  if(lat1==null || lon1==null || lat2==null || lon2==null) return Infinity;
  const R = 6371;
  const toRad = v => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*
            Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Splash
setTimeout(()=>{ hide($('splash')); show($('app')); }, 800);

// Menu
$('menuBtn')?.addEventListener('click', ()=> $('sideMenu')?.classList.toggle('hidden'));
$('bookingsBtn')?.addEventListener('click', ()=> openBookingsSection());

// Role
let role = null;
$('roleHelper')?.addEventListener('click', ()=> { role='helper'; hide($('chooseRole')); show($('auth')); $('authTitle').innerText='Register as Helper'; });
$('roleCustomer')?.addEventListener('click', ()=> { role='customer'; hide($('chooseRole')); show($('auth')); $('authTitle').innerText='Register as Customer'; });

// Auth
$('emailSignUp')?.addEventListener('click', async ()=>{
  const email = $('email').value.trim();
  const pw = $('password').value;
  if(!email||!pw) return alert('Email and password required');
  try{
    const userCred = await auth.createUserWithEmailAndPassword(email,pw);
    await afterSignIn(userCred.user);
  }catch(e){ alert(e.message) }
});
$('emailSignIn')?.addEventListener('click', async ()=>{
  const email = $('email').value.trim();
  const pw = $('password').value;
  if(!email||!pw) return alert('Email and password required');
  try{
    const userCred = await auth.signInWithEmailAndPassword(email,pw);
    await afterSignIn(userCred.user);
  }catch(e){ alert(e.message) }
});

// Initialize Firebase Messaging (compat) and request notification permission
const VAPID_KEY = "BD4zGqaIylvpdX0kODavZRA4sWaQ_W3ERX2DMUN55r_DWyC9bYLkl9_UonDj7iHoW2pSUhpHLaxQs5wm0Ypu-DM";

async function initMessagingForUser(){
  if (!('Notification' in window)) {
    console.warn('Notifications not supported');
    return;
  }
  try {
    messaging = firebase.messaging();
  } catch (e) {
    console.warn('Firebase messaging init failed', e);
    return;
  }

  // Request permission
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      console.warn('Notification permission not granted');
      return;
    }
  } catch (e) {
    console.warn('Notification permission error', e);
    return;
  }

  // Register the firebase service worker (must match file name)
  let swReg = null;
  try {
    if ('serviceWorker' in navigator) {
      swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      messaging.useServiceWorker(swReg);
    }
  } catch (e) {
    console.warn('SW registration for FCM failed', e);
  }

  try {
    // Get FCM token (vapid key required)
    const currentToken = await messaging.getToken({ vapidKey: VAPID_KEY });
    if (currentToken) {
      console.log('FCM token:', currentToken);
      // Save token in Firestore under user doc (array union to support multiple devices)
      if (auth.currentUser) {
        await db.collection('users').doc(auth.currentUser.uid).set({
          fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken)
        }, { merge: true });
      }
    } else {
      console.warn('No registration token available. Request permission to generate one.');
    }
  } catch (err) {
    console.warn('An error occurred while retrieving token. ', err);
  }

  // Foreground message handler
  messaging.onMessage(payload => {
    console.log('Message received. ', payload);
    // Show notification in foreground using Notification API
    try {
      const title = payload.notification?.title || payload.data?.title || 'Seva Sathi';
      const body = payload.notification?.body || payload.data?.body || (payload.data && JSON.parse(payload.data.payload || '{}').body) || 'You have a new notification';
      const options = {
        body,
        icon: payload.notification?.icon || '/icons/icon-192.png',
        data: payload.data || {}
      };
      if (Notification.permission === 'granted') {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (reg) reg.showNotification(title, options);
          else new Notification(title, options);
        });
      }
    } catch (e) {
      console.warn('Foreground notification show failed', e);
    }
  });
}

// After sign in
async function afterSignIn(user){
  if(!user) return;
  const uid = user.uid;
  const userRef = db.collection('users').doc(uid);
  const s = await userRef.get();
  if(!s.exists){
    await userRef.set({
      uid, email:user.email||null, phone:user.phoneNumber||null,
      role: role || 'customer',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });
  }

  // Setup messaging for this user (ask permission and get token)
  initMessagingForUser().catch(err => console.warn('initMessaging error', err));

  const doc = await userRef.get();
  const data = doc.data() || {};

  if((data.role||role)==='helper'){
    hide($('auth')); show($('profile'));
  } else {
    hide($('auth')); show($('helpersList'));
    await showHelpersNearUser();
  }

  // If this user is helper, start listening for Firestore notifications to show local notifications
  if ((data.role || role) === 'helper') {
    listenForFirestoreNotifications(uid);
    // set helper availability UI after sign-in
    updateHelperStatusUI(uid);
  }
}

// GPS Promise
function getCurrentPositionPromise(options){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(resolve,reject,options||{enableHighAccuracy:true,timeout:10000});
  });
}

// Save profile
$('saveProfile')?.addEventListener('click', async ()=>{
  const name = $('displayName')?.value.trim();
  const services = [$('serviceSelect')?.value].filter(Boolean);
  const price = $('price')?.value;
  const location = $('locationInput')?.value.trim();
  const phone = $('helperPhone')?.value.trim();
  const user = auth.currentUser;
  if(!user) return alert('Sign in first');

  const userRef = db.collection('users').doc(user.uid);
  const existing = (await userRef.get()).data() || {};

  let lat=null, lng=null;
  if(existing.coords){
    lat=existing.coords.latitude; lng=existing.coords.longitude;
  } else {
    try{
      const pos = await getCurrentPositionPromise();
      lat = pos.coords.latitude; lng = pos.coords.longitude;
    }catch(e){}
  }

  // default availability: available (if not set already)
  const availability = existing.availability || 'available';

  const payload = {
    displayName:name||'', services, location,
    role:'helper', uid:user.uid,
    phone:phone||user.phoneNumber||null, price:price||'',
    availability,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if(lat && lng) payload.coords = new firebase.firestore.GeoPoint(lat,lng);

  await userRef.set(payload, {merge:true});
  alert('Profile saved');
  hide($('profile'));
  show($('helperDashboard'));
  renderHelperDashboard(payload);

  // ensure helper listens for notifications after saving profile
  listenForFirestoreNotifications(user.uid);
  updateHelperStatusUI(user.uid);
});

// Dashboard
function renderHelperDashboard(info){
  $('helperInfo').innerHTML = `
    <h3>${info.displayName||''}</h3>
    <p>Service: ${(info.services||[]).join(', ')}</p>
    <p>Price: ${info.price||''}</p>
    <p>Location: ${info.location||''}</p>
    <p>Phone: ${info.phone||''}</p>`;
}

// Photo upload
const photoInput = $('photoUpload');
const photoPreview = $('photoPreview');
if(photoInput){
  photoInput.addEventListener('change', async e=>{
    const file = e.target.files?.[0];
    if(!file) return;

    photoPreview.src = URL.createObjectURL(file);
    photoPreview.style.display='block';

    if(!auth.currentUser) return alert('Sign in first');

    const uid = auth.currentUser.uid;
    const filename = `${Date.now()}_${file.name.replace(/\s+/g,'_')}`;
    const ref = storage.ref().child(`profile_photos/${uid}/${filename}`);
    const snap = await ref.put(file);
    const url = await snap.ref.getDownloadURL();

    await db.collection('users').doc(uid).set({photoURL:url},{merge:true});
    alert('Photo uploaded!');
  });
}

// Helper list (real-time)
let helpersUnsub = null;
async function showHelpersNearUser(){
  const user = auth.currentUser;
  let custLat=null,custLng=null;

  try{
    const pos = await getCurrentPositionPromise();
    custLat = pos.coords.latitude; custLng = pos.coords.longitude;
  }catch(e){
    const udoc = await db.collection('users').doc(user.uid).get();
    const d = udoc.data()||{};
    if(d.coords){
      custLat=d.coords.latitude; custLng=d.coords.longitude;
    }
  }

  const list = $('list');
  list.innerHTML = 'Loading...';

  // Unsubscribe previous
  if(helpersUnsub) helpersUnsub();

  // Real-time listen to helpers collection
  helpersUnsub = db.collection('users').where('role','==','helper')
    .onSnapshot(snapshot => {
      list.innerHTML = '';
      const helpers = [];
      snapshot.forEach(doc => {
        const d = doc.data();
        d._id = doc.id;
        helpers.push(d);
      });

      // Apply filter (customer-controlled)
      const filter = $('availabilityFilter')?.value || 'all';
      const filtered = helpers.filter(h => {
        if(filter === 'available') return (h.availability === 'available');
        return true;
      });

      // Sort: put available first
      filtered.sort((a,b)=>{
        const rank = statusRank;
        return (rank(a.availability) - rank(b.availability));
      });

      filtered.forEach(d => {
        const hId = d._id || d.uid || 'unknown';
        const card = document.createElement('div');
        card.className='helper-card';
        card.style.display='flex';
        card.style.gap='12px';

        const left = document.createElement('div');
        const img = document.createElement('img');
        img.className='avatar';
        img.alt=d.displayName||'photo';

        img.src = d.photoURL ? d.photoURL :
          'data:image/svg+xml;utf8,' + encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'>
             <rect width='100%' height='100%' fill='#e9eefb'/>
             <text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle'
              font-family='Arial' font-size='64' fill='#5b8cff'>
               ${(d.displayName||'?').charAt(0).toUpperCase()}
             </text>
           </svg>`);

        left.appendChild(img);

        const right = document.createElement('div');

        // status badge
        const statusHtml = renderStatusBadge(d.availability);

        let distHtml='';
        if(custLat!=null && d.coords){
          const km = haversineKm(custLat,custLng,d.coords.latitude,d.coords.longitude);
          distHtml = `<div style="font-weight:600;color:#666">${km.toFixed(1)} km away</div>`;
        }

        right.innerHTML = `
          <strong>${d.displayName||'No name'}</strong>
          <div>${(d.services||[]).join(', ')}</div>
          <div class="helper-meta">
            ${statusHtml}
            <div>${d.location||''}</div>
          </div>
          ${distHtml}
          <button class="hireBtn" data-uid="${d.uid||hId}"
            style="margin-top:8px;background:linear-gradient(90deg,#5b8cff,#7a5bff);color:#fff;border:0;padding:8px;border-radius:8px">
            Hire
          </button>
          <div id="reviews-${hId}" style="margin-top:10px;background:#fafafa;padding:8px;border-radius:6px"></div>
        `;

        card.appendChild(left);
        card.appendChild(right);
        list.appendChild(card);

        renderReviewsForHelper(hId);
      });

      // attach hire button handlers after render
      document.querySelectorAll('.hireBtn').forEach(btn=>{
        btn.onclick = e => requestHire(e.currentTarget.dataset.uid);
      });
  });
}

// ranking for sorting
function statusRank(s){
  if(!s) return 2;
  if(s==='available') return 0;
  if(s==='away') return 1;
  if(s==='busy') return 2;
  return 2;
}

// return HTML for status badge
function renderStatusBadge(status){
  const st = status || 'unknown';
  if(st === 'available') return `<div class="status-badge status-available"><span class="status-dot"></span><span>Available</span></div>`;
  if(st === 'busy') return `<div class="status-badge status-busy"><span class="status-dot"></span><span>Busy</span></div>`;
  if(st === 'away') return `<div class="status-badge status-away"><span class="status-dot"></span><span>Away</span></div>`;
  return `<div class="status-badge"><span class="status-dot" style="background:#ccc"></span><span>Unknown</span></div>`;
}

// Availability controls for helper
$('setAvailable')?.addEventListener('click', ()=> setAvailability('available'));
$('setBusy')?.addEventListener('click', ()=> setAvailability('busy'));
$('setAway')?.addEventListener('click', ()=> setAvailability('away'));

async function setAvailability(value){
  const user = auth.currentUser;
  if(!user) return alert('Please login first');
  try{
    await db.collection('users').doc(user.uid).set({
      availability: value,
      availabilityUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // update UI immediately
    updateHelperStatusUI(user.uid);
  }catch(e){
    console.warn('Failed to set availability', e);
    alert('Could not update status');
  }
}

// update the helper dashboard UI to show current status
async function updateHelperStatusUI(uid){
  if(!uid) return;
  const doc = await db.collection('users').doc(uid).get();
  if(!doc.exists) return;
  const data = doc.data()||{};
  $('currentStatus').innerHTML = renderStatusBadge(data.availability);
}

/* ---------- BOOKING MANAGEMENT (robust listeners) ---------- */

// Opens combined bookings UI depending on role
function openBookingsSection(){
  hideAll();
  if(!auth.currentUser) {
    alert('Please login to see bookings');
    return;
  }
  const uid = auth.currentUser.uid;
  db.collection('users').doc(uid).get().then(d=>{
    const r = d.data()?.role || role;
    if(r === 'helper'){
      show($('bookingsHelper'));
      show($('helperDashboard'));
      listenHelperBookings(uid);
    } else {
      show($('bookingsCustomer'));
      listenCustomerBookings(uid);
    }
  });
}

// Utility: match hire's helper/customer field to given uid (handles plain string, DocumentReference, object)
function hireBelongsTo(hireField, uid){
  if(hireField === undefined || uid === undefined) return false;
  try{
    if(typeof hireField === 'string'){
      if(hireField === uid) return true;
      if(hireField === String(uid)) return true;
    } else if (hireField && typeof hireField === 'object'){
      // Firestore DocumentReference has .id or .path
      if(hireField.id && String(hireField.id) === String(uid)) return true;
      if(hireField.path && hireField.path.includes(String(uid))) return true;
      // sometimes stored as nested object like { uid: 'abc' }
      if(hireField.uid && String(hireField.uid) === String(uid)) return true;
      if(hireField._id && String(hireField._id) === String(uid)) return true;
    }
    return false;
  }catch(e){
    console.warn('hireBelongsTo error', e);
    return false;
  }
}

// Listen real-time for helper bookings — robust client-side filter to handle different stored shapes
let helperBookingsUnsub = null;
function listenHelperBookings(helperUid){
  if(helperBookingsUnsub) helperBookingsUnsub();

  // Listen on the whole hires collection (small apps OK). We'll filter client-side for matches.
  helperBookingsUnsub = db.collection('hires')
    .orderBy('at','desc')
    .onSnapshot(async snap => {
      const list = $('helperBookingsList');
      if(!list) return;
      list.innerHTML = '';
      const items = [];
      snap.forEach(doc => {
        const data = doc.data();
        data.id = doc.id;
        items.push(data);
      });

      // Filter client-side for hires that match this helper UID (robust)
      const matches = items.filter(h => hireBelongsTo(h.helper, helperUid));
      if(matches.length === 0){
        list.innerHTML = `<div class="small-note">No bookings yet.</div>`;
        return;
      }

      // Render matches
      for(const b of matches){
        const card = renderBookingCardForHelper(b);
        list.appendChild(card);
      }
    }, err => {
      console.warn('listenHelperBookings error', err);
      const list = $('helperBookingsList');
      if(list) list.innerHTML = `<div class="small-note">Could not load bookings.</div>`;
    });
}

// Listen real-time for customer bookings — same robust approach
let customerBookingsUnsub = null;
function listenCustomerBookings(customerUid){
  if(customerBookingsUnsub) customerBookingsUnsub();

  customerBookingsUnsub = db.collection('hires')
    .orderBy('at','desc')
    .onSnapshot(async snap => {
      const list = $('customerBookingsList');
      if(!list) return;
      list.innerHTML = '';
      const items = [];
      snap.forEach(doc => {
        const data = doc.data();
        data.id = doc.id;
        items.push(data);
      });

      // Filter for customer's bookings
      const matches = items.filter(h => hireBelongsTo(h.customer, customerUid));
      if(matches.length === 0){
        list.innerHTML = `<div class="small-note">You have no bookings yet.</div>`;
        return;
      }

      for(const b of matches){
        const card = renderBookingCardForCustomer(b);
        list.appendChild(card);
      }
    }, err => {
      console.warn('listenCustomerBookings error', err);
      const list = $('customerBookingsList');
      if(list) list.innerHTML = `<div class="small-note">Could not load bookings.</div>`;
    });
}

/* ---------- Booking rendering & actions (same as before) ---------- */

// Render booking card for helper (controls: Accept/Reject/Complete/Cancel)
function renderBookingCardForHelper(b){
  const card = document.createElement('div');
  card.className = 'booking-card';

  const title = document.createElement('div');
  title.className = 'booking-row';
  title.innerHTML = `<div><strong>Booking: </strong>${b.id}</div><div>${b.at && b.at.toDate ? new Date(b.at.toDate()).toLocaleString() : (b.at? new Date(b.at).toLocaleString() : new Date().toLocaleString())}</div>`;

  const details = document.createElement('div');
  details.className = 'booking-meta';
  details.innerHTML = `
    <div><strong>Customer:</strong> ${b.customer || ''}</div>
    <div><strong>Status:</strong> ${renderStatusPill(b.status)}</div>
    <div class="small-note">Note: ${b.note || 'No additional note'}</div>
  `;

  const actions = document.createElement('div');
  actions.className = 'booking-actions';

  // show action buttons depending on status
  if(b.status === 'requested' || !b.status){
    const accept = document.createElement('button');
    accept.className = 'btn-primary';
    accept.innerText = 'Accept';
    accept.onclick = ()=> updateBookingStatus(b.id, 'accepted', b.customer, b.helper);
    const reject = document.createElement('button');
    reject.className = 'btn-outline';
    reject.innerText = 'Reject';
    reject.onclick = ()=> updateBookingStatus(b.id, 'rejected', b.customer, b.helper);
    actions.appendChild(accept);
    actions.appendChild(reject);
  } else if (b.status === 'accepted'){
    const complete = document.createElement('button');
    complete.className = 'btn-primary';
    complete.innerText = 'Complete';
    complete.onclick = ()=> updateBookingStatus(b.id, 'completed', b.customer, b.helper);
    const cancel = document.createElement('button');
    cancel.className = 'btn-outline';
    cancel.innerText = 'Cancel';
    cancel.onclick = ()=> updateBookingStatus(b.id, 'cancelled', b.customer, b.helper);
    actions.appendChild(complete);
    actions.appendChild(cancel);
  } else {
    const info = document.createElement('div');
    info.innerText = 'No actions available';
    actions.appendChild(info);
  }

  card.appendChild(title);
  card.appendChild(details);
  card.appendChild(actions);
  return card;
}

// Render booking card for customer (shows helper and booking status; customer can cancel when requested/accepted)
function renderBookingCardForCustomer(b){
  const card = document.createElement('div');
  card.className = 'booking-card';

  const title = document.createElement('div');
  title.className = 'booking-row';
  title.innerHTML = `<div><strong>Booking: </strong>${b.id}</div><div>${b.at && b.at.toDate ? new Date(b.at.toDate()).toLocaleString() : (b.at? new Date(b.at).toLocaleString() : new Date().toLocaleString())}</div>`;

  const details = document.createElement('div');
  details.className = 'booking-meta';
  details.innerHTML = `
    <div><strong>Helper:</strong> ${b.helper || ''}</div>
    <div><strong>Status:</strong> ${renderStatusPill(b.status)}</div>
    <div class="small-note">Note: ${b.note || 'No additional note'}</div>
  `;

  const actions = document.createElement('div');
  actions.className = 'booking-actions';

  if(b.status === 'requested' || b.status === 'accepted'){
    const cancel = document.createElement('button');
    cancel.className = 'btn-outline';
    cancel.innerText = 'Cancel';
    cancel.onclick = ()=> updateBookingStatus(b.id, 'cancelled', b.customer, b.helper);
    actions.appendChild(cancel);
  } else {
    const info = document.createElement('div');
    info.innerText = 'No actions available';
    actions.appendChild(info);
  }

  card.appendChild(title);
  card.appendChild(details);
  card.appendChild(actions);
  return card;
}

// small helper to render status pill HTML
function renderStatusPill(status){
  const s = status || 'requested';
  if(s === 'requested') return `<span class="pill pill-requested">Requested</span>`;
  if(s === 'accepted') return `<span class="pill pill-accepted">Accepted</span>`;
  if(s === 'rejected') return `<span class="pill pill-rejected">Rejected</span>`;
  if(s === 'completed') return `<span class="pill pill-completed">Completed</span>`;
  if(s === 'cancelled') return `<span class="pill pill-cancelled">Cancelled</span>`;
  return `<span class="pill pill-requested">${s}</span>`;
}

// Update booking status and write notification documents
async function updateBookingStatus(bookingId, status, customerUid, helperUid){
  try{
    await db.collection('hires').doc(bookingId).update({
      status,
      statusUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // create notification for the other party
    const titleMap = {
      requested: 'Booking requested',
      accepted: 'Booking accepted',
      rejected: 'Booking rejected',
      completed: 'Booking completed',
      cancelled: 'Booking cancelled'
    };
    const bodyMap = {
      requested: 'A new booking request has been created.',
      accepted: 'Your booking request was accepted.',
      rejected: 'Your booking request was rejected.',
      completed: 'Your booking has been marked complete.',
      cancelled: 'A booking was cancelled.'
    };

    // notify customer
    if(customerUid){
      await db.collection('users').doc(customerUid).collection('notifications').add({
        title: titleMap[status] || 'Booking update',
        body: bodyMap[status] || `Booking ${status}`,
        from: auth.currentUser ? auth.currentUser.uid : null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        meta: { type: 'booking', bookingId, status }
      });
    }
    // notify helper
    if(helperUid){
      await db.collection('users').doc(helperUid).collection('notifications').add({
        title: titleMap[status] || 'Booking update',
        body: bodyMap[status] || `Booking ${status}`,
        from: auth.currentUser ? auth.currentUser.uid : null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        meta: { type: 'booking', bookingId, status }
      });
    }

    alert('Booking status updated to: ' + status);

  }catch(e){
    console.warn('Failed to update booking', e);
    alert('Could not update booking status');
  }
}

/* ---------- requestHire (unchanged, writes helper as passed) ---------- */
window.requestHire = async function(helperUid, note = ''){
  const user = auth.currentUser;
  if(!user) return alert('Login first');

  const hireRef = db.collection('hires').doc();
  const payload = {
    customer:user.uid,
    helper:helperUid,
    at: firebase.firestore.FieldValue.serverTimestamp(),
    status:'requested',
    price: '',
    note: note || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await hireRef.set(payload);

  // Create a Firestore notification document for the helper.
  const notif = {
    title: 'New hire request',
    body: `${(auth.currentUser && auth.currentUser.email) ? auth.currentUser.email : 'A customer'} requested a service.`,
    from: user.uid,
    read: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    meta: { type: 'hire-request', hireId: hireRef.id }
  };

  await db.collection('users').doc(helperUid).collection('notifications').add(notif);

  alert('Request sent! Opening chat...');
  openChat(helperUid);

  // Optionally open bookings view for the customer
  show($('bookingsCustomer'));
  listenCustomerBookings(user.uid);
};

/* ---------- Remaining existing app features (reviews, chat, notifications) ---------- */

// Hide all
function hideAll(){
  ['auth','profile','helpersList','settings','about','helperDashboard','chatSection','bookingsCustomer','bookingsHelper']
    .forEach(id=>$(id)?.classList.add('hidden'));
}

// Settings
$('settingsBtn')?.addEventListener('click', ()=>{ hideAll(); show($('settings')); });
$('aboutBtn')?.addEventListener('click', ()=>{ hideAll(); show($('about')); });
$('logoutBtn')?.addEventListener('click', ()=> auth.signOut().then(()=>location.reload()));

$('themeSelect')?.addEventListener('change', e=>{
  e.target.value==='dark'
    ? document.documentElement.setAttribute('data-theme','dark')
    : document.documentElement.removeAttribute('data-theme');
});

// Forgot password
$('forgotBtn')?.addEventListener('click', async ()=>{
  const email = prompt('Enter your email');
  if(!email) return;
  try{
    await auth.sendPasswordResetEmail(email);
    alert('Password reset email sent');
  }catch(e){ alert(e.message); }
});

// Auth listener
auth.onAuthStateChanged(user=>{
  if(user){
    db.collection('users').doc(user.uid).get().then(d=>{
      if(d.exists && d.data().role==='helper'){
        role='helper';
        hide($('chooseRole'));
        hide($('auth'));
        hide($('helpersList'));
        show($('helperDashboard'));
        renderHelperDashboard(d.data());
        // initialize messaging & listen for firestore notifications
        initMessagingForUser().catch(err=>console.warn(err));
        listenForFirestoreNotifications(user.uid);
        updateHelperStatusUI(user.uid);
      } else {
        role='customer';
        hide($('chooseRole'));
        show($('helpersList'));
        showHelpersNearUser();
        // initialize messaging for customers as well
        initMessagingForUser().catch(err=>console.warn(err));
      }
    });
  } else show($('chooseRole'));
});

/* ---------- Reviews (unchanged) ---------- */

// submit review
async function submitReview(helperId, rating, text){
  if(!auth.currentUser) return alert('Login first');
  await db.collection('users').doc(helperId).collection('reviews').add({
    fromUid: auth.currentUser.uid,
    fromEmail: auth.currentUser.email || null,
    rating:Number(rating)||0,
    text:text||'',
    createdAt:firebase.firestore.FieldValue.serverTimestamp()
  });
  renderReviewsForHelper(helperId);
}

// fetch reviews
async function fetchReviewsAndAvg(helperId){
  const snap = await db.collection('users').doc(helperId).collection('reviews')
    .orderBy('createdAt','desc').limit(50).get();
  const reviews=[]; let sum=0;
  snap.forEach(doc=>{
    const d=doc.data();
    reviews.push(d);
    sum+=(d.rating||0);
  });
  return { reviews, avg:reviews.length?sum/reviews.length:0 };
}

// render reviews
async function renderReviewsForHelper(helperId){
  const box = $('reviews-'+helperId);
  if(!box) return;
  box.innerHTML='Loading...';

  const {reviews,avg} = await fetchReviewsAndAvg(helperId);
  box.innerHTML = `<div><strong>Rating:</strong> ${avg?avg.toFixed(1):'No ratings yet'}</div>`;

  if(reviews.length===0){
    box.innerHTML += `<div>No reviews yet</div>`;
  } else {
    reviews.forEach(r=>{
      const el=document.createElement('div');
      el.style.borderTop='1px solid #eee';
      el.style.padding='6px 0';
      const when=r.createdAt?new Date(r.createdAt.seconds*1000).toLocaleString():'';
      el.innerHTML = `
        <div>${r.fromEmail||'User'} — ${'★'.repeat(Math.round(r.rating||0))}</div>
        <div>${r.text||''}</div>
        <div style="font-size:10px;color:#777">${when}</div>`;
      box.appendChild(el);
    });
  }

  const form=document.createElement('div');
  form.innerHTML=`
    <select id="rating-select-${helperId}">
      <option value="5">5 ★</option><option value="4">4 ★</option>
      <option value="3">3 ★</option><option value="2">2 ★</option>
      <option value="1">1 ★</option>
    </select>
    <input id="review-text-${helperId}" placeholder="Write review" />
    <button id="review-submit-${helperId}">Send</button>
  `;
  box.appendChild(form);

  $('review-submit-'+helperId).onclick=()=>{
    const rating=$('rating-select-'+helperId).value;
    const text=$('review-text-'+helperId).value.trim();
    submitReview(helperId,rating,text);
  };
}

/* ------------------ CHAT SYSTEM (unchanged) ------------------ */

let currentChatUser = null;
let chatUnsub = null;

async function openChat(withUid){
  if(!auth.currentUser) return alert("Login first");

  hideAll();
  show($("chatSection"));

  currentChatUser = withUid;
  const other = await db.collection("users").doc(withUid).get();
  $("chatUserName").innerText = "Chat with " + (other.data()?.displayName || "User");

  loadChatMessages();
}

function loadChatMessages(){
  const my = auth.currentUser.uid;
  const them = currentChatUser;
  const chatId = my < them ? `${my}_${them}` : `${them}_${my}`;

  if(chatUnsub) chatUnsub();

  chatUnsub = db.collection("chats")
    .doc(chatId)
    .collection("messages")
    .orderBy("createdAt")
    .onSnapshot(snap=>{
      const box = $("chatMessages");
      box.innerHTML = "";
      snap.forEach(doc=>{
        const m = doc.data();
        const div = document.createElement("div");
        div.classList.add("chat-msg", m.from===my?'chat-me':'chat-them');
        div.innerText = m.text;
        box.appendChild(div);
      });
      box.scrollTop = box.scrollHeight;
    });
}

$("sendChatBtn").addEventListener("click", async ()=>{
  const msg = $("chatInput").value.trim();
  if(!msg) return;
  $("chatInput").value = "";

  const my = auth.currentUser.uid;
  const them = currentChatUser;
  const chatId = my < them ? `${my}_${them}` : `${them}_${my}`;

  await db.collection("chats")
    .doc(chatId)
    .collection("messages")
    .add({
      from: my,
      to: them,
      text: msg,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

  // Also create a Firestore notification for the recipient (for immediate local-notif fallback)
  const notif = {
    title: 'New message',
    body: msg,
    from: my,
    read: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    meta: { type: 'chat', chatId }
  };
  await db.collection('users').doc(them).collection('notifications').add(notif);
});

window._seva = {
  renderReviewsForHelper, fetchReviewsAndAvg,
  submitReview, showHelpersNearUser
};

// Listen for Firestore notifications (helper or any user) and show local notifications
let notifUnsub = null;
function listenForFirestoreNotifications(uid){
  if(notifUnsub) notifUnsub(); // unsubscribe previous
  notifUnsub = db.collection('users').doc(uid).collection('notifications')
    .orderBy('createdAt','desc')
    .limit(20)
    .onSnapshot(snap=>{
      snap.docChanges().forEach(change=>{
        if(change.type === 'added'){
          const data = change.doc.data();
          // Show notification (if permission granted)
          if (Notification.permission === 'granted') {
            const title = data.title || 'Seva Sathi';
            const opts = {
              body: data.body || '',
              icon: '/icons/icon-192.png',
              data: data.meta || {}
            };
            navigator.serviceWorker.getRegistration().then(reg=>{
              if(reg) reg.showNotification(title, opts);
              else new Notification(title, opts);
            });
          }
        }
      });
    });
}