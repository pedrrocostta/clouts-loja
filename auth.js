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
      return { ...pick(r.user), isNew: !!mod.getAdditionalUserInfo(r)?.isNewUser };
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

/* Convites: referrals/{quemConvidou}/convidados/{amigo} + contador n. Cada amigo (conta Google nova) conta uma vez; com 10 o cliente libera o cupom.
 * Cupons do cliente: users/{uid}/cupons/{código}. As regras do Firestore só deixam criar o cupom AMIGO (5%, 10% ou 20% conforme os convites),
 * subir de degrau enquanto não usado e marcar como usado. Um por conta. */
const CUPOM = 'AMIGO';
Object.assign(CloutsDB, {
  async _fs() {
    const [app, fs] = await Promise.all([CloutsFB.getApp(), import(CloutsFB.base + 'firebase-firestore.js')]);
    return { fs, db: fs.getFirestore(app) };
  },
  async cupons(uid, onList, onErr) {
    const { fs, db } = await this._fs();
    return fs.onSnapshot(fs.collection(db, 'users', uid, 'cupons'),
      snap => onList(snap.docs.map(d => ({ id: d.id, ...d.data() }))), e => onErr && onErr(e));
  },
  // Um único cupom por cliente: cria com o degrau atual e só sobe (5 -> 10 -> 20) enquanto não for usado.
  async darCupom(uid, percent) {
    const { fs, db } = await this._fs(), ref = fs.doc(db, 'users', uid, 'cupons', CUPOM), snap = await fs.getDoc(ref);
    if (!snap.exists()) {
      await fs.setDoc(ref, { codigo: CUPOM, percent, usado: false, origem: 'indicacao', criadoEm: fs.serverTimestamp() });
      return 'novo';
    }
    const c = snap.data();
    if (!c.usado && c.percent < percent) { await fs.updateDoc(ref, { percent }); return 'subiu'; }
    return 'existente';
  },
  // Avisos e promoções enviados pelo painel (coleção "avisos"; leitura pública, escrita só do administrador).
  async avisos(onList, onErr) {
    const { fs, db } = await this._fs();
    return fs.onSnapshot(fs.query(fs.collection(db, 'avisos'), fs.orderBy('criadoEm', 'desc'), fs.limit(20)),
      snap => onList(snap.docs.map(d => { const x = d.data(); return { id: d.id, ...x, criado: x.criadoEm?.toMillis?.() ?? Date.now(), expira: x.expiraEm?.toMillis?.() ?? null }; })),
      e => onErr && onErr(e));
  },
  async convites(uid, onN, onErr) {
    const { fs, db } = await this._fs();
    return fs.onSnapshot(fs.doc(db, 'referrals', uid), snap => onN(snap.exists() ? (snap.data().n || 0) : 0), e => onErr && onErr(e));
  },
  async registrarConvite(refUid, meuUid) {
    const { fs, db } = await this._fs(), b = fs.writeBatch(db);
    b.set(fs.doc(db, 'referrals', refUid, 'convidados', meuUid), { criadoEm: fs.serverTimestamp() });
    b.set(fs.doc(db, 'referrals', refUid), { n: fs.increment(1) }, { merge: true });
    await b.commit();
  },
  async usarCupom(uid, codigo) {
    const { fs, db } = await this._fs();
    await fs.updateDoc(fs.doc(db, 'users', uid, 'cupons', codigo), { usado: true });
  }
});

window.CloutsAuth = CloutsAuth;
window.CloutsDB = CloutsDB;
