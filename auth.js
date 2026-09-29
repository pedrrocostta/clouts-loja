/* Login com Google (Firebase Authentication).
 * Para ativar: crie um projeto em https://console.firebase.google.com, ative Authentication > Google,
 * registre um app Web e cole os dados abaixo. Veja o LEIA-ME.md. Enquanto estiver null, o site funciona sem login. */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBP1WSRJqAM552UQU5rBRubeVkz7IRc2Ao',
  authDomain: 'clouts-409b7.firebaseapp.com',
  projectId: 'clouts-409b7',
  storageBucket: 'clouts-409b7.firebasestorage.app',
  messagingSenderId: '153191899322',
  appId: '1:153191899322:web:8ba2688766cc96ff326283'
};
/* exemplo:
const FIREBASE_CONFIG = {
  apiKey: '...', authDomain: 'SEU-PROJETO.firebaseapp.com', projectId: 'SEU-PROJETO', appId: '...'
};
*/

const CloutsAuth = (() => {
  const V = '10.12.2', base = `https://www.gstatic.com/firebasejs/${V}/`;
  const subs = []; let user = null, mod = null, auth = null, ready = null;
  const notify = () => subs.forEach(f => f(user));
  const pick = u => u && ({ uid: u.uid, nome: u.displayName || '', email: u.email || '', foto: u.photoURL || '' });

  async function init() {
    if (!FIREBASE_CONFIG) return null;
    if (!ready) ready = (async () => {
      const [appM, authM] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js')]);
      mod = authM; auth = authM.getAuth(appM.initializeApp(FIREBASE_CONFIG));
      authM.onAuthStateChanged(auth, u => { user = pick(u); notify(); });
    })();
    return ready;
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
window.CloutsAuth = CloutsAuth;
CloutsAuth.start();
