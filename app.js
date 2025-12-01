// ====== CONFIG: YOUR FIREBASE CONFIG (already filled) ======
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

// After login
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

  const doc = await userRef.get();
  const data = doc.data() || {};

  if((data.role||role)==='helper'){
    hide($('auth')); show($('profile'));
  } else {
    hide($('auth')); show($('helpersList'));
    await showHelpersNearUser();
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

  const payload = {
    displayName:name||'', services, location,
    role:'helper', uid:user.uid,
    phone:phone||user.phoneNumber||null, price:price||'',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if(lat && lng) payload.coords = new firebase.firestore.GeoPoint(lat,lng);

  await userRef.set(payload, {merge:true});
  alert('Profile saved');
  hide($('profile'));
  show($('helperDashboard'));
  renderHelperDashboard(payload);
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

// Helper list
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

  const snap = await db.collection('users').where('role','==','helper').get();
  list.innerHTML = '';

  snap.forEach(doc=>{
    const d = doc.data();
    const hId = doc.id;

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
    let distHtml='';
    if(custLat!=null && d.coords){
      const km = haversineKm(custLat,custLng,d.coords.latitude,d.coords.longitude);
      distHtml = `<div style="font-weight:600;color:#666">${km.toFixed(1)} km away</div>`;
    }

    right.innerHTML = `
      <strong>${d.displayName||'No name'}</strong>
      <div>${(d.services||[]).join(', ')}</div>
      <div>${d.location||''}</div>
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

  document.querySelectorAll('.hireBtn').forEach(btn=>{
    btn.onclick = e => requestHire(e.currentTarget.dataset.uid);
  });
}

// Request hire → now opens chat
window.requestHire = async function(helperUid){
  const user = auth.currentUser;
  if(!user) return alert('Login first');

  const ref = db.collection('hires').doc();
  await ref.set({
    customer:user.uid, helper:helperUid,
    at: firebase.firestore.FieldValue.serverTimestamp(),
    status:'requested'
  });

  alert('Request sent! Opening chat...');
  openChat(helperUid);
};

// Hide all
function hideAll(){
  ['auth','profile','helpersList','settings','about','helperDashboard','chatSection']
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
      } else {
        role='customer';
        hide($('chooseRole'));
        show($('helpersList'));
        showHelpersNearUser();
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

/* ------------------ CHAT SYSTEM ------------------ */

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
});

window._seva = {
  renderReviewsForHelper, fetchReviewsAndAvg,
  submitReview, showHelpersNearUser
};