/* Aba "Solicitações" do painel CLOUTS: peças/tamanhos que os clientes pediram e a loja não tinha.
 * Vira a lista de compra para o fornecedor: agrupa por peça + tamanho, marca como comprada e avisa os clientes por e-mail quando chegar. */
import { collection, onSnapshot, query, orderBy, limit, doc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = t => t?.toMillis?.() ?? null;
const quando = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const ORDEM = ['34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54', 'PP', 'P', 'M', 'G', 'GG', 'GGG'];

export const ouvirSolicitacoes = (db, cb, err) => onSnapshot(query(collection(db, 'solicitacoes'), orderBy('criadoEm', 'desc'), limit(500)),
  s => cb(s.docs.map(d => { const x = d.data(); return { id: d.id, ...x, _t: ms(x.criadoEm) || Date.now() }; })), err);

/* Agrupa por peça + tamanho dentro de um status. */
function agrupar(lista, status, items) {
  const g = new Map();
  lista.filter(s => s.status === status).forEach(s => {
    const k = `${s.produtoId}|${s.tam}`, x = g.get(k) || { k, produtoId: s.produtoId, cod: s.cod, nome: s.nome, tam: s.tam, pedidos: [] };
    x.pedidos.push(s); g.set(k, x);
  });
  return [...g.values()].map(x => ({ ...x, foto: items.find(p => p.id === x.produtoId)?.img || '', ultima: Math.max(...x.pedidos.map(p => p._t)) }))
    .sort((a, b) => b.pedidos.length - a.pedidos.length || ORDEM.indexOf(a.tam) - ORDEM.indexOf(b.tam) || String(a.cod).localeCompare(String(b.cod)));
}
const wa = s => { const t = String(s.whats || '').replace(/\D/g, ''); return t ? `https://wa.me/${t}?text=${encodeURIComponent(`Olá, ${(s.nomeCliente || '').split(' ')[0]}! Aqui é da CLOUTS. A peça ${s.cod} (tam. ${s.tam}) que você pediu chegou!`)}` : ''; };

const linhaGrupo = (g, acao) => `<article class="item sol" data-k="${esc(g.k)}"><div class="sol-foto">${g.foto ? `<img class="thumb" src="${esc(g.foto)}" alt="" loading="lazy">` : '<span class="thumb"></span>'}</div>
  <div class="sol-corpo"><div class="cod">${esc(g.cod)}<span class="tags"><span class="tag">Tam. ${esc(g.tam)}</span><span class="tag ${g.pedidos.length > 1 ? '' : 'g'}">${g.pedidos.length} pedido${g.pedidos.length === 1 ? '' : 's'}</span></span></div>
    <h3>${esc(g.nome)}</h3>
    <div class="ctl">${acao}</div>
    <details class="sol-det"><summary>Quem pediu</summary><ul class="sol-lista">${g.pedidos.map(s => `<li data-id="${esc(s.id)}"><span><b>${esc(s.nomeCliente || 'Cliente')}</b> · ${esc(s.email || '')} · ${quando(s._t)}</span>${wa(s) ? `<a class="btn line sm" href="${wa(s)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<button class="btn danger sm" type="button" data-cancelar>Cancelar</button></li>`).join('')}</ul></details></div></article>`;

export function renderSolicitacoes(box, lista, items, db, toast, avisar) {
  const abertas = agrupar(lista, 'aberta', items), compradas = agrupar(lista, 'comprada', items), hist = lista.filter(s => ['avisada', 'cancelada'].includes(s.status)).slice(0, 25);
  const pessoas = new Set(lista.filter(s => s.status === 'aberta').map(s => s.uid)).size, un = abertas.reduce((a, g) => a + g.pedidos.length, 0);
  box.innerHTML = `<div class="dsh-head"><div><h2>Solicitações de peças</h2><p class="msg">Os clientes pedem aqui a peça e o tamanho que não encontraram. Use como lista de compra no fornecedor: marque como comprada e, quando chegar, avise todo mundo por e-mail com um clique.</p></div></div>
  <div class="kpis small"><div class="kpi ${abertas.length ? 'warn' : ''}"><small>Para comprar</small><b>${abertas.length}</b><span>peça/tamanho diferentes</span></div>
    <div class="kpi"><small>Pedidos abertos</small><b>${un}</b><span>de ${pessoas} cliente${pessoas === 1 ? '' : 's'}</span></div>
    <div class="kpi"><small>Compradas</small><b>${compradas.length}</b><span>aguardando chegar</span></div></div>
  <div class="sol-bar"><h2 class="av-h2" style="margin:0">Para comprar no fornecedor</h2>${abertas.length ? '<button class="btn line sm" id="sol-csv" type="button">Baixar lista (CSV)</button>' : ''}</div>
  <div class="list">${abertas.length ? abertas.map(g => linhaGrupo(g, '<button class="btn gold sm" data-comprada type="button">Marcar como comprada</button>')).join('') : '<div class="empty">Nenhuma solicitação aberta no momento.</div>'}</div>
  <h2 class="av-h2">Compradas, aguardando chegar</h2>
  <div class="list">${compradas.length ? compradas.map(g => linhaGrupo(g, '<button class="btn gold sm" data-chegou type="button">Chegou! Avisar os clientes</button><button class="btn line sm" data-voltar type="button">Voltar para "para comprar"</button>')).join('') : '<div class="empty">Nada aguardando chegada.</div>'}</div>
  ${compradas.length ? '<p class="dsh-note">Quando a peça chegar, lembre de aumentar o estoque do tamanho na aba Peças. O aviso por e-mail leva o cliente direto para a peça.</p>' : ''}
  <details class="sol-hist"><summary>Histórico (${hist.length})</summary><ul class="sol-lista">${hist.map(s => `<li><span><b>${esc(s.cod)}</b> tam. ${esc(s.tam)} · ${esc(s.nomeCliente || '')} · ${quando(s._t)}</span><span class="tag ${s.status === 'avisada' ? '' : 'g'}">${s.status === 'avisada' ? 'Avisada' : 'Cancelada'}</span></li>`).join('') || '<li>Sem histórico ainda.</li>'}</ul></details>`;

  const idsDe = el => { const g = [...abertas, ...compradas].find(x => x.k === el.closest('.sol').dataset.k); return g ? g.pedidos.map(p => p.id) : []; };
  const mudar = async (ids, status, campo) => {
    try { for (let i = 0; i < ids.length; i += 400) { const wb = writeBatch(db); ids.slice(i, i + 400).forEach(id => wb.update(doc(db, 'solicitacoes', id), { status, ...(campo ? { [campo]: serverTimestamp() } : {}) })); await wb.commit(); } return true; }
    catch (e) { toast(e?.code === 'permission-denied' ? 'O Firebase recusou. Publique as regras mais recentes (Firestore Database → Regras).' : 'Não foi possível atualizar. Tente de novo.', true); return false; }
  };
  const armar = (b, t2, fn) => b.onclick = () => { if (!b.dataset.armed) { const t0 = b.textContent; b.dataset.armed = '1'; b.textContent = t2; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = t0; } }, 4000); return; } fn(b); };
  box.querySelectorAll('[data-comprada]').forEach(b => b.onclick = async () => { if (await mudar(idsDe(b), 'comprada', 'compradaEm')) toast('Marcada como comprada. Quando chegar, avise os clientes aqui.'); });
  box.querySelectorAll('[data-voltar]').forEach(b => b.onclick = async () => { if (await mudar(idsDe(b), 'aberta')) toast('Voltou para a lista de compra.'); });
  box.querySelectorAll('[data-chegou]').forEach(b => armar(b, 'Toque de novo: enviar o e-mail agora?', async btn => {
    btn.disabled = true; btn.textContent = 'Enviando e-mails…';
    const r = await avisar(idsDe(btn));
    toast(!r || r.erro ? (r?.erro || 'Não foi possível enviar agora.') : `${r.enviados} cliente${r.enviados === 1 ? '' : 's'} avisado${r.enviados === 1 ? '' : 's'}${r.falhas ? ` (${r.falhas} falha${r.falhas === 1 ? '' : 's'}: tente de novo)` : ''}.`, !r || !!r.erro || (r.falhas && !r.enviados));
  }));
  box.querySelectorAll('[data-cancelar]').forEach(b => armar(b, 'Confirmar', async btn => { if (await mudar([btn.closest('li').dataset.id], 'cancelada')) toast('Solicitação cancelada.'); }));
  const csv = $('#sol-csv', box);
  if (csv) csv.onclick = () => {
    const cel = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [['Código', 'Peça', 'Tamanho', 'Quantidade'].map(cel).join(';'), ...abertas.map(g => [g.cod, g.nome, g.tam, g.pedidos.length].map(cel).join(';'))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'lista-de-compra-fornecedor.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

export const totalAbertas = lista => new Set(lista.filter(s => s.status === 'aberta').map(s => `${s.produtoId}|${s.tam}`)).size;
