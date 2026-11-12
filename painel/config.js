/* Abas "Cupons" e "Site" do painel CLOUTS: liga/desliga cupons, cria códigos promocionais e edita textos da loja. */
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const quando = ms => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const msgErro = e => e?.code === 'permission-denied' ? 'O Firebase recusou. Publique as regras mais recentes (Firestore Database → Regras) e tente de novo.' : 'Não foi possível salvar. Tente de novo.';

export const ouvirConfig = (db, cb, err) => onSnapshot(doc(db, 'config', 'loja'), s => cb(s.exists() ? s.data() : {}), err);
export const ouvirCampanhas = (db, cb, err) => onSnapshot(collection(db, 'campanhas'), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), err);

const salvarCfg = (db, cfg, patch) => setDoc(doc(db, 'config', 'loja'), { ...cfg, ...patch });
const sw = (k, on, titulo, desc) => `<label class="sw cfg-sw"><input type="checkbox" data-cfg="${k}" ${on ? 'checked' : ''}><i></i><span><b>${titulo}</b><small>${desc}</small></span></label>`;

export function renderCupons(box, cfg, camps, db, toast, divulgar) {
  const on = k => cfg[k] !== false;
  const agora = Date.now();
  box.innerHTML = `
  <div class="cfg-card"><h2>Cupons da loja</h2>
    <p class="msg">Ligue ou desligue cada cupom. Desligado, ele some para o cliente e deixa de valer no pagamento, na hora.</p>
    ${sw('cupomPrimeira', on('cupomPrimeira'), 'Cupom de primeira compra (Primeira compra)', 'Quem cria a conta com o Google ganha o cupom e a tela de boas-vindas aparece para quem ainda não entrou. Vale só para quem nunca comprou.')}
    <div class="two cfg-prim"><label class="f" for="p-pct">Desconto (%)<input id="p-pct" type="number" min="1" max="50" value="${Number(cfg.primeiraPct) > 0 ? cfg.primeiraPct : 10}"></label>
      <label class="f" for="p-dias">Validade (dias após criar a conta)<input id="p-dias" type="number" min="1" max="30" value="${Number(cfg.primeiraDias) > 0 ? cfg.primeiraDias : 7}"></label></div>
    <p class="msg" id="p-msg"></p><button class="btn gold" type="button" id="p-save">Salvar desconto da primeira compra</button>
    ${sw('cupomBemvindo', on('cupomBemvindo'), 'Cupom de primeira compra (BEMVINDO · 10%)', 'Quem recebe o código de um amigo ganha 10% na primeira compra. Desligado, o campo "Recebeu um código de amigo?" some.')}
    ${sw('cupomAmigo', on('cupomAmigo'), 'Cupom de indicação (AMIGO · 5% a 20%)', 'Quem convida amigos ganha 5%, 10% ou 20%. Desligado, o convite e o cupom somem da loja.')}
    ${sw('popupConvite', on('popupConvite'), 'Janela "Convide amigos" ao navegar', 'O aviso que aparece depois de alguns segundos na loja.')}
    ${sw('campanhas', on('campanhas'), 'Códigos promocionais (campanhas)', 'Liga ou desliga o campo "Código promocional" no carrinho e todos os códigos abaixo.')}</div>

  <form class="cfg-card" id="campForm"><h2>Disparar um código promocional</h2>
    <p class="msg">Crie um código (ex.: BLACK10), defina o desconto e a validade. O cliente digita no carrinho. Cada cliente usa o mesmo código uma vez.</p>
    <div class="two"><label class="f" for="c-cod">Código<input id="c-cod" type="text" maxlength="20" required placeholder="BLACK10" style="text-transform:uppercase"></label>
      <label class="f" for="c-pct">Desconto (%)<input id="c-pct" type="number" min="1" max="90" required value="10"></label></div>
    <div class="two"><label class="f" for="c-val">Validade<select id="c-val"><option value="0">Sem prazo</option><option value="1">24 horas</option><option value="3">3 dias</option><option value="7" selected>7 dias</option><option value="30">30 dias</option></select></label>
      <label class="f" for="c-desc">Descrição interna (opcional)<input id="c-desc" type="text" maxlength="120" placeholder="Ex.: Campanha do Instagram"></label></div>
    <p class="msg" id="c-msg"></p>
    <button class="btn gold" type="submit">Criar e ativar código</button></form>

  <h2 class="av-h2">Códigos criados</h2>
  <div class="list">${camps.length ? [...camps].sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0)).map(c => {
    const ex = c.expiraEm?.toMillis?.(), vencido = ex && ex < agora, ativo = c.ativo && !vencido;
    return `<article class="item av" data-code="${esc(c.id)}"><div style="grid-column:1/-1"><div class="cod">${esc(c.id)} · ${c.percent}% OFF<span class="tags"><span class="tag ${ativo ? '' : 'g'}">${vencido ? 'Expirado' : c.ativo ? 'Ativo' : 'Pausado'}</span></span></div>
      <div class="meta">${esc(c.descricao || 'Sem descrição')} · ${ex ? 'vale até ' + quando(ex) : 'sem prazo'}</div>
      <div class="ctl"><label class="sw"><input type="checkbox" data-ativo ${c.ativo ? 'checked' : ''}><i></i>Ativo</label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn line sm" data-div type="button">Divulgar no sininho</button><button class="btn danger sm" data-del type="button">Excluir</button></div></div></article>`;
  }).join('') : '<div class="empty">Nenhum código criado ainda.</div>'}</div>`;

  box.querySelectorAll('[data-cfg]').forEach(i => i.onchange = async () => {
    try { await salvarCfg(db, cfg, { [i.dataset.cfg]: i.checked }); toast(i.checked ? 'Ligado. Já vale na loja.' : 'Desligado. Já saiu da loja.'); }
    catch (e) { i.checked = !i.checked; toast(msgErro(e), true); }
  });
  $('#p-save', box).onclick = async () => {
    const m = $('#p-msg', box), pct = Math.round(+$('#p-pct', box).value), dias = Math.round(+$('#p-dias', box).value);
    if (!(pct >= 1 && pct <= 50)) { m.className = 'msg bad'; m.textContent = 'O desconto vai de 1% a 50%.'; return; }
    if (!(dias >= 1 && dias <= 30)) { m.className = 'msg bad'; m.textContent = 'A validade vai de 1 a 30 dias.'; return; }
    try { await salvarCfg(db, cfg, { primeiraPct: pct, primeiraDias: dias }); m.className = 'msg'; m.textContent = ''; toast('Salvo. Já vale na loja.'); } catch (e) { m.className = 'msg bad'; m.textContent = msgErro(e); }
  };
  $('#campForm', box).onsubmit = async e => {
    e.preventDefault(); const m = $('#c-msg', box), id = $('#c-cod', box).value.toUpperCase().replace(/[^A-Z0-9]/g, ''), pct = Math.round(+$('#c-pct', box).value), dias = +$('#c-val', box).value;
    if (id.length < 3) { m.className = 'msg bad'; m.textContent = 'O código precisa de 3 a 20 letras ou números.'; return; }
    if (['AMIGO', 'BEMVINDO'].includes(id)) { m.className = 'msg bad'; m.textContent = 'Esse nome é de um cupom do sistema. Escolha outro.'; return; }
    if (!(pct >= 1 && pct <= 90)) { m.className = 'msg bad'; m.textContent = 'O desconto vai de 1% a 90%.'; return; }
    if (camps.some(c => c.id === id)) { m.className = 'msg bad'; m.textContent = 'Já existe um código com esse nome.'; return; }
    const data = { percent: pct, ativo: true, criadoEm: serverTimestamp(), expiraEm: dias ? Timestamp.fromMillis(Date.now() + dias * 86400000) : null };
    const d = $('#c-desc', box).value.trim(); if (d) data.descricao = d;
    try { await setDoc(doc(db, 'campanhas', id), data); toast(`Código ${id} criado e ativo.`); } catch (er) { m.className = 'msg bad'; m.textContent = msgErro(er); }
  };
  box.querySelectorAll('[data-code]').forEach(card => {
    const id = card.dataset.code, c = camps.find(x => x.id === id);
    card.querySelector('[data-ativo]').onchange = async ev => { try { await updateDoc(doc(db, 'campanhas', id), { ativo: ev.target.checked }); toast(ev.target.checked ? 'Código ativado.' : 'Código pausado.'); } catch (er) { ev.target.checked = !ev.target.checked; toast(msgErro(er), true); } };
    card.querySelector('[data-div]').onclick = () => divulgar(c);
    const del = card.querySelector('[data-del]');
    del.onclick = async () => {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Toque de novo para excluir'; setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = 'Excluir'; } }, 4000); return; }
      try { await deleteDoc(doc(db, 'campanhas', id)); toast('Código excluído.'); } catch (er) { toast(msgErro(er), true); }
    };
  });
}

export function renderSite(box, cfg, db, toast) {
  box.innerHTML = `<form class="cfg-card" id="siteForm"><h2>Textos e contato da loja</h2>
    <p class="msg">O que você mudar aqui aparece na loja na hora, sem precisar publicar nada.</p>
    <label class="f" for="s-barra">Frase da barra dourada do topo <span class="cnt" id="s-cnt">${(cfg.barra || '').length}/140</span><input id="s-barra" type="text" maxlength="140" value="${esc(cfg.barra || '')}" placeholder="Deixe vazio para usar: Entregamos em Contagem · Betim · Belo Horizonte"></label>
    <label class="f" for="s-wa">WhatsApp de pedidos (com DDI e DDD, só números)<input id="s-wa" type="text" inputmode="numeric" maxlength="15" value="${esc(cfg.whatsapp || '')}" placeholder="Ex.: 5531994810359 (vazio = número atual da loja)"></label>
    <h2 style="margin-top:22px">Guia de medidas</h2>
    <p class="msg">Uma linha por tamanho, com as colunas separadas por vírgula. A 1ª linha é o título das colunas. Aparece na página de cada peça. Deixe vazio para esconder.<br>Exemplo: <code>Tamanho, Cintura (cm), Quadril (cm)</code> e na linha de baixo <code>38, 68, 94</code>.</p>
    <label class="f" for="s-guia">Tabela de medidas <span class="cnt" id="g-cnt">${(cfg.guiaMedidas || '').length}/3000</span><textarea id="s-guia" rows="8" maxlength="3000" style="width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid #d9cfb8" placeholder="Tamanho, Cintura (cm), Quadril (cm)">${esc(cfg.guiaMedidas || '')}</textarea></label>
    <h2 style="margin-top:22px">Medição e anúncios</h2>
    <p class="msg">Cole os códigos e a loja passa a medir as visitas e as compras. Só mede quem aceita os cookies. Vazio = desligado.</p>
    <div class="two"><label class="f" for="s-ga">Google Analytics (ID G-XXXXXXX)<input id="s-ga" type="text" maxlength="20" value="${esc(cfg.gaId || '')}" placeholder="G-ABC123XYZ"></label>
      <label class="f" for="s-px">Pixel da Meta (só números)<input id="s-px" type="text" inputmode="numeric" maxlength="20" value="${esc(cfg.pixelId || '')}" placeholder="123456789012345"></label></div>
    <h2 style="margin-top:22px">Fotos (Cloudinary)</h2>
    <p class="msg">Com isto preenchido, as fotos novas vão para o Cloudinary em vez de ficarem dentro do banco, e a loja fica bem mais rápida. Crie a conta gratuita em cloudinary.com, copie o "Cloud name" e crie um "Upload preset" do tipo <b>Unsigned</b>.</p>
    <div class="two"><label class="f" for="s-cn">Cloud name<input id="s-cn" type="text" maxlength="60" value="${esc(cfg.cloudName || '')}" placeholder="meu-cloud"></label>
      <label class="f" for="s-up">Upload preset (Unsigned)<input id="s-up" type="text" maxlength="60" value="${esc(cfg.uploadPreset || '')}" placeholder="clouts"></label></div>
    <p class="msg" id="s-msg"></p>
    <button class="btn gold" type="submit">Salvar</button></form>
  <div class="cfg-card"><h2>Onde editar o resto</h2>
    <ul class="mini"><li><b>Peças</b>: aba Peças (preço, De/Por, fotos, tamanhos, descrição, visibilidade).</li><li><b>Promoções e recados</b>: aba Avisos e promoções.</li><li><b>Cupons e códigos</b>: aba Cupons.</li><li><b>Banners da página inicial e preços de frete</b>: ainda são arquivos do site; me peça a troca que eu faço.</li></ul></div>`;
  $('#s-barra', box).oninput = e => { $('#s-cnt', box).textContent = e.target.value.length + '/140'; };
  $('#s-guia', box).oninput = e => { $('#g-cnt', box).textContent = e.target.value.length + '/3000'; };
  $('#siteForm', box).onsubmit = async e => {
    e.preventDefault(); const m = $('#s-msg', box), wa = $('#s-wa', box).value.replace(/\D/g, ''), barra = $('#s-barra', box).value.trim();
    if (wa && (wa.length < 12 || wa.length > 15)) { m.className = 'msg bad'; m.textContent = 'Digite o WhatsApp com 55 + DDD + número (12 a 13 dígitos).'; return; }
    const ga = $('#s-ga', box).value.trim().toUpperCase(), px = $('#s-px', box).value.replace(/\D/g, ''), cn = $('#s-cn', box).value.trim(), up = $('#s-up', box).value.trim(), guia = $('#s-guia', box).value.trim();
    if (ga && !/^G-[A-Z0-9]{4,15}$/.test(ga)) { m.className = 'msg bad'; m.textContent = 'O ID do Google Analytics começa com G- (ex.: G-ABC123XYZ).'; return; }
    if (cn && !/^[A-Za-z0-9_-]{1,60}$/.test(cn)) { m.className = 'msg bad'; m.textContent = 'Cloud name inválido: use só letras, números, - e _.'; return; }
    if (up && !/^[A-Za-z0-9_-]{1,60}$/.test(up)) { m.className = 'msg bad'; m.textContent = 'Upload preset inválido: use só letras, números, - e _.'; return; }
    const novo = { ...cfg }; if (barra) novo.barra = barra; else delete novo.barra; if (wa) novo.whatsapp = wa; else delete novo.whatsapp;
    [['gaId', ga], ['pixelId', px], ['cloudName', cn], ['uploadPreset', up], ['guiaMedidas', guia]].forEach(([k, v]) => { if (v) novo[k] = v; else delete novo[k]; });
    try { await setDoc(doc(db, 'config', 'loja'), novo); m.className = 'msg'; m.textContent = ''; toast('Salvo. Já está na loja.'); } catch (er) { m.className = 'msg bad'; m.textContent = msgErro(er); }
  };
}
