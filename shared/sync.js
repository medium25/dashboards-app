// Cloud sync through Firebase (Auth + Firestore). Data lives at users/{uid}/appData/uchet and is only readable by its owner.
// Local storage stays the source the UI reads; this module pushes every edit and merges remote changes (newest edit per day wins).
const BASE = 'https://www.gstatic.com/firebasejs/10.12.5/';
const S = { state: { status: window.FB_CONFIG ? 'off' : 'noconfig', email: null, error: null, at: null } };
const listeners = new Set();
const set = (p) => { Object.assign(S.state, p); listeners.forEach((f) => { try { f(S.state); } catch (e) {} }); };
let impl = null;
const ready = (async () => {
  const cfg = window.FB_CONFIG;
  if (!cfg) return;
  try {
    const [A, Au, Fs] = await Promise.all([import(BASE + 'firebase-app.js'), import(BASE + 'firebase-auth.js'), import(BASE + 'firebase-firestore.js')]);
    const app = A.initializeApp(cfg), auth = Au.getAuth(app), db = Fs.getFirestore(app);
    let uid = null, unsub = null;
    const ref = () => Fs.doc(db, 'users', uid, 'appData', 'uchet');
    const push = (patch) => {
      if (!uid || !patch) return;
      Fs.setDoc(ref(), { data: patch, updated: Fs.serverTimestamp() }, { merge: true }).catch((e) => set({ status: 'error', error: e.code || e.message }));
    };
    window.Dash.setSyncPush(push);
    Au.onAuthStateChanged(auth, (u) => {
      if (unsub) { unsub(); unsub = null; }
      if (!u) { uid = null; set({ status: 'off', email: null, error: null }); return; }
      uid = u.uid; set({ status: 'syncing', email: u.email, error: null });
      unsub = Fs.onSnapshot(ref(), (snap) => {
        const remote = snap.exists() ? (snap.data().data || {}) : {};
        const r = window.Dash.mergeRemote(remote);
        if (r.push) push(r.push);
        set({ status: snap.metadata.fromCache && !navigator.onLine ? 'offline' : 'ok', error: null, at: Date.now() });
      }, (err) => set({ status: 'error', error: err.code || err.message }));
    });
    impl = { signIn: (e, p) => Au.signInWithEmailAndPassword(auth, e, p), signUp: (e, p) => Au.createUserWithEmailAndPassword(auth, e, p), signOut: () => Au.signOut(auth) };
  } catch (e) { set({ status: 'error', error: 'sdk: ' + (e.message || e) }); }
})();
window.Sync = {
  state: () => S.state,
  onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
  ready,
  async signIn(email, pass) { await ready; if (!impl) throw new Error('Облако не подключено'); return impl.signIn(email, pass); },
  async signUp(email, pass) { await ready; if (!impl) throw new Error('Облако не подключено'); return impl.signUp(email, pass); },
  async signOut() { await ready; if (impl) return impl.signOut(); },
};
set({});
