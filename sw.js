/* CLOUTS: cache para carregar rápido e página própria quando a conexão cai. */
const V = 'clouts-v1';
const SHELL = ['/', '/style.css', '/app.js', '/products.js', '/auth.js', '/img/logo.png', '/offline.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Rede primeiro (sempre a versão nova); se a rede demorar ou falhar, usa a cópia guardada.
function redeOuCache(req, ms, nav) {
  return new Promise((ok, no) => {
    let feito = false;
    const cache = () => caches.match(req, { ignoreSearch: nav }).then(m => m || (nav ? caches.match('/') : null));
    const t = setTimeout(() => cache().then(m => { if (m && !feito) { feito = true; ok(m); } }), ms);
    fetch(req).then(res => {
      clearTimeout(t);
      if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)); }
      if (!feito) { feito = true; ok(res); }
    }).catch(() => {
      clearTimeout(t); if (feito) return;
      cache().then(m => m ? (feito = true, ok(m)) : no(new Error('offline')));
    });
  });
}

// Imagens: cache primeiro (não mudam com frequência), atualizando em segundo plano.
function imagem(req) {
  return caches.match(req).then(m => {
    const rede = fetch(req).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)); } return res; });
    return m || rede;
  });
}

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/painel')) return;
  if (r.headers.has('range')) return;                       // vídeos
  if (r.mode === 'navigate') {
    e.respondWith(redeOuCache(r, 4000, true).catch(() => caches.match('/offline.html')));
  } else if (/\.(js|css)$/.test(u.pathname)) {
    e.respondWith(redeOuCache(r, 4000, false));
  } else if (/\.(jpe?g|png|webp|svg)$/.test(u.pathname)) {
    e.respondWith(imagem(r));
  }
});
