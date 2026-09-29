/* Firebase da CLOUTS: login com Google (clientes) e catálogo em tempo real (Firestore).
 * A configuração do app web do Firebase é pública; quem protege os dados são as regras do Firestore (firestore.rules). */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBP1WSRJqAM552UQU5rBRubeVkz7IRc2Ao',
  authDomain: 'clouts-409b7.firebaseapp.com',
  projectId: 'clouts-409b7',
  storageBucket: 'clouts-409b7.firebasestorage.app',
  messagingSenderId: '153191899322',
  appId: '1:153191899322:web:8ba2688766cc96ff326283'
};

const CloutsFB = (() => {
  const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
  let appP = null;
  return {
    base,
    getApp() { return appP ??= import(base + 'firebase-app.js').then(m => m.initializeApp(FIREBASE_CONFIG)); }
  };
})();

const CloutsAuth = (() => {
  const subs = []; let user = null, mod = null, auth = null, ready = null;
  const notify = () => subs.forEach(f => f(user));
  const pick = u => u && ({ uid: u.uid, nome: u.displayName || '', email: u.email || '', foto: u.photoURL || '' });

  function init() {
    if (!FIREBASE_CONFIG) return Promise.resolve(null);
    return ready ??= (async () => {
      const [app, authM] = await Promise.all([CloutsFB.getApp(), import(CloutsFB.base + 'firebase-auth.js')]);
      mod = authM; auth = authM.getAuth(app);
      authM.onAuthStateChanged(auth, u => { user = pick(u); notify(); });
    })();
  }
  return {
    get configured() { return !!FIREBASE_CONFIG; },
    get user() { return user; },
    onChange(f) { subs.push(f); f(user); },
    start() { return init().catch(e => console.error('Firebase:', e)); },
    async signIn() {
      await init();
      const r = await mod.signInWithPopup(auth, new mod.GoogleAuthProvider());
      return pick(r.user);
    },
    async signOut() { await init(); await mod.signOut(auth); }
  };
})();

/* Catálogo: coleção "produtos". Cada mudança feita no painel chega à loja na hora. */
const CloutsDB = {
  async watch(onDocs, onErr) {
    try {
      const [app, fs] = await Promise.all([CloutsFB.getApp(), import(CloutsFB.base + 'firebase-firestore.js')]);
      const db = fs.getFirestore(app);
      return fs.onSnapshot(fs.collection(db, 'produtos'),
        snap => onDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        e => onErr && onErr(e));
    } catch (e) { onErr && onErr(e); }
  }
};

window.CloutsAuth = CloutsAuth;
window.CloutsDB = CloutsDB;
CloutsAuth.start();
