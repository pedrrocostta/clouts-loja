/* CLOUTS — loja online (sem dependências). */
const CONFIG = {
  whatsapp: '5531994810359',                 // (31) 99481-0359 — trocar quando o cliente tiver outro número
  instagram: 'clouts.oficial',
  cidades: ['Contagem', 'Betim', 'Belo Horizonte'],
  // Frete por cidade, em reais. Zerado por enquanto (igual aos preços). Edite aqui quando definir os valores.
  frete: { 'Contagem': 0, 'Betim': 0, 'Belo Horizonte': 0 },
  freteGratisAcima: null                     // ex.: 299 => frete grátis em pedidos a partir de R$ 299
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = id => PRODUTOS.find(p => p.id === id);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const waLink = txt => `https://wa.me/${CONFIG.whatsapp}${txt ? '?text=' + encodeURIComponent(txt) : ''}`;

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
/* ---------- Catálogo em tempo real (Firestore) ---------- */
const pick = (id, sec) => byId(id) || PRODUTOS.find(p => p.secao === sec) || PRODUTOS[0] || { img: '' };
const sizesAll = p => p.secao === 'feminino' ? ['36', '38', '40', '42', '44', '46'] : ['38', '40', '42', '44', '46', '48'];
const soldOut = p => !!p.esgotado || !(p.tam || []).length;
const topList = () => MAIS_VENDIDOS.map(byId).filter(Boolean);
function applyCatalog(docs) {
  if (!docs || !docs.length) return false;
  const list = docs.filter(d => d.visivel !== false && d.cod && d.img)
    .map(d => ({ tam: [], preco: 0, extras: [], modelo: '', nome: d.cod, ...d }))
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || String(a.cod).localeCompare(String(b.cod)));
  PRODUTOS.length = 0; PRODUTOS.push(...list);
  MAIS_VENDIDOS.length = 0;
  MAIS_VENDIDOS.push(...list.filter(p => p.maisVendido).sort((a, b) => (a.rankMV ?? 999) - (b.rankMV ?? 999)).map(p => p.id));
  return true;
}
try { applyCatalog(JSON.parse(localStorage.getItem('clouts.catalogo'))); } catch {}
const auth = () => window.CloutsAuth;
const me = () => auth()?.user || null;
const favKey = () => 'clouts.favs.' + (me()?.uid || 'visitante');
let cart = store.get('clouts.cart', []).filter(i => byId(i.id));
let favs = store.get(favKey(), []).filter(byId);
let ship = store.get('clouts.ship', null);   // { cep, cidade, bairro, rua, valor }
const saveCart = () => { store.set('clouts.cart', cart); renderCart(); };
const saveFavs = () => { store.set(favKey(), favs); updateBadges(); };

const svg = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
const ICON = {
  heart: svg('<path d="M12 20s-7-4.4-9-9.2C1.6 7.4 3.7 4.5 6.8 4.5c1.9 0 3.6 1 5.2 3 1.6-2 3.3-3 5.2-3 3.1 0 5.2 2.9 3.8 6.3C19 15.6 12 20 12 20Z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  bag: svg('<path d="M5 8h14l-1.2 11.5H6.2L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  truck: svg('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4V5Z"/>'),
  card: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/>'),
  x: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  pix: svg('<path d="M12 3.500 20.500 12 12 20.500 3.500 12 12 3.500Z"/><path d="m8.500 12 3.500-3.500 3.500 3.500-3.500 3.500Z"/>'),
  google: '<svg viewBox="0 0 24 24" style="fill:none;stroke:none"><path fill="#4285F4" d="M22.500 12.200c0-.8-.1-1.500-.2-2.200H12v4.200h5.900a5 5 0 0 1-2.200 3.300v2.700h3.500c2.100-1.900 3.300-4.700 3.300-8Z"/><path fill="#34A853" d="M12 23c3 0 5.400-1 7.200-2.700l-3.500-2.700c-1 .7-2.200 1-3.700 1-2.800 0-5.200-1.900-6-4.500H2.400v2.800A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M6 14.100a6.600 6.600 0 0 1 0-4.200V7.100H2.400a11 11 0 0 0 0 9.800L6 14.100Z"/><path fill="#EA4335" d="M12 5.400c1.600 0 3 .6 4.100 1.600l3.100-3.100A11 11 0 0 0 2.400 7.100L6 9.900c.8-2.600 3.200-4.500 6-4.500Z"/></svg>'
};

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400);
}

/* ---------- Cards ---------- */
function cardHTML(p, rank) {
  const on = favs.includes(p.id);
  return `<article class="card" data-id="${p.id}" tabindex="0" aria-label="${esc(p.nome)}">
    <div class="card-img">
      <img src="${p.img}" alt="${esc(p.nome)}" loading="lazy">
      ${rank ? `<span class="tag-p rank">#${rank}</span>` : p.premium ? '<span class="tag-p">Premium</span>' : p.diamond ? '<span class="tag-p">Diamond</span>' : ''}
      <button class="fav ${on ? 'on' : ''}" data-fav="${p.id}" aria-label="Favoritar" aria-pressed="${on}">${ICON.heart}</button>
      ${soldOut(p) ? '<span class="soldout">Esgotado</span>' : `<button class="qadd" data-quick="${p.id}" aria-label="Adicionar ao carrinho">${ICON.plus}</button>`}
    </div>
    <div class="card-b"><div class="cod">Cód. ${esc(p.cod)}</div><h3 class="nm">${esc(p.nome)}</h3><div class="price">${brl(p.preco)}</div></div>
  </article>`;
}

/* ---------- Views ---------- */
const app = $('#app');
let heroTimer;
const CATS = () => [
  ['Feminino', '#/feminino', pick('f-112420-1', 'feminino').img], ['Masculino', '#/masculino', pick('m-3', 'masculino').img],
  ['Mais vendidos', '#/mais-vendidos', pick('f-112466-1', 'feminino').img], ['Cigarrete', '#/feminino?m=Cigarrete', pick('f-112725-1', 'feminino').img],
  ['Wide Leg', '#/feminino?m=Wide Leg', pick('f-112271-1', 'feminino').img], ['Moom', '#/feminino?m=Moom', pick('f-111664-1', 'feminino').img],
  ['Jaquetas', '#/feminino?m=Jaqueta', pick('f-113064-1', 'feminino').img], ['Boot Cut', '#/feminino?m=Boot Cut', pick('f-113238-1', 'feminino').img],
  ['Slim Fit', '#/masculino?m=Slim Fit', pick('m-5', 'masculino').img]
];
const catHTML = ([n, h, img]) => `<a class="cat" href="${h}"><span><img src="${img}" alt="" loading="lazy"></span>${n}</a>`;

function viewHome() {
  const fem = PRODUTOS.filter(p => p.secao === 'feminino'), mas = PRODUTOS.filter(p => p.secao === 'masculino');
  const hero = [pick('f-112271-1', 'feminino'), pick('m-4', 'masculino'), pick('f-112420-1', 'feminino'), pick('m-2', 'masculino')];
  app.innerHTML = `
  <section class="hero">
    <div class="hero-txt">
      <span class="kicker">Coleção 2026</span>
      <h1>Vista<br>seu <em>melhor.</em></h1>
      <p>Calças femininas e masculinas com caimento perfeito. Entregamos em Contagem, Betim e Belo Horizonte.</p>
      <a class="btn btn-gold" href="#/mais-vendidos" style="align-self:flex-start">Ver mais vendidos</a>
    </div>
    <div class="hero-img">${hero.map((p, i) => `<img src="${p.img}" alt="" class="${i ? '' : 'on'}">`).join('')}
      <div class="hero-dots">${hero.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
    </div>
  </section>

  <section class="strip">
    <div>${ICON.truck}<span><b>Frete pelo CEP</b>Contagem, Betim e BH</span></div>
    <div>${ICON.pix}<span><b>Pix e cartão</b>Pague do jeito que preferir</span></div>
  </section>

  <section class="cats-grid">${CATS().map(catHTML).join('')}<a class="cat" href="#/entrega"><span class="ic">${ICON.truck}</span>Entrega</a></section>

  <section class="sec vids">
    <a class="vid" href="#/feminino"><video src="img/video/feminino.mp4" poster="img/video/feminino.jpg" autoplay muted loop playsinline preload="metadata" aria-hidden="true"></video><div><span>Caimento que valoriza</span><h3>Feminino</h3></div></a>
    <a class="vid" href="#/masculino"><video src="img/video/masculino.mp4" poster="img/video/masculino.jpg" autoplay muted loop playsinline preload="metadata" aria-hidden="true"></video><div><span>Ajuste perfeito</span><h3>Masculino</h3></div></a>
  </section>

  <section class="sec"><div class="sec-h"><h2>Mais vendidos</h2><a href="#/mais-vendidos">Ver tudo →</a></div>
    <div class="grid">${topList().slice(0, 8).map((p, i) => cardHTML(p, i + 1)).join('')}</div></section>
  <section class="sec"><div class="sec-h"><h2>Feminino</h2><a href="#/feminino">Ver tudo →</a></div>
    <div class="grid">${fem.slice(0, 8).map(p => cardHTML(p)).join('')}</div></section>
  <section class="sec"><div class="sec-h"><h2>Masculino</h2><a href="#/masculino">Ver tudo →</a></div>
    <div class="grid">${mas.map(p => cardHTML(p)).join('')}</div></section>`;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) $$('.vid video').forEach(v => v.pause());
  const imgs = $$('.hero-img img'), dots = $$('.hero-dots i'); let k = 0;
  if (imgs.length > 1) heroTimer = setInterval(() => {
    imgs[k].classList.remove('on'); dots[k].classList.remove('on');
    k = (k + 1) % imgs.length; imgs[k].classList.add('on'); dots[k].classList.add('on');
  }, 4500);
}

function viewList(secao, q) {
  const base = PRODUTOS.filter(p => p.secao === secao);
  const modelos = [...new Set(base.map(p => p.modelo))];
  const m = q.get('m') || '', ord = q.get('o') || '';
  let list = base.filter(p => !m || p.modelo === m);
  if (ord === 'cod') list = [...list].sort((a, b) => a.cod.localeCompare(b.cod));
  if (ord === 'nome') list = [...list].sort((a, b) => a.nome.localeCompare(b.nome));
  const fem = secao === 'feminino';
  app.innerHTML = `
  <div class="page-h"><h1>${fem ? 'Feminino' : 'Masculino'}</h1><p>${fem ? 'Jeans e jaquetas com lycra, do cigarrete ao wide leg.' : 'Calças slim fit em sarja e poliviscose com elastano.'}</p></div>
  <div class="chips" role="group" aria-label="Modelagem">
    <button class="chip ${m ? '' : 'on'}" data-m="">Todos</button>
    ${modelos.map(x => `<button class="chip ${m === x ? 'on' : ''}" data-m="${esc(x)}">${esc(x)}</button>`).join('')}
  </div>
  <div class="toolbar"><span class="count">${list.length} ${list.length === 1 ? 'peça' : 'peças'}</span>
    <select id="ord" aria-label="Ordenar"><option value="">Ordenar: Destaques</option><option value="cod" ${ord === 'cod' ? 'selected' : ''}>Código</option><option value="nome" ${ord === 'nome' ? 'selected' : ''}>Nome</option></select></div>
  <div class="grid">${list.map(p => cardHTML(p)).join('')}</div>`;
  const go = (mm, oo) => { const s = new URLSearchParams(); if (mm) s.set('m', mm); if (oo) s.set('o', oo); location.hash = `#/${secao}${s.toString() ? '?' + s : ''}`; };
  $$('.chip').forEach(c => c.onclick = () => go(c.dataset.m, ord));
  $('#ord').onchange = e => go(m, e.target.value);
}

function viewTop() {
  app.innerHTML = `<div class="page-h"><h1>Mais vendidos</h1><p>As calças que mais saem, femininas e masculinas.</p></div>
  <div class="grid" style="margin-top:16px">${topList().map((p, i) => cardHTML(p, i + 1)).join('')}</div>`;
}

function viewSearch(term) {
  const t = norm(term);
  const list = PRODUTOS.filter(p => norm([p.cod, p.nome, p.modelo, p.secao, p.cor || ''].join(' ')).includes(t));
  app.innerHTML = `<div class="page-h"><h1>Busca</h1><p>${list.length} resultado(s) para “${esc(term)}”</p></div>
  ${list.length ? `<div class="grid" style="margin-top:16px">${list.map(p => cardHTML(p)).join('')}</div>` : '<div class="empty">Nada encontrado. Tente o código da peça ou “wide leg”, “cigarrete”, “slim”.</div>'}`;
}

function viewFavs() {
  const list = favs.map(byId).filter(Boolean);
  app.innerHTML = `<div class="page-h"><h1>Favoritos</h1></div>
  ${list.length ? `<div class="grid" style="margin-top:16px">${list.map(p => cardHTML(p)).join('')}</div>` : '<div class="empty">Você ainda não favoritou nenhuma peça. Toque no coração para salvar.</div>'}`;
}

function viewEntrega() {
  app.innerHTML = `<div class="page-h"><h1>Entrega e pagamento</h1><p>Entregamos nas cidades abaixo. Calcule o frete pelo CEP no carrinho.</p></div>
  <div class="deliv">${CONFIG.cidades.map(c => `<div><h3>${c}</h3><p>Frete: ${brl(CONFIG.frete[c] || 0)}</p></div>`).join('')}</div>
  <p class="note" style="margin-bottom:18px">Formas de pagamento: Pix e cartão de crédito.</p>
  <a class="btn btn-gold" href="#/feminino">Começar a comprar</a>`;
}

function viewPerfil() {
  const u = me();
  if (!u) {
    app.innerHTML = `<div class="page-h"><h1>Minha conta</h1></div><div class="empty">Entre para salvar favoritos e finalizar pedidos mais rápido.<br><br><button class="btn btn-dark" id="pLogin">Entrar</button></div>`;
    $('#pLogin').onclick = () => openLogin(); return;
  }
  app.innerHTML = `<div class="page-h"><h1>Minha conta</h1></div>
  <div class="acct">${u.foto ? `<img src="${esc(u.foto)}" alt="" referrerpolicy="no-referrer">` : `<span class="av">${esc((u.nome || u.email || '?')[0].toUpperCase())}</span>`}
    <div><b>${esc(u.nome || 'Cliente CLOUTS')}</b><br><span class="note">${esc(u.email)}</span></div></div>
  <div class="acct-links"><a class="btn btn-line" href="#/favoritos">${ICON.heart} Meus favoritos (${favs.length})</a>
  <a class="btn btn-line" href="${waLink('Olá! Preciso de ajuda com meu pedido.')}" target="_blank" rel="noopener">${ICON.chat} Falar no WhatsApp</a>
  <a class="btn btn-line" href="https://instagram.com/${CONFIG.instagram}" target="_blank" rel="noopener">Instagram @${CONFIG.instagram}</a>
  <button class="btn btn-dark" id="pOut">Sair da conta</button></div>`;
  $('#pOut').onclick = async () => { await auth().signOut(); toast('Você saiu da conta'); };
}

/* ---------- Router ---------- */
let routeKey = 'home', cur = { r: 'home', q: new URLSearchParams() };
function renderView() {
  const { r, q } = cur;
  document.body.classList.toggle('is-home', r === 'home');
  if (r === 'feminino' || r === 'masculino') viewList(r, q);
  else if (r === 'mais-vendidos') viewTop();
  else if (r === 'busca') viewSearch(q.get('q') || '');
  else if (r === 'favoritos') viewFavs();
  else if (r === 'entrega') viewEntrega();
  else if (r === 'perfil') viewPerfil();
  else { document.body.classList.add('is-home'); viewHome(); }
}
function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  clearInterval(heroTimer); closeAll();
  const r = path.split('/').filter(Boolean)[0] || 'home';
  cur = { r: ['feminino', 'masculino', 'mais-vendidos', 'busca', 'favoritos', 'entrega', 'perfil'].includes(r) ? r : 'home', q: new URLSearchParams(qs || '') };
  routeKey = cur.r;
  renderView();
  $$('[data-isl]').forEach(a => a.classList.toggle('on', a.dataset.isl === routeKey));
  const b = { home: 'home', 'mais-vendidos': 'mais-vendidos', perfil: 'perfil' }[routeKey];
  $$('#bnav [data-b]').forEach(x => x.classList.toggle('on', x.dataset.b === b));
  window.scrollTo({ top: 0 });
}
let pendingRefresh = false;
function refreshCatalog() {
  if ($('#sheet').classList.contains('open')) { pendingRefresh = true; return; }
  pendingRefresh = false;
  cart = cart.filter(i => byId(i.id)); favs = favs.filter(byId); store.set('clouts.cart', cart); store.set(favKey(), favs);
  const y = window.scrollY; clearInterval(heroTimer); renderView(); window.scrollTo(0, y);
  renderCart();
}
window.addEventListener('hashchange', route);
const setHH = () => document.documentElement.style.setProperty('--hh', $('#hdr').offsetHeight + 'px');
window.addEventListener('resize', setHH);

/* ---------- Drawers / sheets ---------- */
function closeAll() {
  $('#cartDrawer').classList.remove('open'); $('#menuDrawer').classList.remove('open');
  $('#scrim').classList.remove('on'); closeSheet();
  document.body.style.overflow = '';
}
function openDrawer(id) {
  closeSheet(); $('#' + id).classList.add('open'); $('#scrim').classList.add('on'); document.body.style.overflow = 'hidden';
}
function showSheet(html, cls = '') {
  const s = $('#sheet');
  s.innerHTML = `<div class="sheet-in ${cls}"><button class="icon-btn sheet-x" aria-label="Fechar">${ICON.x}</button>${html}</div>`;
  s.classList.add('open'); s.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
  s.onclick = e => { if (e.target === s) closeSheet(); };
  $('.sheet-x', s).onclick = () => closeSheet();
  return s;
}
function closeSheet() {
  const s = $('#sheet'); if (!s.classList.contains('open')) return;
  s.classList.remove('open'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = '';
  if (pendingRefresh) setTimeout(refreshCatalog, 0);
  if (!$('#cartDrawer').classList.contains('open') && !$('#menuDrawer').classList.contains('open')) document.body.style.overflow = '';
}
$('#scrim').onclick = closeAll;
$$('[data-close]').forEach(b => b.onclick = closeAll);
$('#menuBtn').onclick = () => openDrawer('menuDrawer');
const openCart = () => { checkout = false; renderCart(); openDrawer('cartDrawer'); };
$('#cartBtn').onclick = $('#bCart').onclick = openCart;
$('#favBtn').onclick = () => { location.hash = '#/favoritos'; };
$('#menuDrawer').addEventListener('click', e => { if (e.target.closest('a')) closeAll(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
$('#menuWa').href = $('#ftrWa').href = waLink('Olá! Vim pelo site da CLOUTS.');

$('#searchForm').onsubmit = e => {
  e.preventDefault(); const v = $('#searchInput').value.trim();
  if (v) location.hash = '#/busca?q=' + encodeURIComponent(v);
  $('#searchInput').blur();
};

/* categorias (menu inferior) */
$('#bCat').onclick = () => {
  const s = showSheet(`<div class="cat-pane"><h2>Categorias</h2><div class="cats-grid in">${CATS().map(catHTML).join('')}</div></div>`, 'one');
  s.addEventListener('click', e => { if (e.target.closest('a.cat')) closeSheet(); });
};
$('#bPerfil').onclick = () => { location.hash = '#/perfil'; if (!me()) openLogin(); };

/* ---------- Login com Google ---------- */
function openLogin(motivo) {
  const s = showSheet(`<div class="login">
    <img src="img/logo.png" alt="" class="login-logo">
    <div class="brand-word on-light">CLOUTS</div>
    <h2>Entre na sua conta</h2>
    <p class="note">${motivo || 'Crie sua conta em segundos com o Google para salvar favoritos e finalizar pedidos.'}</p>
    <button class="btn gbtn block" id="gBtn">${ICON.google} Continuar com Google</button>
    <p class="note" id="gMsg"></p></div>`, 'one narrow');
  $('#gBtn', s).onclick = async () => {
    if (!auth()?.configured) { $('#gMsg', s).textContent = 'O login com Google será ativado assim que a configuração do Firebase for concluída (veja o LEIA-ME).'; return; }
    try { await auth().signIn(); closeSheet(); toast('Bem-vindo(a) à CLOUTS!'); }
    catch (e) { $('#gMsg', s).textContent = e.code === 'auth/popup-closed-by-user' ? 'Login cancelado.' : 'Não foi possível entrar agora. Tente novamente.'; }
  };
}
function onUser(u) {
  favs = store.get(favKey(), []).filter(byId);
  $('#bPerfilLbl').textContent = u ? (u.nome.split(' ')[0] || 'Conta').slice(0, 10) : 'Perfil';
  updateBadges();
  if (routeKey === 'perfil') viewPerfil();
  if (routeKey === 'favoritos') viewFavs();
  if (u && $('#sheet').querySelector('.login')) closeSheet();
  if (u && checkout) renderCart();
}

/* ---------- Detalhe do produto ---------- */
function openSheet(id) {
  const p = byId(id); if (!p) return;
  let sel = null;
  const gal = [p.img, ...(p.extras || [])];
  const sheet = showSheet(`
    <div class="gal"><img class="gal-main" src="${p.img}" alt="${esc(p.nome)}">
      ${gal.length > 1 ? `<div class="gal-th">${gal.map((g, i) => `<img src="${g}" alt="" class="${i ? '' : 'on'}" data-g="${g}">`).join('')}</div>` : ''}</div>
    <div class="pinfo">
      <div class="cod">CÓDIGO ${esc(p.cod)}</div>
      <h2>${esc(p.nome)}</h2>
      <div class="price">${brl(p.preco)}</div>
      <div class="specs"><span>${p.secao === 'feminino' ? 'Feminino' : 'Masculino'}</span><span>${esc(p.modelo)}</span>
        ${p.lycra ? `<span>Lycra ${p.lycra}%</span>` : ''}${p.cor ? `<span>Cor: ${esc(p.cor)}</span>` : ''}${p.tecido ? `<span>${esc(p.tecido)}</span>` : ''}
        ${p.premium ? '<span>Premium</span>' : ''}${p.diamond ? '<span>Diamond</span>' : ''}</div>
      <div><div class="lbl">Tamanho</div><div class="sizes">${sizesAll(p).map(t => `<button class="sz" data-t="${t}" ${p.tam.includes(t) && !p.esgotado ? '' : 'disabled'}>${t}</button>`).join('')}</div></div>
      ${soldOut(p) ? '<button class="btn btn-dark block" disabled>Esgotado</button>' : `<button class="btn btn-gold block" id="addBtn">${ICON.bag} Adicionar ao carrinho</button>`}
      <button class="btn btn-line block" id="favSheet">${ICON.heart} <span>${favs.includes(p.id) ? 'Remover dos favoritos' : 'Favoritar'}</span></button>
      <p class="note">Entrega em Contagem, Betim e Belo Horizonte · Pix e cartão.</p>
    </div>`);
  $$('.gal-th img', sheet).forEach(im => im.onclick = () => {
    $('.gal-main', sheet).src = im.dataset.g; $$('.gal-th img', sheet).forEach(x => x.classList.toggle('on', x === im));
  });
  $$('.sz', sheet).forEach(b => b.onclick = () => { sel = b.dataset.t; $$('.sz', sheet).forEach(x => x.classList.toggle('on', x === b)); });
  if ($('#addBtn', sheet)) $('#addBtn', sheet).onclick = () => {
    if (!sel) { $$('.sz', sheet).forEach(x => { x.classList.remove('err'); void x.offsetWidth; x.classList.add('err'); }); toast('Escolha um tamanho'); return; }
    addToCart(p.id, sel); closeSheet(); openCart();
  };
  $('#favSheet', sheet).onclick = () => { toggleFav(p.id); $('#favSheet span', sheet).textContent = favs.includes(p.id) ? 'Remover dos favoritos' : 'Favoritar'; };
}

function toggleFav(id) {
  favs = favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id];
  saveFavs();
  $$(`[data-fav="${id}"]`).forEach(b => { b.classList.toggle('on', favs.includes(id)); b.setAttribute('aria-pressed', favs.includes(id)); });
  toast(favs.includes(id) ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
}
app.addEventListener('click', e => {
  const f = e.target.closest('[data-fav]'), q = e.target.closest('[data-quick]'), c = e.target.closest('.card');
  if (f) { e.stopPropagation(); toggleFav(f.dataset.fav); if (routeKey === 'favoritos') viewFavs(); }
  else if (q) { e.stopPropagation(); openSheet(q.dataset.quick); }
  else if (c) openSheet(c.dataset.id);
});
app.addEventListener('keydown', e => { const c = e.target.closest('.card'); if (c && e.key === 'Enter' && e.target === c) openSheet(c.dataset.id); });

/* ---------- Frete por CEP (ViaCEP) ---------- */
async function lookupCep(raw) {
  const cep = String(raw).replace(/\D/g, '');
  if (cep.length !== 8) return { ok: false, msg: 'Digite um CEP com 8 números.' };
  let d;
  try { d = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json(); }
  catch {
    // Sem acesso ao ViaCEP: identifica a cidade pela faixa do CEP (aproximado; rua e bairro ficam para o cliente digitar).
    const n = +cep, cidade = n >= 30000000 && n <= 31999999 ? 'Belo Horizonte' : n >= 32000000 && n <= 32399999 ? 'Contagem' : n >= 32600000 && n <= 32699999 ? 'Betim' : null;
    if (!cidade) return { ok: false, msg: `Não foi possível confirmar o CEP. Atendemos ${CONFIG.cidades.join(', ')}.` };
    return { ok: true, data: { cep: cep.replace(/(\d{5})(\d{3})/, '$1-$2'), cidade, bairro: '', rua: '' } };
  }
  if (d.erro) return { ok: false, msg: 'CEP não encontrado.' };
  const cidade = CONFIG.cidades.find(c => norm(c) === norm(d.localidade));
  if (!cidade || d.uf !== 'MG') return { ok: false, msg: `Ainda não entregamos em ${d.localidade}/${d.uf}. Atendemos ${CONFIG.cidades.join(', ')}.` };
  return { ok: true, data: { cep: cep.replace(/(\d{5})(\d{3})/, '$1-$2'), cidade, bairro: d.bairro || '', rua: d.logradouro || '' } };
}
const freteValor = () => {
  if (!ship) return null;
  if (CONFIG.freteGratisAcima != null && cartTotal() >= CONFIG.freteGratisAcima) return 0;
  return CONFIG.frete[ship.cidade] ?? 0;
};
const maskCep = v => v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

/* ---------- Carrinho ---------- */
function addToCart(id, tam) {
  const it = cart.find(i => i.id === id && i.tam === tam);
  if (it) it.q++; else cart.push({ id, tam, q: 1 });
  saveCart(); toast('Adicionado ao carrinho');
}
const cartQty = () => cart.reduce((s, i) => s + i.q, 0);
const cartTotal = () => cart.reduce((s, i) => s + i.q * byId(i.id).preco, 0);

function updateBadges() {
  const n = cartQty();
  [['#cartCount', n], ['#bCartCount', n], ['#favCount', favs.length]].forEach(([s, v]) => { const el = $(s); el.textContent = v; el.hidden = !v; });
}

let checkout = false;
function renderCart() {
  updateBadges();
  $('#cartQtyLbl').textContent = cart.length ? `(${cartQty()} ${cartQty() === 1 ? 'item' : 'itens'})` : '';
  const body = $('#cartBody'), foot = $('#cartFoot');
  if (!cart.length) {
    checkout = false;
    body.innerHTML = `<div class="empty-cart">${ICON.bag}<p><b>Seu carrinho está vazio</b></p><p>Escolha suas calças favoritas.</p></div>`;
    foot.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><a class="btn btn-dark" href="#/feminino">Feminino</a><a class="btn btn-dark" href="#/masculino">Masculino</a></div>`;
    return;
  }
  if (checkout) return renderCheckout();
  body.innerHTML = cart.map((i, idx) => {
    const p = byId(i.id), off = !p.tam.includes(i.tam) || p.esgotado;
    return `<div class="ci"><img src="${p.img}" alt=""><div>${off ? '<div class="warn">Tamanho indisponível no momento. Remova para continuar.</div>' : ''}
      <div class="t">${esc(p.nome)}</div><div class="m">Cód. ${esc(p.cod)} · Tam. ${i.tam}</div>
      <div class="ci-r"><div class="qty"><button data-dec="${idx}" aria-label="Diminuir">−</button><span>${i.q}</span><button data-inc="${idx}" aria-label="Aumentar">+</button></div>
      <b>${brl(p.preco * i.q)}</b></div><button class="rm" data-rm="${idx}">Remover</button></div></div>`;
  }).join('');
  foot.innerHTML = `<form class="cep" id="cepForm"><label for="cepIn">Calcular frete</label>
      <div><input id="cepIn" inputmode="numeric" placeholder="Seu CEP" maxlength="9" autocomplete="postal-code" value="${esc(ship?.cep || '')}"><button class="btn btn-dark" type="submit">Calcular</button></div>
      <p class="note" id="cepMsg">${shipMsg()}</p></form>
    <div class="tot"><span>Subtotal</span><span>${brl(cartTotal())}</span></div>
    <div class="tot"><span>Frete</span><span id="fLbl">${ship ? brl(freteValor()) : '—'}</span></div>
    <div class="tot big"><span>Total</span><b id="tLbl">${brl(cartTotal() + (freteValor() || 0))}</b></div>
    <button class="btn btn-gold block" id="goCheckout">Finalizar pedido</button>`;
  $('#cepIn').oninput = e => { e.target.value = maskCep(e.target.value); };
  $('#cepForm').onsubmit = async e => {
    e.preventDefault(); const m = $('#cepMsg'); m.textContent = 'Consultando…';
    const r = await lookupCep($('#cepIn').value);
    if (!r.ok) { ship = null; store.set('clouts.ship', null); m.textContent = r.msg; m.classList.add('bad'); $('#fLbl').textContent = '—'; $('#tLbl').textContent = brl(cartTotal()); return; }
    ship = { ...ship, ...r.data }; ship.valor = freteValor(); store.set('clouts.ship', ship);
    m.classList.remove('bad'); m.textContent = shipMsg(); $('#fLbl').textContent = brl(freteValor()); $('#tLbl').textContent = brl(cartTotal() + freteValor());
  };
  $('#goCheckout').onclick = () => {
    if (cart.some(i => { const p = byId(i.id); return !p.tam.includes(i.tam) || p.esgotado; })) { toast('Remova os itens indisponíveis'); return; }
    if (auth()?.configured && !me()) { openLogin('Entre com sua conta Google para finalizar o pedido.'); return; }
    if (!ship) { $('#cepMsg').textContent = 'Informe seu CEP para calcular o frete.'; $('#cepMsg').classList.add('bad'); $('#cepIn').focus(); return; }
    checkout = true; renderCart();
  };
}
const shipMsg = () => ship ? `Entrega em ${ship.cidade}${ship.bairro ? ' · ' + ship.bairro : ''}: ${freteValor() === 0 ? 'frete ' + (CONFIG.freteGratisAcima != null && cartTotal() >= CONFIG.freteGratisAcima ? 'grátis' : brl(0)) : brl(freteValor())}` : 'Entregamos em Contagem, Betim e Belo Horizonte.';
$('#cartBody').addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.inc != null) cart[t.dataset.inc].q++;
  else if (t.dataset.dec != null) { const i = cart[t.dataset.dec]; if (--i.q <= 0) cart.splice(t.dataset.dec, 1); }
  else if (t.dataset.rm != null) cart.splice(t.dataset.rm, 1);
  else return;
  saveCart();
});

function renderCheckout() {
  const saved = store.get('clouts.cliente', {}), u = me();
  $('#cartBody').innerHTML = `<form class="form" id="ckForm" novalidate>
    <label>Nome completo<input name="nome" autocomplete="name" required value="${esc(saved.nome || u?.nome || '')}"></label>
    <label>WhatsApp<input name="tel" type="tel" inputmode="tel" autocomplete="tel" placeholder="(31) 90000-0000" required value="${esc(saved.tel || '')}"></label>
    <div class="two"><label>CEP<input name="cep" inputmode="numeric" maxlength="9" required value="${esc(ship.cep)}"></label><label>Cidade<input name="cidade" readonly value="${esc(ship.cidade)}"></label></div>
    <div class="two"><label>Rua<input name="rua" autocomplete="street-address" required value="${esc(ship.rua || saved.rua || '')}"></label><label>Número<input name="num" inputmode="numeric" required value="${esc(saved.num || '')}"></label></div>
    <div class="two"><label>Bairro<input name="bairro" required value="${esc(ship.bairro || saved.bairro || '')}"></label><label>Complemento<input name="comp" value="${esc(saved.comp || '')}"></label></div>
    <fieldset class="pay"><legend>Forma de pagamento</legend>
      <label class="opt"><input type="radio" name="pag" value="Pix" checked><span>${ICON.pix}<b>Pix</b><small>Aprovação imediata. Enviamos a chave/QR Code no WhatsApp.</small></span></label>
      <label class="opt"><input type="radio" name="pag" value="Cartão de crédito"><span>${ICON.card}<b>Cartão de crédito</b><small>Enviamos o link seguro de pagamento no WhatsApp.</small></span></label>
    </fieldset></form>`;
  $('#cartFoot').innerHTML = `<div class="tot"><span>Subtotal</span><span>${brl(cartTotal())}</span></div>
    <div class="tot"><span>Frete (${esc(ship.cidade)})</span><span>${brl(freteValor())}</span></div>
    <div class="tot big"><span>Total</span><b>${brl(cartTotal() + freteValor())}</b></div>
    <button class="btn btn-gold block" id="sendWa">${ICON.chat} Enviar pedido no WhatsApp</button>
    <button class="btn block link" id="backCart">← Voltar ao carrinho</button>`;
  const f = $('#ckForm');
  f.elements.cep.oninput = e => { e.target.value = maskCep(e.target.value); };
  f.elements.cep.onchange = async e => {
    const r = await lookupCep(e.target.value);
    if (!r.ok) { toast(r.msg); e.target.classList.add('err'); return; }
    e.target.classList.remove('err'); ship = { ...ship, ...r.data }; store.set('clouts.ship', ship);
    f.elements.cidade.value = ship.cidade; f.elements.rua.value = ship.rua; f.elements.bairro.value = ship.bairro;
    $('#cartFoot .tot:nth-child(2) span:last-child').textContent = brl(freteValor());
  };
  $('#backCart').onclick = () => { checkout = false; renderCart(); };
  $('#sendWa').onclick = sendOrder;
}
function sendOrder() {
  const f = $('#ckForm'), d = Object.fromEntries(new FormData(f)); let ok = true;
  ['nome', 'tel', 'cep', 'rua', 'num', 'bairro'].forEach(k => { const el = f.elements[k]; const bad = !String(d[k] || '').trim(); el.classList.toggle('err', bad); if (bad) ok = false; });
  if (!ok) { toast('Preencha os campos obrigatórios'); return; }
  store.set('clouts.cliente', { nome: d.nome, tel: d.tel, rua: d.rua, num: d.num, bairro: d.bairro, comp: d.comp });
  const frete = freteValor(), total = cartTotal() + frete;
  const linhas = cart.map(i => { const p = byId(i.id); return `• ${p.nome} — Cód. ${p.cod} — Tam. ${i.tam} — ${i.q}x ${brl(p.preco)}`; });
  const u = me();
  const msg = `*Novo pedido — CLOUTS*\n\n${linhas.join('\n')}\n\n*Subtotal:* ${brl(cartTotal())}\n*Frete (${ship.cidade}):* ${brl(frete)}\n*Total:* ${brl(total)}\n*Pagamento:* ${d.pag}\n\n*Cliente:* ${d.nome}${u?.email ? '\n*E-mail:* ' + u.email : ''}\n*WhatsApp:* ${d.tel}\n*Entrega:* ${d.rua}, ${d.num}${d.comp ? ' — ' + d.comp : ''} — ${d.bairro}, ${ship.cidade} — CEP ${d.cep}`;
  window.open(waLink(msg), '_blank', 'noopener');
}

/* ---------- Init ---------- */
setHH(); updateBadges(); renderCart(); route();
if (auth()) auth().onChange(onUser);
if (window.CloutsDB) CloutsDB.watch(docs => {
  if (!applyCatalog(docs)) return;
  try { localStorage.setItem('clouts.catalogo', JSON.stringify(docs)); } catch {}
  refreshCatalog();
}, e => console.warn('Catálogo online indisponível, usando o catálogo local.', e));
