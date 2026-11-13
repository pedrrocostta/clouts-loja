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

/* App Check (reCAPTCHA v3): cole aqui a "chave do site" criada no Firebase → App Check → Apps → reCAPTCHA. Vazia = desligado.
 * Só ative a opção "Impor/Enforce" no console depois de colocar a chave aqui e publicar, senão a loja para de ler o catálogo. */
const APPCHECK_SITE_KEY = '';

const CloutsFB = (() => {
  const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
  let appP = null;
  return {
    base,
    getApp() {
      return appP ??= import(base + 'firebase-app.js').then(async m => {
        const app = m.initializeApp(FIREBASE_CONFIG);
        if (APPCHECK_SITE_KEY) {
          try { const ac = await import(base + 'firebase-app-check.js'); ac.initializeAppCheck(app, { provider: new ac.ReCaptchaV3Provider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true }); } catch (e) { console.warn('App Check:', e); }
        }
        return app;
      });
    }
  };
})();

const CloutsAuth = (() => {
  const subs = []; let user = null, mod = null, auth = null, ready = null;
  const notify = () => subs.forEach(f => f(user));
  const pick = u => u && ({ uid: u.uid, nome: u.displayName || '', email: u.email || '', foto: u.photoURL || '', criadoEm: Date.parse(u.metadata?.creationTime) || 0 });

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
    async signOut() { await init(); await mod.signOut(auth); },
    // Token de identidade do cliente (enviado ao servidor no pagamento para provar quem é).
    async token() { await init(); return auth.currentUser ? auth.currentUser.getIdToken() : null; }
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
  /* Código de convite (estilo Shopee): cada cliente tem um código de 8 caracteres. codigos/{CÓDIGO} aponta para o dono (só leitura direta, sem listar);
   users/{uid}/meta/codigo guarda o código do cliente; users/{uid}/meta/indicacao guarda quem convidou (uma única vez, não pode ser alterado). */
  async meuCodigo(uid) {
    const { fs, db } = await this._fs(), meta = fs.doc(db, 'users', uid, 'meta', 'codigo'), s = await fs.getDoc(meta);
    if (s.exists()) return s.data().codigo;
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let t = 0; t < 4; t++) {
      const r = crypto.getRandomValues(new Uint8Array(8)), codigo = [...r].map(x => A[x % A.length]).join('');
      try {
        const b = fs.writeBatch(db);
        b.set(fs.doc(db, 'codigos', codigo), { uid, criadoEm: fs.serverTimestamp() });
        b.set(meta, { codigo });
        await b.commit(); return codigo;
      } catch (e) { if (t === 3) throw e; }
    }
  },
  async resolverCodigo(codigo) {
    const { fs, db } = await this._fs(), s = await fs.getDoc(fs.doc(db, 'codigos', codigo));
    return s.exists() ? s.data().uid : null;
  },
  async registrarIndicacao(uid, refUid, codigo) {
    const { fs, db } = await this._fs();
    await fs.setDoc(fs.doc(db, 'users', uid, 'meta', 'indicacao'), { ref: refUid, codigo, criadoEm: fs.serverTimestamp() });
    await fs.setDoc(fs.doc(db, 'users', uid, 'cupons', 'BEMVINDO'), { codigo: 'BEMVINDO', percent: 10, usado: false, origem: 'codigo', criadoEm: fs.serverTimestamp() });
  },
  // Configurações editáveis no painel (config/loja): liga/desliga cupons, frase da barra, WhatsApp.
  async config(onCfg, onErr) {
    const { fs, db } = await this._fs();
    return fs.onSnapshot(fs.doc(db, 'config', 'loja'), s => onCfg(s.exists() ? s.data() : {}), e => onErr && onErr(e));
  },
  // Fotos extras da peça (galeria), em produtos/{id}/fotos.
  async fotos(id) {
    const { fs, db } = await this._fs(), sn = await fs.getDocs(fs.collection(db, 'produtos', id, 'fotos'));
    return sn.docs.map(d => d.data()).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map(x => x.img).filter(Boolean);
  },
  // Código promocional criado pelo dono (campanhas/{CÓDIGO}).
  async campanha(codigo) {
    const { fs, db } = await this._fs(), s = await fs.getDoc(fs.doc(db, 'campanhas', codigo));
    return s.exists() ? s.data() : null;
  },
  // Registra o pedido enviado pelo WhatsApp (fica aguardando; o dono confirma a venda no painel e ela entra no dashboard).
  async registrarPedido(dados) {
    const { fs, db } = await this._fs();
    const r = await fs.addDoc(fs.collection(db, 'pedidos'), { ...dados, origem: 'whatsapp', status: 'aguardando', criadoEm: fs.serverTimestamp() });
    return r.id;
  },
  // E-mails automáticos (boas-vindas, carrinho, pedido) via /api/email. Nunca atrapalha a loja se falhar.
  async email(corpo) {
    try {
      const t = await CloutsAuth.token(); if (!t) return;
      await fetch('/api/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(corpo), keepalive: true });
    } catch {}
  },
  // Reserva as peças do pedido no estoque em tempo real (servidor). Devolve { ok, falta? }; nunca atrapalha o pedido se falhar.
  async estoque(corpo) {
    try {
      const t = await CloutsAuth.token(); if (!t) return null;
      const r = await fetch('/api/estoque', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(corpo) });
      return await r.json();
    } catch { return null; }
  },
  // Pedidos do próprio cliente (para o cupom de primeira compra e para liberar o convite de amigos).
  async pedidos(uid, onList, onErr) {
    const { fs, db } = await this._fs();
    return fs.onSnapshot(fs.query(fs.collection(db, 'pedidos'), fs.where('uid', '==', uid)),
      snap => onList(snap.docs.map(d => ({ id: d.id, status: d.data().status, cupom: d.data().cupom || null }))), e => onErr && onErr(e));
  },
  async usarCupom(uid, codigo) {
    const { fs, db } = await this._fs();
    await fs.updateDoc(fs.doc(db, 'users', uid, 'cupons', codigo), { usado: true });
  }
});

window.CloutsAuth = CloutsAuth;
window.CloutsDB = CloutsDB;
