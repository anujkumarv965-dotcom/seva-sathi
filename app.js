// ====== CONFIG: YOUR FIREBASE CONFIG ======
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

// Dom helpers
const $ = id => document.getElementById(id);
const show = el => el && el.classList && el.classList.remove('hidden');
const hide = el => el && el.classList && el.classList.add('hidden');

// Utility: haversine
function haversineKm(lat1, lon1, lat2, lon2){
  if(lat1==null || lon1==null || lat2==null || lon2==null) return Infinity;
  const R = 6371; const toRad = v => v*Math.PI/180;
  const dLat = toRad(lat2-lat1); const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

// Splash
setTimeout(()=>{ hide($('splash')); show($('app')); }, 700);

// Menu toggle
$('menuBtn')?.addEventListener('click', ()=> $('sideMenu')?.classList.toggle('hidden'));

// Role selection
let role = null;
$('roleHelper')?.addEventListener('click', ()=> { role='helper'; hide($('chooseRole')); show($('auth')); $('authTitle').innerText='Register as Helper'; });
$('roleCustomer')?.addEventListener('click', ()=> { role='customer'; hide($('chooseRole')); show($('auth')); $('authTitle').innerText='Register as Customer'; });

// Auth handlers
$('emailSignUp')?.addEventListener('click', async ()=>{
  const email = $('email').value.trim(), pw = $('password').value;
  if(!email||!pw) return alert('Email and password required');
  try{ const u = await auth.createUserWithEmailAndPassword(email,pw); await afterSignIn(u.user); } catch(e){ alert(e.message) }
});
$('emailSignIn')?.addEventListener('click', async ()=>{
  const email = $('email').value.trim(), pw = $('password').value;
  if(!email||!pw) return alert('Email and password required');
  try{ const u = await auth.signInWithEmailAndPassword(email,pw); await afterSignIn(u.user); } catch(e){ alert(e.message) }
});

// OTP (if used)
$('sendOtp')?.addEventListener('click', async ()=>{
  const phone = $('phone')?.value.trim();
  if(!phone) return alert('Enter phone with country code (+91...)');
  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container',{size:'invisible'});
  try{ const confirmationResult = await auth.signInWithPhoneNumber(phone, window.recaptchaVerifier); window.confirmationResult = confirmationResult; $('otp')?.classList.remove('hidden'); alert('OTP sent'); } catch(e){ alert('OTP error: '+e.message) }
});
$('verifyOtp')?.addEventListener('click', async ()=>{
  const code = $('otp')?.value.trim(); if(!code) return alert('Enter OTP');
  try{ const res = await window.confirmationResult.confirm(code); await afterSignIn(res.user); } catch(e){ alert('OTP verify error: '+e.message) }
});

// after sign in or sign up
async function afterSignIn(user){
  if(!user) return;
  const uid = user.uid;
  const userRef = db.collection('users').doc(uid);
  const s = await userRef.get();
  if(!s.exists){
    await userRef.set({ uid, email:user.email||null, phone:user.phoneNumber||null, role: role || 'customer', createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
  }
  const doc = await userRef.get(); const data = doc.exists?doc.data():{};
  if((data.role || role) === 'helper'){
    hide($('auth')); show($('profile'));
    if(user.phoneNumber) $('helperPhone').value = user.phoneNumber;
    if(user.displayName) $('displayName').value = user.displayName;
    if(data.photoURL){ const p=$('photoPreview'); if(p){ p.src=data.photoURL; p.style.display='block'; } }
  } else {
    hide($('auth')); show($('helpersList')); await refreshHelpers(); 
  }
}

// geolocation helper
function getCurrentPositionPromise(options){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, options || { enableHighAccuracy:true, timeout:10000 });
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
  let lat=null,lng=null;
  const existing = (await userRef.get()).data() || {};
  if(existing.coords && existing.coords.latitude && existing.coords.longitude){ lat = existing.coords.latitude; lng = existing.coords.longitude; }
  else {
    try{ const pos = await getCurrentPositionPromise({ enableHighAccuracy:true, timeout:8000 }); lat = pos.coords.latitude; lng = pos.coords.longitude; } catch(e){}
  }
  const payload = { displayName: name || '', services, location, role:'helper', uid:user.uid, phone: phone || user.phoneNumber || null, price: price || '', updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  if(lat && lng) payload.coords = new firebase.firestore.GeoPoint(lat,lng);
  await userRef.set(payload, { merge:true });
  alert('Profile saved'); hide($('profile')); show($('helperDashboard')); renderHelperDashboard(payload);
});

// helper dashboard
function renderHelperDashboard(info){
  const el = $('helperInfo'); if(!el) return;
  el.innerHTML = `<h3>${info.displayName||''}</h3><p>Service: ${(info.services||[]).join(', ')}</p><p>Price: ${info.price||''}</p><p>Location: ${info.location||''}</p><p>Phone: ${info.phone||''}</p>`;
}

// photo upload preview + upload
const photoInput = $('photoUpload'), photoPreview = $('photoPreview');
if(photoInput){
  photoInput.addEventListener('change', async (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const objectUrl = URL.createObjectURL(file);
    if(photoPreview){ photoPreview.src = objectUrl; photoPreview.style.display='block'; }
    if(!auth.currentUser){ alert('Please sign in to upload your profile photo.'); return; }
    try{
      photoInput.disabled = true;
      const uid = auth.currentUser.uid;
      const filename = `${Date.now()}_${file.name.replace(/\s+/g,'_')}`;
      const ref = storage.ref().child(`profile_photos/${uid}/${filename}`);
      const snap = await ref.put(file);
      const url = await snap.ref.getDownloadURL();
      await db.collection('users').doc(uid).set({ photoURL: url }, { merge:true });
      alert('Profile photo uploaded!');
      photoInput.disabled = false;
      refreshHelpers();
    }catch(err){ console.error('photo upload error', err); alert('Upload failed: ' + (err.message || err)); photoInput.disabled = false; }
  });
}

/* ------------------ Map + Filter + List ------------------ */
/*
 UI elements:
  - filterMode (select), radiusInput, filterText, applyFilterBtn (list)
  - mapFilterMode, mapRadiusInput, mapFilterText, mapApplyBtn (map)
  - viewMapBtn, backToListBtn
*/
const viewMapBtn = $('viewMapBtn'), backToListBtn = $('backToListBtn');
const filterMode = $('filterMode'), radiusInput = $('radiusInput'), filterText = $('filterText'), applyFilterBtn = $('applyFilterBtn');
const mapFilterMode = $('mapFilterMode'), mapRadiusInput = $('mapRadiusInput'), mapFilterText = $('mapFilterText'), mapApplyBtn = $('mapApplyBtn');

let leafletMap = null, markersLayer = null, currentHelpersCache = [];

/* show/hide filter inputs depending on choice */
function updateFilterUI(selectEl, radiusEl, textEl){
  const v = selectEl.value;
  if(v === 'radius'){ radiusEl.style.display = 'inline-block'; textEl.style.display = 'none'; }
  else if(v === 'text'){ radiusEl.style.display = 'none'; textEl.style.display = 'inline-block'; }
  else { radiusEl.style.display = 'none'; textEl.style.display = 'none'; }
}
if(filterMode) filterMode.addEventListener('change', ()=> updateFilterUI(filterMode, radiusInput, filterText));
if(mapFilterMode) mapFilterMode.addEventListener('change', ()=> updateFilterUI(mapFilterMode, mapRadiusInput, mapFilterText));

// apply filter button handlers (they just call refreshHelpers)
applyFilterBtn?.addEventListener('click', ()=> refreshHelpers());
mapApplyBtn?.addEventListener('click', ()=> {
  // copy map filter choices to top controls so list and map sync
  if(mapFilterMode && filterMode) filterMode.value = mapFilterMode.value;
  if(mapRadiusInput && radiusInput) radiusInput.value = mapRadiusInput.value;
  if(mapFilterText && filterText) filterText.value = mapFilterText.value;
  refreshHelpers();
});

// Toggle map/list
viewMapBtn?.addEventListener('click', async ()=>{
  hide($('helpersList'));
  show($('mapSection'));
  await ensureMapInitialized();
  placeMarkersFromCache();
});
backToListBtn?.addEventListener('click', ()=>{
  hide($('mapSection'));
  show($('helpersList'));
});

// Ensure map exists
async function ensureMapInitialized(){
  if(leafletMap) return;
  // create map
  leafletMap = L.map('map', { zoomControl:true }).setView([20,78], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '' }).addTo(leafletMap);
  markersLayer = L.layerGroup().addTo(leafletMap);
}

/* Fetch helpers, filter, sort, display list & store cache for the map */
async function refreshHelpers(){
  // get raw helper docs
  try{
    const snap = await db.collection('users').where('role','==','helper').get();
    const helpers = [];
    snap.forEach(doc=>{
      const d = doc.data(); d._id = doc.id; helpers.push(d);
    });
    currentHelpersCache = helpers; // store for map
    // apply filter & sort
    const filtered = await applyFilterAndSort(helpers);
    renderHelpersList(filtered);
    // if map visible, update markers too
    if(leafletMap) placeMarkers(filtered);
  }catch(err){
    console.error('refreshHelpers err', err);
    alert('Failed to load helpers: ' + (err.message||err));
  }
}

/* Apply the chosen filter and return sorted helpers array */
async function applyFilterAndSort(helpers){
  const mode = filterMode ? filterMode.value : 'all';
  let custLat = null, custLng = null;
  // attempt to get current user coords (GPS) to calculate distances
  try{
    const pos = await getCurrentPositionPromise({enableHighAccuracy:true, timeout:8000});
    custLat = pos.coords.latitude; custLng = pos.coords.longitude;
  }catch(e){
    try{
      const u = auth.currentUser;
      if(u){
        const ud = (await db.collection('users').doc(u.uid).get()).data();
        if(ud && ud.coords){ custLat = ud.coords.latitude; custLng = ud.coords.longitude; }
      }
    }catch(err){}
  }

  // filtering
  let result = helpers.slice(); // copy

  if(mode === 'radius'){
    const rk = Number(radiusInput?.value || 10);
    if(isNaN(rk) || rk <= 0){ alert('Enter a valid radius in km'); return []; }
    result = result.filter(h => {
      if(!h.coords || h.coords.latitude==null) return false;
      const km = haversineKm(custLat, custLng, h.coords.latitude, h.coords.longitude);
      return km <= rk;
    });
  } else if(mode === 'text'){
    const q = (filterText?.value || '').trim().toLowerCase();
    if(!q) { alert('Enter text to search by area'); return []; }
    result = result.filter(h => (h.location || '').toLowerCase().includes(q) || (h.displayName||'').toLowerCase().includes(q));
  } // else 'all' => keep all

  // compute distance if coords available and sort nearest-first if we have cust coords
  if(custLat!=null){
    result.forEach(h => {
      if(h.coords && h.coords.latitude!=null){ h._distanceKm = haversineKm(custLat, custLng, h.coords.latitude, h.coords.longitude); }
      else h._distanceKm = Infinity;
    });
    result.sort((a,b)=> (a._distanceKm||Infinity) - (b._distanceKm||Infinity));
  }

  return result;
}

/* Render helpers on the HTML list (keeps reviews rendering) */
function renderHelpersList(helpers){
  const list = $('list');
  list.innerHTML = '';
  if(!helpers || helpers.length===0){ list.innerHTML = '<div>No helpers found.</div>'; return; }
  helpers.forEach(h=>{
    const helperId = h._id || h.uid || '';
    const card = document.createElement('div');
    card.className = 'helper-card';
    card.style.display='flex'; card.style.gap='12px'; card.style.alignItems='flex-start';
    card.style.padding='12px'; card.style.borderRadius='8px'; card.style.marginBottom='10px';
    card.style.background='#fff';

    // avatar
    const left = document.createElement('div'); left.style.flex='0 0 72px'; left.style.display='flex'; left.style.alignItems='center'; left.style.justifyContent='center';
    const img = document.createElement('img'); img.className='avatar'; img.style.width='64px'; img.style.height='64px';
    if(h.photoURL) img.src = h.photoURL;
    else {
      const letter = (h.displayName && h.displayName.charAt(0).toUpperCase()) || '?';
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' fill='#e9eefb'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-family='Arial' font-size='64' fill='#5b8cff'>${letter}</text></svg>`;
      img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
    left.appendChild(img);

    // right
    const right = document.createElement('div'); right.style.flex='1';
    const title = document.createElement('div'); title.innerHTML = `<strong style="font-size:16px">${h.displayName || 'No name'}</strong>`;
    const services = document.createElement('div'); services.style.color='#444'; services.style.fontSize='13px'; services.textContent = (h.services||[]).join(', ');
    const location = document.createElement('div'); location.style.color='#666'; location.style.fontSize='13px'; location.style.marginTop='6px'; location.textContent = h.location || '';
    const infoArea = document.createElement('div');
    if(h._distanceKm && isFinite(h._distanceKm)) infoArea.innerHTML = `<div style="margin-top:6px;font-weight:600;color:#666">${h._distanceKm.toFixed(1)} km away</div>`;
    const action = document.createElement('div'); action.style.marginTop='8px'; action.innerHTML = `<button class="hireBtn" data-uid="${h.uid || helperId}" style="background:linear-gradient(90deg,#5b8cff,#7a5bff);color:#fff;border:0;padding:8px;border-radius:8px">Hire</button>`;

    right.appendChild(title); right.appendChild(services); right.appendChild(location); right.appendChild(infoArea); right.appendChild(action);
    // reviews container (renderReviewsForHelper will fill)
    const reviewsContainer = document.createElement('div'); reviewsContainer.id = 'reviews-' + helperId; reviewsContainer.style.marginTop='10px'; reviewsContainer.style.background='#fafafa'; reviewsContainer.style.padding='8px'; reviewsContainer.style.borderRadius='6px';
    right.appendChild(reviewsContainer);

    card.appendChild(left); card.appendChild(right);
    list.appendChild(card);

    // render reviews
    if(typeof renderReviewsForHelper === 'function') renderReviewsForHelper(helperId);
  });

  // attach hire handlers
  document.querySelectorAll('.hireBtn').forEach(b=> b.onclick = (e)=> { const uid = e.currentTarget.dataset.uid; requestHire(uid); });
}

/* Map markers helpers */
function placeMarkers(helpers){
  if(!leafletMap || !markersLayer) return;
  markersLayer.clearLayers();
  helpers.forEach(h=>{
    if(!h.coords || h.coords.latitude==null) return;
    const lat = h.coords.latitude, lng = h.coords.longitude;
    const title = h.displayName || 'Helper';
    const popupHtml = `<strong>${title}</strong><div>${(h.services||[]).join(', ')}</div><div>Price: ${h.price||''}</div>`;
    const marker = L.marker([lat,lng]);
    marker.bindPopup(popupHtml);
    markersLayer.addLayer(marker);
  });
  // fit bounds if markers exist
  const layerBounds = markersLayer.getBounds();
  if(layerBounds && layerBounds.isValid && !layerBounds.isValid()) {
    // invalid -> no markers
  } else if(layerBounds && layerBounds.isValid && layerBounds.isValid()){
    leafletMap.fitBounds(layerBounds.pad(0.2));
  } else if(markersLayer.getLayers().length > 0) {
    try { leafletMap.fitBounds(markersLayer.getBounds().pad(0.2)); } catch(e){}
  }
}

/* when map visible, place markers from latest filtered cache */
function placeMarkersFromCache(){
  // use current filter to produce set for map
  applyFilterAndSort(currentHelpersCache).then(filtered => {
    placeMarkers(filtered);
  }).catch(err=> console.error(err));
}

/* Hire request */
window.requestHire = async function(helperUid){
  const user = auth.currentUser;
  if(!user) return alert('Login first');
  const hireRef = db.collection('hires').doc();
  await hireRef.set({ customer:user.uid, helper:helperUid, at: firebase.firestore.FieldValue.serverTimestamp(), status:'requested' });
  alert('Request sent to helper');
};

/* UI: keep filter controls in sync */
function syncMapToListControls(){
  if(mapFilterMode && filterMode) mapFilterMode.value = filterMode.value;
  if(mapRadiusInput && radiusInput) mapRadiusInput.value = radiusInput.value;
  if(mapFilterText && filterText) mapFilterText.value = filterText.value;
}
function syncListToMapControls(){
  if(mapFilterMode && filterMode) filterMode.value = mapFilterMode.value;
  if(mapRadiusInput && radiusInput) radiusInput.value = mapRadiusInput.value;
  if(mapFilterText && filterText) filterText.value = mapFilterText.value;
}

/* when user changes top filter, mirror to map controls and refresh */
filterMode?.addEventListener('change', ()=> { updateFilterUI(filterMode, radiusInput, filterText); syncMapToListControls(); });
mapFilterMode?.addEventListener('change', ()=> { updateFilterUI(mapFilterMode, mapRadiusInput, mapFilterText); syncListToMapControls(); });

function updateFilterUI(selectEl, radiusEl, textEl){
  const v = selectEl.value;
  if(v === 'radius'){ radiusEl.style.display = 'inline-block'; textEl.style.display = 'none'; }
  else if(v === 'text'){ radiusEl.style.display = 'none'; textEl.style.display = 'inline-block'; }
  else { radiusEl.style.display = 'none'; textEl.style.display = 'none'; }
}

/* initial UI update for filters */
if(filterMode) updateFilterUI(filterMode, radiusInput, filterText);
if(mapFilterMode) updateFilterUI(mapFilterMode, mapRadiusInput, mapFilterText);

/* initial load */
let currentHelpersCache = [];
async function refreshHelpers(){ // initial call used elsewhere too
  try{
    const snap = await db.collection('users').where('role','==','helper').get();
    const helpers = [];
    snap.forEach(doc => { const d = doc.data(); d._id = doc.id; helpers.push(d); });
    currentHelpersCache = helpers;
    const filtered = await applyFilterAndSort(helpers);
    renderHelpersList(filtered);
    if(leafletMap) placeMarkers(filtered);
  }catch(e){ console.error('refreshHelpers', e); }
}

/* Ratings & Reviews block (kept from earlier files) */
async function submitReview(helperId, rating, text){
  if(!auth.currentUser) { alert('Please sign in to submit a review'); return; }
  try{
    await db.collection('users').doc(helperId).collection('reviews').add({
      fromUid: auth.currentUser.uid,
      fromEmail: auth.currentUser.email || null,
      rating: Number(rating) || 0,
      text: text || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    alert('Review submitted — thank you!');
    renderReviewsForHelper(helperId);
  }catch(err){ console.error('submitReview', err); alert('Failed to submit review'); }
}
async function fetchReviewsAndAvg(helperId){
  try{
    const snap = await db.collection('users').doc(helperId).collection('reviews').orderBy('createdAt','desc').limit(50).get();
    const reviews = []; let sum = 0;
    snap.forEach(doc=>{ const d = doc.data(); reviews.push(d); sum += (d.rating||0); });
    const avg = reviews.length ? (sum / reviews.length) : 0;
    return { reviews, avg };
  }catch(e){ console.error(e); return { reviews:[], avg:0 }; }
}
async function renderReviewsForHelper(helperId){
  const container = document.getElementById('reviews-' + helperId); if(!container) return;
  container.innerHTML = 'Loading reviews...';
  try{
    const { reviews, avg } = await fetchReviewsAndAvg(helperId);
    container.innerHTML = `<div style="margin-bottom:8px;"><strong>Rating:</strong> ${avg ? avg.toFixed(1)+' / 5' : 'No ratings yet'}</div>`;
    if(reviews.length === 0) container.innerHTML += `<div style="font-size:13px;color:#666">No reviews yet — be the first.</div>`;
    else {
      const listEl = document.createElement('div');
      reviews.forEach(r=>{ const el = document.createElement('div'); el.style.borderTop='1px solid #eee'; el.style.padding='8px 0'; const when = r.createdAt? (new Date(r.createdAt.seconds*1000).toLocaleString()):''; el.innerHTML = `<div style="font-weight:600">${r.fromEmail||'User'} — ${'★'.repeat(Math.max(0,Math.min(5,Math.round(r.rating||0))))}</div><div style="font-size:13px;color:#333">${(r.text||'')}</div><div style="font-size:11px;color:#888">${when}</div>`; listEl.appendChild(el); });
      container.appendChild(listEl);
    }
    const form = document.createElement('div'); form.style.marginTop='8px';
    form.innerHTML = `<div style="display:flex;gap:6px;align-items:center"><select id="rating-select-${helperId}" style="padding:6px;border-radius:6px"><option value="5">5 ★</option><option value="4">4 ★</option><option value="3">3 ★</option><option value="2">2 ★</option><option value="1">1 ★</option></select><input id="review-text-${helperId}" placeholder="Write a short review" style="flex:1;padding:8px;border-radius:6px;border:1px solid #ddd" /><button id="review-submit-${helperId}" style="padding:8px 10px;border-radius:6px;background:linear-gradient(90deg,#5b8cff,#7a5bff);color:#fff;border:0">Send</button></div>`;
    container.appendChild(form);
    document.getElementById('review-submit-' + helperId).onclick = ()=>{ const rating = document.getElementById('rating-select-' + helperId).value; const text = document.getElementById('review-text-' + helperId).value.trim(); if(!rating) return alert('Select rating'); submitReview(helperId, rating, text); };
  }catch(err){ console.error('renderReviewsForHelper', err); container.innerHTML = '<div style="color:#a00">Error loading reviews</div>'; }
}

/* Auto-auth listener */
auth.onAuthStateChanged(user=>{
  if(user){
    db.collection('users').doc(user.uid).get().then(d=>{
      if(d.exists && d.data().role==='helper'){ role='helper'; hide($('chooseRole')); hide($('auth')); hide($('helpersList')); show($('helperDashboard')); const info=d.data(); renderHelperDashboard(info); } 
      else { role='customer'; hide($('chooseRole')); show($('helpersList')); refreshHelpers(); }
    });
  } else {
    show($('chooseRole'));
  }
});

/* Expose helper functions for console debugging */
window.seva = { refreshHelpers, applyFilterAndSort, placeMarkersFromCache, renderReviewsForHelper };