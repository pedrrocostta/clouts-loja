import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, setPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, writeBatch, addDoc, serverTimestamp, query, orderBy, limit, Timestamp, getDocs, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp({
  apiKey: 'AIzaSyBP1WSRJqAM552UQU5rBRubeVkz7IRc2Ao', authDomain: 'clouts-409b7.firebaseapp.com', projectId: 'clouts-409b7',
  storageBucket: 'clouts-409b7.firebasestorage.app', messagingSenderId: '153191899322', appId: '1:153191899322:web:8ba2688766cc96ff326283'
});
const APPCHECK_SITE_KEY = '';   // mesma chave de auth.js (App Check / reCAPTCHA v3); vazia = desligado
if (APPCHECK_SITE_KEY) {
  try { const ac = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js'); ac.initializeAppCheck(app, { provider: new ac.ReCaptchaV3Provider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true }); } catch (e) { console.warn('App Check:', e); }
}
import { ouvirPedidos, renderDashboard, renderPedidos } from './dashboard.js';
import { ouvirConfig, ouvirCampanhas, renderCupons, renderSite } from './config.js';
const auth = getAuth(app), db = getFirestore(app), col = collection(db, 'produtos');

/* ---------- Segurança ---------- */
// A regra que realmente protege os dados fica no Firestore (firestore.rules). Estas travas são camadas extras.
const ADMINS = ['clouts.oficial2026@gmail.com'];
const IDLE_MS = 20 * 60 * 1000;                       // encerra a sessão após 20 min sem uso
setPersistence(auth, browserSessionPersistence).catch(() => {});   // fechar a aba encerra a sessão

let idleT = null;
const bump = () => { clearTimeout(idleT); if (auth.currentUser) idleT = setTimeout(async () => { await signOut(auth); toast('Sessão encerrada por inatividade. Entre novamente.'); }, IDLE_MS); };
['click', 'keydown', 'touchstart', 'mousemove'].forEach(ev => addEventListener(ev, bump, { passive: true }));

const LK = 'painel.tentativas';                        // limite de tentativas de login neste aparelho
const lockInfo = () => { try { return JSON.parse(localStorage.getItem(LK)) || { n: 0, ate: 0 }; } catch { return { n: 0, ate: 0 }; } };
const lockSave = v => { try { localStorage.setItem(LK, JSON.stringify(v)); } catch {} };
const falta = () => Math.max(0, Math.ceil((lockInfo().ate - Date.now()) / 1000));

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const img = p => /^(data:|https?:)/.test(p.img || '') ? p.img : '/' + (p.img || '');
const TAMS = ['34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54'];   // numeração disponível no cadastro (feminino e masculino)
const SIZES = { feminino: TAMS, masculino: TAMS };
const main = $('#main');
let items = [], unsub = null, unsubAv = null, avisosEnv = [], filtro = { q: '', secao: '', status: '' };

let tT;
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('on'); clearTimeout(tT); tT = setTimeout(() => t.classList.remove('on'), 2600); }
const fail = e => toast(e?.code === 'permission-denied' ? 'Sua conta não tem permissão para alterar o catálogo.' : 'Não foi possível salvar. Verifique a internet e tente de novo.', true);

/* ---------- Login ---------- */
function viewLogin(aviso) {
  $('#topActs').hidden = true; unsub?.(); unsub = null; unsubAv?.(); unsubAv = null; unsubPed?.(); unsubPed = null; pedidos = []; unsubCfg?.(); unsubCfg = null; unsubCamp?.(); unsubCamp = null;
  // Entrada só com a conta Google do dono (com verificação em duas etapas ligada na conta Google). Sem senha própria do painel.
  main.innerHTML = `<form class="login" id="lf"><img src="/img/logo.png" alt=""><h2>Entrar no painel</h2>
    <p class="msg" style="margin:0 0 4px">Entre com a conta Google do administrador.</p>
    <button class="btn gold" id="lb" type="submit">Entrar com o Google</button><p class="msg ${aviso ? 'bad' : ''}" id="lm">${esc(aviso || '')}</p></form>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const b = $('#lb'), m = $('#lm');
    if (falta()) { m.className = 'msg bad'; m.textContent = `Muitas tentativas. Aguarde ${falta()} s.`; return; }
    b.disabled = true; m.className = 'msg'; m.textContent = 'Abrindo o Google…';
    try {
      const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, p); lockSave({ n: 0, ate: 0 }); m.textContent = '';
    } catch (er) {
      if (er?.code === 'auth/popup-closed-by-user' || er?.code === 'auth/cancelled-popup-request') { m.textContent = ''; b.disabled = false; return; }
      const st = lockInfo(), n = st.n + 1;
      lockSave({ n, ate: n >= 5 ? Date.now() + Math.min(15 * 60, 30 * 2 ** (n - 5)) * 1000 : 0 });
      m.className = 'msg bad';
      m.textContent = er?.code === 'auth/popup-blocked' ? 'O navegador bloqueou a janela do Google. Permita pop-ups para este site.' : er?.code === 'auth/unauthorized-domain' ? 'Este endereço não está autorizado no Firebase (Authentication → Configurações → Domínios autorizados).' : 'Não foi possível entrar. Tente de novo.';
      b.disabled = false;
    }
  };
}
$('#outBtn').onclick = () => signOut(auth);
onAuthStateChanged(auth, u => {
  if (!u) { clearTimeout(idleT); return viewLogin(); }
  if (!ADMINS.includes((u.email || '').toLowerCase()) || !u.emailVerified) { signOut(auth); return viewLogin('Esta conta não tem acesso ao painel.'); }
  bump();
  $('#who').textContent = u.email; $('#topActs').hidden = false;
  viewPanel();
  unsubPed?.(); pedErr = false; unsubPed = ouvirPedidos(db, list => { pedidos = list; pedErr = false; if (abaAtual === 'dash') drawDash(); if (abaAtual === 'pedidos' && document.activeElement?.tagName !== 'SELECT') drawPedidos(true); }, () => { pedErr = true; drawDash(); });
  abaAtual = 'dash'; drawDash();
  unsubCfg?.(); unsubCfg = ouvirConfig(db, c => { cfg = c; if (abaAtual === 'cupons') drawCupons(); if (abaAtual === 'site') drawSite(); }, () => {});
  unsubCamp?.(); unsubCamp = ouvirCampanhas(db, l => { camps = l; if (abaAtual === 'cupons') drawCupons(); }, () => {});
  unsub?.(); unsub = onSnapshot(col, snap => { items = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderList(); if (abaAtual === 'dash') drawDash(); },
    e => toast(e.code === 'permission-denied' ? 'Sem permissão para ler o catálogo.' : 'Falha ao carregar o catálogo.', true));
});

/* ---------- Painel ---------- */
function viewPanel() {
  main.innerHTML = `<div class="tabs" role="tablist"><button class="tab on" role="tab" data-tab="dash">Dashboard</button><button class="tab" role="tab" data-tab="pedidos">Pedidos</button><button class="tab" role="tab" data-tab="pecas">Peças</button><button class="tab" role="tab" data-tab="cupons">Cupons</button><button class="tab" role="tab" data-tab="avisos">Avisos e promoções</button><button class="tab" role="tab" data-tab="site">Site</button></div>
    <section id="tabDash"></section><section id="tabPedidos" hidden></section>
    <section id="tabPecas" hidden><div class="bar"><input id="q" type="text" placeholder="Buscar por código, referência ou nome" aria-label="Buscar">
      <select id="fs" aria-label="Seção"><option value="">Todas as seções</option><option value="feminino">Feminino</option><option value="masculino">Masculino</option></select>
      <select id="ft" aria-label="Status"><option value="">Todos os status</option><option value="vis">Visíveis</option><option value="oculta">Ocultas</option><option value="esg">Esgotadas</option></select></div>
    <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap"><div class="stats" id="stats" style="margin:0"></div><button class="btn gold" id="novo">+ Nova peça</button></div>
    <div id="seed"></div><div class="list" id="list"></div></section><section id="tabCupons" hidden></section><section id="tabAvisos" hidden></section><section id="tabSite" hidden></section>`;
  $$('.tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));
  $('#q').oninput = e => { filtro.q = e.target.value; renderList(); };
  $('#fs').onchange = e => { filtro.secao = e.target.value; renderList(); };
  $('#ft').onchange = e => { filtro.status = e.target.value; renderList(); };
  $('#novo').onclick = () => openEditor(null);
}

function showTab(t) {
  $$('.tab').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#tabDash').hidden = t !== 'dash'; $('#tabPedidos').hidden = t !== 'pedidos'; $('#tabPecas').hidden = t !== 'pecas'; $('#tabAvisos').hidden = t !== 'avisos'; $('#tabCupons').hidden = t !== 'cupons'; $('#tabSite').hidden = t !== 'site';
  if (t === 'avisos' && !$('#tabAvisos').firstChild) viewAvisos();
  abaAtual = t; if (t === 'cupons') drawCupons(); if (t === 'site') drawSite(); if (t === 'dash') drawDash(); if (t === 'pedidos') drawPedidos();
}

/* ---------- Cupons e configurações do site ---------- */
let cfg = {}, camps = [], unsubCfg = null, unsubCamp = null;
const drawCupons = () => { const b = $('#tabCupons'); if (!b || b.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'checkbox') return; renderCupons(b, cfg, camps, db, toast, divulgarCampanha); };
const drawSite = () => { const b = $('#tabSite'); if (!b || b.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; renderSite(b, cfg, db, toast); };
async function divulgarCampanha(c) {
  const ex = c.expiraEm?.toMillis?.();
  try {
    await addDoc(collection(db, 'avisos'), { titulo: `Código ${c.id}: ${c.percent}% OFF`, mensagem: `Use o código ${c.id} no carrinho e ganhe ${c.percent}% de desconto no pedido.${ex ? ' Válido por tempo limitado.' : ''}`, tipo: 'promocao', link: '', criadoEm: serverTimestamp(), expiraEm: ex ? Timestamp.fromMillis(ex) : null });
    toast('Divulgado no sininho de todos os clientes.');
  } catch (er) { fail(er); }
}

/* ---------- Dashboard e pedidos ---------- */
let abaAtual = 'dash', pedidos = [], unsubPed = null, periodo = '30', pedFiltro = { q: '', st: '' }, pedErr = false;
const drawDash = () => { const b = $('#tabDash'); if (!b) return;
  if (pedErr) { b.innerHTML = '<div class="dsh-hero"><b>Não foi possível ler os pedidos.</b><span>Publique as regras mais recentes do Firestore (arquivo firestore.rules) e recarregue.</span></div>'; return; }
  renderDashboard(b, pedidos, items, periodo, p => { periodo = p; drawDash(); }); };
const drawPedidos = (keepFocus) => { const b = $('#tabPedidos'); if (!b) return; const had = keepFocus && document.activeElement?.id === 'pq', pos = had ? document.activeElement.selectionStart : 0;
  renderPedidos(b, pedidos, db, toast, pedFiltro, (f, foco) => { pedFiltro = f; drawPedidos(foco); });
  if (had) { const i = $('#pq'); i.focus(); i.setSelectionRange(pos, pos); } };

/* ---------- Avisos e promoções (aparecem no sininho da loja) ---------- */
const LINKS = { '': 'Nenhum (só a mensagem)', '#/feminino': 'Seção Feminino', '#/masculino': 'Seção Masculino', '#/mais-vendidos': 'Mais vendidos', '#/cupons': 'Meus cupons', '#/entrega': 'Entrega' };
const VALIDADE = { '0': 'Sem prazo', '1': '24 horas', '7': '7 dias', '30': '30 dias' };
const quando = ms => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function viewAvisos() {
  const box = $('#tabAvisos');
  box.innerHTML = `<form class="av-form" id="af"><h2>Novo aviso</h2>
    <p class="msg">Aparece no sininho de todos os clientes, na hora. Use para promoções, recados e novidades.</p>
    <div class="two"><label class="f" for="a-tipo">Tipo<select id="a-tipo"><option value="promocao">Promoção</option><option value="aviso">Aviso</option></select></label>
      <label class="f" for="a-val">Fica visível por<select id="a-val">${Object.entries(VALIDADE).map(([k, v]) => `<option value="${k}" ${k === '7' ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <label class="f" for="a-tit">Título <span class="cnt" id="c-tit">0/80</span><input id="a-tit" type="text" maxlength="80" placeholder="Ex.: Frete grátis neste fim de semana" required></label>
    <label class="f" for="a-msg">Mensagem <span class="cnt" id="c-msg">0/400</span><textarea id="a-msg" rows="4" maxlength="400" placeholder="Escreva o recado que o cliente vai ler" required></textarea></label>
    <label class="f" for="a-link">Ao tocar, levar o cliente para<select id="a-link">${Object.entries(LINKS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <div class="av-prev" aria-live="polite"><span class="tag" id="p-tipo">Promoção</span><b id="p-tit">Título do aviso</b><span id="p-msg">A mensagem aparece aqui.</span></div>
    <p class="msg" id="a-msgm"></p>
    <button class="btn gold" id="a-send" type="submit">Enviar para todos os clientes</button></form>
    <h2 class="av-h2">Enviados</h2><div class="list" id="av-list"><div class="empty">Carregando…</div></div>`;
  const $$$ = id => $(id, box);
  const prev = () => { $$$('#p-tipo').textContent = $$$('#a-tipo').value === 'promocao' ? 'Promoção' : 'Aviso'; $$$('#p-tit').textContent = $$$('#a-tit').value || 'Título do aviso'; $$$('#p-msg').textContent = $$$('#a-msg').value || 'A mensagem aparece aqui.';
    $$$('#c-tit').textContent = $$$('#a-tit').value.length + '/80'; $$$('#c-msg').textContent = $$$('#a-msg').value.length + '/400'; };
  ['#a-tipo', '#a-tit', '#a-msg'].forEach(id => $$$(id).addEventListener('input', prev));
  let armed = false, t = null;
  $('#af', box).onsubmit = async e => {
    e.preventDefault(); const b = $$$('#a-send'), m = $$$('#a-msgm');
    const titulo = $$$('#a-tit').value.trim(), mensagem = $$$('#a-msg').value.trim();
    if (!titulo || !mensagem) { m.className = 'msg bad'; m.textContent = 'Preencha o título e a mensagem.'; return; }
    if (!armed) { armed = true; b.textContent = 'Toque de novo para confirmar o envio'; m.className = 'msg'; m.textContent = 'O aviso vai aparecer para todos os clientes agora.'; t = setTimeout(() => { armed = false; b.textContent = 'Enviar para todos os clientes'; m.textContent = ''; }, 5000); return; }
    clearTimeout(t); armed = false; b.disabled = true; b.textContent = 'Enviando…';
    const dias = +$$$('#a-val').value;
    try {
      await addDoc(collection(db, 'avisos'), { titulo, mensagem, tipo: $$$('#a-tipo').value, link: $$$('#a-link').value, criadoEm: serverTimestamp(),
        expiraEm: dias ? Timestamp.fromMillis(Date.now() + dias * 86400000) : null });
      $('#af', box).reset(); $$$('#a-val').value = '7'; prev(); m.className = 'msg'; m.textContent = ''; toast('Aviso enviado aos clientes.');
    } catch (er) { m.className = 'msg bad'; m.textContent = er?.code === 'permission-denied' ? 'O Firebase recusou o envio. Publique as regras mais recentes (Firestore Database → Regras) e tente de novo.' : 'Não foi possível enviar. Tente de novo.'; }
    b.disabled = false; b.textContent = 'Enviar para todos os clientes';
  };
  unsubAv?.(); unsubAv = onSnapshot(query(collection(db, 'avisos'), orderBy('criadoEm', 'desc'), limit(50)), snap => {
    avisosEnv = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderAvisos();
  }, () => { const l = $('#av-list'); if (l) l.innerHTML = '<div class="empty">Não foi possível carregar os avisos.</div>'; });
}

function renderAvisos() {
  const l = $('#av-list'); if (!l) return;
  l.innerHTML = avisosEnv.length ? avisosEnv.map(a => {
    const c = a.criadoEm?.toMillis?.(), ex = a.expiraEm?.toMillis?.(), ativo = !ex || ex > Date.now();
    return `<article class="item av" data-aid="${esc(a.id)}"><div style="grid-column:1/-1"><div class="cod">${a.tipo === 'promocao' ? 'PROMOÇÃO' : 'AVISO'}<span class="tags"><span class="tag ${ativo ? '' : 'g'}">${ativo ? 'No ar' : 'Expirado'}</span></span></div>
      <h3>${esc(a.titulo)}</h3><div class="meta">${esc(a.mensagem)}</div>
      <div class="meta">${c ? 'Enviado em ' + quando(c) : 'Enviando…'}${ex ? ' · até ' + quando(ex) : ' · sem prazo'}${a.link ? ' · leva para ' + esc(LINKS[a.link] || a.link) : ''}</div>
      <button class="btn danger sm" data-delav>Remover</button></div></article>`;
  }).join('') : '<div class="empty">Nenhum aviso enviado ainda.</div>';
}
$('#main').addEventListener('click', async e => {
  const b = e.target.closest('[data-delav]'); if (!b) return;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Toque de novo para remover'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Remover'; } }, 4000); return; }
  try { await deleteDoc(doc(db, 'avisos', b.closest('[data-aid]').dataset.aid)); toast('Aviso removido.'); } catch (er) { fail(er); }
});

function renderList() {
  if (!$('#list')) return;
  const n = x => items.filter(x).length;
  $('#stats').innerHTML = `<span class="pill"><b>${items.length}</b> peças</span><span class="pill"><b>${n(p => p.visivel !== false)}</b> visíveis</span><span class="pill"><b>${n(p => p.visivel === false)}</b> ocultas</span><span class="pill"><b>${n(p => p.esgotado || !(p.tam || []).length)}</b> esgotadas</span>`;
  $('#seed').innerHTML = items.length || typeof PRODUTOS === 'undefined' ? '' : `<div class="seed"><b>O catálogo online está vazio.</b><span>Importe as ${PRODUTOS.length} peças que já estão na loja para começar a gerenciá-las por aqui.</span><button class="btn gold" id="seedBtn">Importar catálogo inicial</button></div>`;
  if ($('#seedBtn')) $('#seedBtn').onclick = seed;
  const q = filtro.q.toLowerCase();
  const list = [...items].filter(p => (!q || (p.cod + ' ' + (p.ref || '') + ' ' + p.nome).toLowerCase().includes(q)) && (!filtro.secao || p.secao === filtro.secao)
    && (!filtro.status || (filtro.status === 'vis' ? p.visivel !== false : filtro.status === 'oculta' ? p.visivel === false : (p.esgotado || !(p.tam || []).length))))
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || String(a.cod).localeCompare(String(b.cod)));
  $('#list').innerHTML = list.length ? list.map(itemHTML).join('') : (items.length ? '<div class="empty">Nenhuma peça encontrada.</div>' : '');
}

function itemHTML(p) {
  const tam = p.tam || [], off = p.visivel === false, out = p.esgotado || !tam.length;
  const sw = (k, on, label, cls = '') => `<label class="sw ${cls}"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><i></i>${label}</label>`;
  return `<article class="item ${off ? 'off' : ''}" data-id="${esc(p.id)}">
    <img class="thumb" src="${esc(img(p))}" alt="" loading="lazy">
    <div><div class="cod">${esc(p.cod)}${p.ref ? ` <small style="font-weight:500;opacity:.75">· Ref. ${esc(p.ref)}</small>` : ''}<span class="tags">${off ? '<span class="tag g">Oculta</span>' : ''}${out ? '<span class="tag r">Esgotada</span>' : ''}${p.maisVendido ? '<span class="tag">Mais vendido</span>' : ''}</span></div>
      <h3>${esc(p.nome)}</h3><div class="meta">${p.secao === 'feminino' ? 'Feminino' : 'Masculino'} · ${esc(p.modelo || '')} · ${brl(p.preco)}</div>
      <div class="ctl">${sw('visivel', !off, 'Visível na loja')}${sw('esgotado', !!p.esgotado, 'Esgotado', 'warn')}${sw('maisVendido', !!p.maisVendido, 'Mais vendido')}</div>
      <div class="sizes" role="group" aria-label="Tamanhos disponíveis">${(SIZES[p.secao] || SIZES.feminino).map(t => `<button class="sz ${tam.includes(t) ? 'on' : ''}" data-t="${t}" aria-pressed="${tam.includes(t)}">${t}</button>`).join('')}</div>
      <button class="btn line sm" data-edit>Editar detalhes</button></div></article>`;
}

$('#main').addEventListener('change', async e => {
  const cb = e.target.closest('input[data-k]'); if (!cb) return;
  const p = items.find(x => x.id === cb.closest('.item').dataset.id), k = cb.dataset.k, v = cb.checked;
  const patch = k === 'visivel' ? { visivel: v } : k === 'esgotado' ? { esgotado: v } : { maisVendido: v, rankMV: v ? Math.max(0, ...items.map(x => x.rankMV ?? 0)) + 1 : null };
  try { await updateDoc(doc(db, 'produtos', p.id), patch); toast('Salvo. Já está na loja.'); } catch (er) { cb.checked = !v; fail(er); }
});
$('#main').addEventListener('click', async e => {
  const it = e.target.closest('.item'); if (!it) return;
  const p = items.find(x => x.id === it.dataset.id);
  if (e.target.closest('[data-edit]')) return openEditor(p);
  const sz = e.target.closest('.sz'); if (!sz) return;
  const t = sz.dataset.t, cur = p.tam || [], tam = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
  const order = SIZES[p.secao] || SIZES.feminino; tam.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  try { await updateDoc(doc(db, 'produtos', p.id), { tam }); toast(tam.length ? 'Tamanhos salvos.' : 'Sem tamanhos: a peça aparece como esgotada.'); } catch (er) { fail(er); }
});

/* ---------- Importar catálogo inicial ---------- */
async function seed() {
  const b = $('#seedBtn'); b.disabled = true; b.textContent = 'Importando…';
  try {
    const all = PRODUTOS.map((p, i) => {
      const r = MAIS_VENDIDOS.indexOf(p.id);
      return { ...JSON.parse(JSON.stringify(p)), visivel: true, esgotado: false, ordem: i * 10, maisVendido: r >= 0, rankMV: r >= 0 ? r + 1 : null };
    });
    for (let i = 0; i < all.length; i += 400) {
      const wb = writeBatch(db); all.slice(i, i + 400).forEach(p => wb.set(doc(db, 'produtos', p.id), p)); await wb.commit();
    }
    toast('Catálogo importado.');
  } catch (er) { fail(er); b.disabled = false; b.textContent = 'Importar catálogo inicial'; }
}

/* ---------- Editor ---------- */
function shrink(file, max = 900) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / im.width), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let q = .84, d = c.toDataURL('image/jpeg', q);
      while (d.length > 700000 && q > .4) { q -= .08; d = c.toDataURL('image/jpeg', q); }
      d.length > 900000 ? no(new Error('grande')) : ok(d);
    };
    im.onerror = () => no(new Error('imagem')); im.src = url;
  });
}

function openEditor(p) {
  const novo = !p, d = p || { secao: 'feminino', tam: [], visivel: true, esgotado: false, preco: 0, modelo: '' };
  let fotos = d.img ? [d.img, ...(d.extras || [])] : [], tam = [...(d.tam || [])], secao = d.secao, antigas = Number(d.nFotos || 0);
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<form class="card" id="ef"><h2>${novo ? 'Nova peça' : 'Editar peça'}</h2>
    <div class="two"><label class="f" for="e-cod">Código<input id="e-cod" type="text" required value="${esc(d.cod || '')}" maxlength="40"></label>
      <label class="f" for="e-sec">Seção<select id="e-sec" ${novo ? '' : 'disabled'}><option value="feminino">Feminino</option><option value="masculino">Masculino</option></select></label></div>
    <label class="f" for="e-nome">Nome<input id="e-nome" type="text" required value="${esc(d.nome || '')}" placeholder="Ex.: Calça Wide Leg 112999-1"></label>
    <label class="f" for="e-ref">Referência do fornecedor (opcional)<input id="e-ref" type="text" maxlength="60" value="${esc(d.ref || '')}" placeholder="Ex.: a referência que aparece no site do fornecedor"></label>
    <div class="two"><label class="f" for="e-mod">Modelagem<input id="e-mod" type="text" list="mods" value="${esc(d.modelo || '')}" placeholder="Cigarrete, Wide Leg, Slim Fit…"><datalist id="mods">${[...new Set(items.map(x => x.modelo).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <label class="f" for="e-pre">Preço (R$)<input id="e-pre" type="number" min="0" step="0.01" inputmode="decimal" value="${d.preco ?? 0}"></label></div>
    <label class="f" for="e-pant">Preço anterior (R$, opcional) — mostra "De R$ … por R$ …" na loja<input id="e-pant" type="number" min="0" step="0.01" inputmode="decimal" value="${d.precoAntigo || ''}" placeholder="Deixe vazio se não houver promoção"></label>
    <div class="two"><label class="f" for="e-cor">Cor (opcional)<input id="e-cor" type="text" value="${esc(d.cor || '')}"></label>
      <label class="f" for="e-lyc">Lycra % (opcional)<input id="e-lyc" type="number" min="0" max="20" value="${d.lycra ?? ''}"></label></div>
    <label class="f" for="e-tec">Tecido (opcional)<input id="e-tec" type="text" value="${esc(d.tecido || '')}"></label>
    <label class="f" for="e-desc">Descrição (opcional)<textarea id="e-desc" rows="4" maxlength="600" placeholder="Ex.: Calça wide leg de cintura alta, com elastano para mais conforto." style="width:100%;resize:vertical;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid #d9cfb8">${esc(d.descricao || '')}</textarea></label>
    <div><div class="f" style="font-size:12px;font-weight:600;margin-bottom:6px">Tamanhos disponíveis</div><div class="sizes" id="e-sz"></div></div>
    <div class="ctl"><label class="sw"><input type="checkbox" id="e-vis" ${d.visivel !== false ? 'checked' : ''}><i></i>Visível na loja</label>
      <label class="sw warn"><input type="checkbox" id="e-esg" ${d.esgotado ? 'checked' : ''}><i></i>Esgotado</label>
      <label class="sw"><input type="checkbox" id="e-pre2" ${d.premium ? 'checked' : ''}><i></i>Premium</label>
      <label class="sw"><input type="checkbox" id="e-dia" ${d.diamond ? 'checked' : ''}><i></i>Diamond</label></div>
    <div class="gal-ed"><div class="f" style="font-size:12px;font-weight:600">Fotos da peça <span class="cnt" id="g-cnt"></span></div>
      <p class="msg">A 1ª foto é a principal (capa na loja). Adicione de 1 a 10 fotos, por exemplo uma por cor. Use fotos verticais (3:4). Elas são ajustadas automaticamente.</p>
      <div class="gal-grid" id="g-grid"></div>
      <label class="btn line sm" for="e-file" id="g-add" style="cursor:pointer">+ Adicionar fotos</label><input id="e-file" type="file" accept="image/*" multiple hidden></div>
    <p class="msg" id="e-msg"></p>
    <div class="acts"><div>${novo ? '' : '<button class="btn danger sm" type="button" id="e-del">Excluir peça</button>'}</div>
      <div style="display:flex;gap:10px"><button class="btn line" type="button" id="e-can">Cancelar</button><button class="btn gold" type="submit" id="e-ok">Salvar</button></div></div></form>`;
  document.body.appendChild(m);
  const close = () => m.remove(), msg = (t, bad) => { const e = $('#e-msg', m); e.textContent = t; e.className = 'msg' + (bad ? ' bad' : ''); };
  $('#e-sec', m).value = secao;
  const drawSizes = () => {
    $('#e-sz', m).innerHTML = SIZES[secao].map(t => `<button type="button" class="sz ${tam.includes(t) ? 'on' : ''}" data-t="${t}" aria-pressed="${tam.includes(t)}">${t}</button>`).join('');
  };
  drawSizes();
  $('#e-sec', m).onchange = e => { secao = e.target.value; drawSizes(); };
  $('#e-sz', m).onclick = e => { const b = e.target.closest('.sz'); if (!b) return; const t = b.dataset.t; tam = tam.includes(t) ? tam.filter(x => x !== t) : [...tam, t]; drawSizes(); };
  const src = u => /^(data:|https?:)/.test(u) ? u : '/' + u;
  const drawFotos = () => {
    $('#g-grid', m).innerHTML = fotos.map((f, i) => `<div class="g-it ${i ? '' : 'main'}" data-i="${i}"><img src="${esc(src(f))}" alt="">${i ? '' : '<span class="g-tag">Principal</span>'}
      <div class="g-bt"><button type="button" data-a="l" ${i ? '' : 'disabled'} aria-label="Mover para antes">←</button><button type="button" data-a="r" ${i < fotos.length - 1 ? '' : 'disabled'} aria-label="Mover para depois">→</button><button type="button" data-a="x" aria-label="Remover foto">✕</button></div></div>`).join('');
    $('#g-cnt', m).textContent = `(${fotos.length}/10)`; $('#g-add', m).style.display = fotos.length >= 10 ? 'none' : '';
  };
  drawFotos();
  if (!novo && antigas) getDocs(collection(db, 'produtos', p.id, 'fotos')).then(sn => {
    const ex = sn.docs.map(x => x.data()).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map(x => x.img);
    if (ex.length && fotos.length <= 1 + (d.extras || []).length) { fotos = [d.img, ...ex]; drawFotos(); }
  }).catch(() => {});
  $('#g-grid', m).onclick = e => {
    const b = e.target.closest('button[data-a]'); if (!b) return; const i = +b.closest('.g-it').dataset.i, a = b.dataset.a;
    if (a === 'x') fotos.splice(i, 1); else { const j = a === 'l' ? i - 1 : i + 1; [fotos[i], fotos[j]] = [fotos[j], fotos[i]]; }
    drawFotos();
  };
  $('#e-file', m).onchange = async e => {
    const fs = [...e.target.files].slice(0, 10 - fotos.length); e.target.value = ''; if (!fs.length) return; msg('Ajustando fotos…');
    let falhou = 0; for (const f of fs) { try { fotos.push(await shrink(f)); drawFotos(); } catch { falhou++; } }
    msg(falhou ? `${falhou} foto(s) não puderam ser usadas. Tente outras.` : 'Fotos prontas.', !!falhou);
  };
  $('#e-can', m).onclick = close;
  m.addEventListener('mousedown', e => { if (e.target === m) close(); });
  if (!novo) {
    let armed = false;
    $('#e-del', m).onclick = async e => {
      if (!armed) { armed = true; e.target.textContent = 'Toque de novo para confirmar'; setTimeout(() => { armed = false; if (e.target.isConnected) e.target.textContent = 'Excluir peça'; }, 4000); return; }
      try { await deleteDoc(doc(db, 'produtos', p.id)); toast('Peça excluída.'); close(); } catch (er) { fail(er); }
    };
  }
  $('#ef', m).onsubmit = async e => {
    e.preventDefault();
    const cod = $('#e-cod', m).value.trim(), nome = $('#e-nome', m).value.trim();
    if (!cod || !nome) return msg('Preencha código e nome.', true);
    if (!fotos.length) return msg('Envie pelo menos uma foto da peça.', true);
    const id = novo ? (secao[0] + '-' + cod.replace(/[^A-Za-z0-9-]/g, '')) : p.id;
    if (novo && items.some(x => x.id === id)) return msg('Já existe uma peça com esse código.', true);
    // Código igual ao de outra peça confunde a busca e os pedidos (o código pode ser editado; o endereço interno da peça não muda).
    if (items.some(x => x.id !== id && String(x.cod).trim().toLowerCase() === cod.toLowerCase())) return msg('Já existe outra peça com esse código.', true);
    const lyc = $('#e-lyc', m).value;
    const data = {
      cod, nome, ref: $('#e-ref', m).value.trim(), secao, modelo: $('#e-mod', m).value.trim(), preco: Math.max(0, parseFloat($('#e-pre', m).value) || 0),
      cor: $('#e-cor', m).value.trim() || null, tecido: $('#e-tec', m).value.trim() || null, lycra: lyc === '' ? null : +lyc,
      tam, visivel: $('#e-vis', m).checked, esgotado: $('#e-esg', m).checked, premium: $('#e-pre2', m).checked, diamond: $('#e-dia', m).checked, img: fotos[0], extras: [], nFotos: fotos.length - 1
    };
    // Só grava a descrição quando há texto (ou quando já existia e foi apagada), para não exigir campo vazio nas regras.
    const desc = $('#e-desc', m).value.trim(); if (desc || p?.descricao) data.descricao = desc;
    const pant = Math.max(0, parseFloat($('#e-pant', m).value) || 0);
    if (pant && pant <= data.preco) return msg('O preço anterior precisa ser maior que o preço atual.', true);
    if (pant || p?.precoAntigo) data.precoAntigo = pant;
    if (novo) Object.assign(data, { ordem: Math.min(0, ...items.map(x => x.ordem ?? 0)) - 10, maisVendido: false, rankMV: null, extras: [] });
    const b = $('#e-ok', m); b.disabled = true; msg('Salvando…');
    try {
      await setDoc(doc(db, 'produtos', id), data, { merge: true });
      const wb = writeBatch(db);
      fotos.slice(1).forEach((f, i) => wb.set(doc(db, 'produtos', id, 'fotos', String(i + 1)), { img: f, ordem: i + 1 }));
      for (let i = fotos.length; i <= Math.max(antigas, 9); i++) wb.delete(doc(db, 'produtos', id, 'fotos', String(i)));
      await wb.commit(); toast('Salvo. Já está na loja.'); close();
    }
    catch (er) { b.disabled = false; msg(er?.code === 'permission-denied' ? 'Sua conta não tem permissão para alterar o catálogo.' : 'Não foi possível salvar. Se a foto for muito grande, use uma menor.', true); }
  };
}
