// Cloud sync through Firebase (Auth + Firestore). Data lives in one shared document (shared/uchet) readable only by members; members/{uid} holds each person's role (admin | owner).
// Local storage stays the source the UI reads; this module pushes every edit and merges remote changes (newest edit per day wins).
const BASE = 'https://www.gstatic.com/firebasejs/10.12.5/';
const S = { state: { status: window.FB_CONFIG ? 'checking' : 'noconfig', email: null, role: null, members: null, businesses: null, pages: null, uid: null, error: null, at: null, join: null, invites: null, joinError: false } };
const listeners = new Set();
const set = (p) => { Object.assign(S.state, p); listeners.forEach((f) => { try { f(S.state); } catch (e) {} }); };
// invite link: ?join=<businessId>.<token>&n=<name>. Kept until the person has signed in and joined.
const JK = 'join:v1';
const readJoin = () => { try { return JSON.parse(localStorage.getItem(JK)); } catch (e) { return null; } };
const clearJoin = () => { try { localStorage.removeItem(JK); } catch (e) {} set({ join: null }); };
try {
  const q = new URLSearchParams(location.search), j = q.get('join');
  if (j && /^[\w-]+\.[\w-]+$/.test(j)) {
    const [bid, token] = j.split('.');
    localStorage.setItem(JK, JSON.stringify({ bid, token, name: (q.get('n') || '').slice(0, 40) }));
    q.delete('join'); q.delete('n');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
} catch (e) {}
const pending0 = readJoin();
let impl = null;
const ready = (async () => {
  const cfg = window.FB_CONFIG;
  if (!cfg) return;
  try {
    const [A, Au, Fs] = await Promise.all([import(BASE + 'firebase-app.js'), import(BASE + 'firebase-auth.js'), import(BASE + 'firebase-firestore.js')]);
    const app = A.initializeApp(cfg), auth = Au.getAuth(app), db = Fs.getFirestore(app);
    let uid = null, role = null, unsub = null, watched = null; const subs = [];
    const newToken = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => (b % 36).toString(36)).join(''); };
    const dataRef = (pid) => Fs.doc(db, 'shared', pid);
    const memberRef = (id) => Fs.doc(db, 'members', id);
    const fail = (e) => set({ status: e.code === 'permission-denied' ? 'noaccess' : 'error', error: e.code || e.message });
    const push = (pid, patch) => {
      if (!uid || !patch || !pid) return;
      Fs.setDoc(dataRef(pid), { data: patch, updated: Fs.serverTimestamp() }, { merge: true }).catch(fail);
    };
    window.Dash.setSyncPush(push);
    const stop = () => { if (unsub) { unsub(); unsub = null; } watched = null; while (subs.length) subs.pop()(); };
    // follow the data document of the business that is open right now
    const watch = () => {
      const p = window.Dash.project && window.Dash.project(), pid = p && p.id;
      if (!uid || pid === watched) return;
      if (unsub) { unsub(); unsub = null; }
      watched = pid; if (!pid) { set({ status: 'ok', error: null }); return; }
      unsub = Fs.onSnapshot(dataRef(pid), (snap) => {
        const remote = snap.exists() ? (snap.data().data || {}) : {};
        const r = window.Dash.mergeRemote(remote, pid);
        if (r.push) push(pid, r.push);
        set({ status: snap.metadata.fromCache && !navigator.onLine ? 'offline' : 'ok', error: null, at: Date.now() });
      }, fail);
    };
    window.Dash.onProject(watch);
    const showProjects = (list) => { set({ businesses: list }); window.Dash.setProjects(list); watch(); };
    Au.onAuthStateChanged(auth, async (u) => {
      stop(); uid = null; role = null;
      if (!u) { set({ status: 'off', email: null, role: null, members: null, businesses: null, pages: null, uid: null, error: null, joinError: false, invites: null }); return; }
      set({ status: 'syncing', email: u.email, role: null, members: null, businesses: null, pages: null, uid: u.uid, error: null });
      let first = false;
      try {
        const m = await Fs.getDoc(memberRef(u.uid)), pj = readJoin();
        if (m.exists()) {
          role = m.data().role;
          if (pj && role === 'owner' && !(m.data().pages || []).includes(pj.bid)) {
            try { await Fs.updateDoc(memberRef(u.uid), { pages: [...(m.data().pages || []), pj.bid], joinBid: pj.bid, joinToken: pj.token }); } catch (e) { set({ joinError: true }); }
          }
          if (pj) clearJoin();
        } else if ((await Fs.getDoc(Fs.doc(db, 'meta', 'workspace'))).exists()) {
          if (pj) {                                            // joined through a business invite link
            try {
              await Fs.setDoc(memberRef(u.uid), { role: 'owner', phone: u.email, name: '', pages: [pj.bid], joinBid: pj.bid, joinToken: pj.token, createdAt: Fs.serverTimestamp() });
              role = 'owner'; clearJoin();
            } catch (e) { clearJoin(); set({ status: 'noaccess', joinError: true }); return; }
          } else { set({ status: 'noaccess' }); return; }
        } else {                                                 // first account ever becomes the administrator
          const b = Fs.writeBatch(db), ts = Fs.serverTimestamp();
          b.set(Fs.doc(db, 'meta', 'workspace'), { adminUid: u.uid, created: ts });
          b.set(memberRef(u.uid), { role: 'admin', phone: u.email, name: 'Администратор', createdAt: ts });
          await b.commit(); role = 'admin'; first = true;
        }
        if (first) await Fs.setDoc(Fs.doc(db, 'businesses', 'main'), { name: 'Учёт', createdAt: Fs.serverTimestamp() });
      } catch (e) { fail(e); return; }
      if (!auth.currentUser || auth.currentUser.uid !== u.uid) return;
      uid = u.uid; set({ role });
      if (role === 'admin') {
        let bizIds = [], invs = {}, made = new Set();
        const ensureInvites = () => bizIds.forEach((id) => { if (!invs[id] && !made.has(id)) { made.add(id); Fs.setDoc(Fs.doc(db, 'invites', id), { token: newToken() }).catch(() => made.delete(id)); } });
        subs.push(Fs.onSnapshot(Fs.collection(db, 'invites'), (qs) => { invs = {}; qs.docs.forEach((d) => { invs[d.id] = d.data().token; }); set({ invites: { ...invs } }); ensureInvites(); }, () => {}));
        subs.push(Fs.onSnapshot(Fs.collection(db, 'members'), (qs) => set({ members: qs.docs.map((d) => ({ uid: d.id, ...d.data() })) }), () => {}));
        subs.push(Fs.onSnapshot(Fs.collection(db, 'businesses'), (qs) => { bizIds = qs.docs.map((d) => d.id); ensureInvites(); showProjects(qs.docs.map((d) => ({ id: d.id, name: d.data().name })).sort((x, y) => (x.id === 'main' ? -1 : y.id === 'main' ? 1 : x.name.localeCompare(y.name)))); }, fail));
      } else {
        // an owner sees only the businesses the administrator assigned to them
        const names = {}; let ids = [];
        const emit = () => showProjects(ids.filter((id) => names[id]).map((id) => ({ id, name: names[id] })));
        subs.push(Fs.onSnapshot(memberRef(u.uid), (snap) => {
          const d = snap.data() || {}; ids = Array.isArray(d.pages) ? d.pages : [];
          set({ pages: ids });
          ids.forEach((id) => { if (names[id] === undefined) { names[id] = ''; subs.push(Fs.onSnapshot(Fs.doc(db, 'businesses', id), (bs) => { names[id] = bs.exists() ? bs.data().name : ''; emit(); }, () => { names[id] = ''; emit(); })); } });
          emit();
        }, fail));
      }
    });
    // admin: create a login for another person (secondary app instance so the admin stays signed in) and give it a role
    const addMember = async (email, pass, role, name, pages) => {
      const app2 = A.initializeApp(cfg, 'adder' + Date.now()), a2 = Au.getAuth(app2);
      let cred;
      try {
        try { cred = await Au.createUserWithEmailAndPassword(a2, email, pass); }
        catch (e) { if (e.code === 'auth/email-already-in-use') cred = await Au.signInWithEmailAndPassword(a2, email, pass); else throw e; }
        await Au.signOut(a2);
      } finally { A.deleteApp(app2).catch(() => {}); }
      try { await Fs.setDoc(memberRef(cred.user.uid), { role, phone: email, name: name || '', pages: pages || [], createdAt: Fs.serverTimestamp() }); }
      catch (e) {
        if (e.code === 'permission-denied') {                  // say who the database thinks is asking
          const me = auth.currentUser, d = me ? await Fs.getDoc(memberRef(me.uid)).catch(() => null) : null;
          e.detail = (me ? me.email : 'не вошли') + ' · запись в базе: ' + (d && d.exists() ? 'уровень ' + d.data().role : 'нет');
        }
        throw e;
      }
    };
    impl = {
      signIn: (e, p) => Au.signInWithEmailAndPassword(auth, e, p),
      signUp: (e, p) => Au.createUserWithEmailAndPassword(auth, e, p),
      signOut: () => Au.signOut(auth),
      addMember, removeMember: (id) => Fs.deleteDoc(memberRef(id)),
      setRole: (id, r) => Fs.updateDoc(memberRef(id), { role: r }),
      updateMember: (id, f) => Fs.updateDoc(memberRef(id), f),
      setPages: (id, pages) => Fs.updateDoc(memberRef(id), { pages }),
      addBusiness: async (name) => { const id = 'b' + Date.now().toString(36); await Fs.setDoc(Fs.doc(db, 'businesses', id), { name, createdAt: Fs.serverTimestamp() }); return id; },
      removeBusiness: async (id) => {
        const b = Fs.writeBatch(db);
        b.delete(Fs.doc(db, 'businesses', id)); b.delete(Fs.doc(db, 'shared', id)); b.delete(Fs.doc(db, 'invites', id));
        (S.state.members || []).forEach((m) => { if ((m.pages || []).includes(id)) b.update(memberRef(m.uid), { pages: m.pages.filter((x) => x !== id) }); });
        await b.commit();
      },
      resetInvite: (id) => Fs.setDoc(Fs.doc(db, 'invites', id), { token: newToken() }),
      renameBusiness: (id, name) => Fs.updateDoc(Fs.doc(db, 'businesses', id), { name }),
    };
  } catch (e) { set({ status: 'error', error: 'sdk: ' + (e.message || e) }); }
})();
window.Sync = {
  state: () => S.state,
  onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
  ready,
  async signIn(email, pass) { await ready; if (!impl) throw new Error('Облако не подключено'); return impl.signIn(email, pass); },
  async signUp(email, pass) { await ready; if (!impl) throw new Error('Облако не подключено'); return impl.signUp(email, pass); },
  async addMember(email, pass, role, name, pages) { await ready; return impl.addMember(email, pass, role, name, pages); },
  async updateMember(id, f) { await ready; return impl.updateMember(id, f); },
  async setPages(id, pages) { await ready; return impl.setPages(id, pages); },
  async addBusiness(name) { await ready; return impl.addBusiness(name); },
  async removeBusiness(id) { await ready; return impl.removeBusiness(id); },
  async resetInvite(id) { await ready; return impl.resetInvite(id); },
  async renameBusiness(id, name) { await ready; return impl.renameBusiness(id, name); },
  async setRole(id, role) { await ready; return impl.setRole(id, role); },
  async removeMember(id) { await ready; return impl.removeMember(id); },
  async signOut() { await ready; if (impl) return impl.signOut(); },
};
set({ join: pending0 ? { name: pending0.name } : null });
