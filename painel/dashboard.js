/* Dashboard e pedidos do painel CLOUTS. Lê a coleção "pedidos" (criada pelo servidor quando o cliente paga online). */
import { collection, onSnapshot, query, orderBy, limit, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = v => Number(v || 0).toLocaleString('pt-BR');
const ms = t => t?.toMillis?.() ?? (typeof t === 'number' ? t : null);
const DIA = 86400000;
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const STATUS = { aguardando: ['Aguardando', 'g'], pago: ['Pago', 'ok'], cancelado: ['Cancelado', 'r'], recusado: ['Recusado', 'r'], divergente: ['Valor divergente', 'r'] };
const ANDAMENTO = { novo: 'Novo', preparando: 'Preparando', enviado: 'Saiu para entrega', entregue: 'Entregue' };
const PERIODOS = { hoje: 'Hoje', '7': '7 dias', '30': '30 dias', '90': '90 dias', tudo: 'Tudo' };

/* Escuta os pedidos em tempo real (últimos 500). */
export function ouvirPedidos(db, onChange, onErr) {
  return onSnapshot(query(collection(db, 'pedidos'), orderBy('criadoEm', 'desc'), limit(500)),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data(), _t: ms(d.data().criadoEm) || Date.now() }))),
    e => onErr && onErr(e));
}

const desde = p => p === 'tudo' ? 0 : p === 'hoje' ? startOfDay(Date.now()) : startOfDay(Date.now() - (Number(p) - 1) * DIA);
const barras = (rows, fmt = num) => {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return rows.length ? `<ul class="hb">${rows.map(([k, v, extra]) => `<li><span class="hb-k">${esc(k)}</span><span class="hb-b"><i style="width:${Math.max(3, v / max * 100)}%"></i></span><span class="hb-v">${fmt(v)}${extra ? `<small>${esc(extra)}</small>` : ''}</span></li>`).join('')}</ul>` : '<p class="dsh-empty">Sem dados no período.</p>';
};

export function renderDashboard(box, orders, items, periodo = '30', setPeriodo) {
  const t0 = desde(periodo), inP = orders.filter(o => o._t >= t0);
  const pagos = inP.filter(o => o.status === 'pago');
  const fat = pagos.reduce((s, o) => s + (o.total || 0), 0), n = pagos.length;
  const pecas = pagos.reduce((s, o) => s + (o.itens || []).reduce((a, i) => a + (i.q || 0), 0), 0);
  const desc = pagos.reduce((s, o) => s + (o.desconto || 0), 0), fret = pagos.reduce((s, o) => s + (o.frete || 0), 0);
  const aguard = inP.filter(o => o.status === 'aguardando'), recus = inP.filter(o => o.status === 'recusado');
  const conv = inP.length ? Math.round(n / inP.length * 100) : 0;
  const compras = {}; orders.filter(o => o.status === 'pago').forEach(o => { compras[o.uid] = (compras[o.uid] || 0) + 1; });
  const clientes = new Set(pagos.map(o => o.uid)), recorrentes = [...clientes].filter(u => compras[u] > 1).length;
  const novosEntregar = orders.filter(o => o.status === 'pago' && (o.andamento || 'novo') !== 'entregue').length;

  // Vendas por dia
  const dias = periodo === 'hoje' ? 1 : periodo === 'tudo' ? Math.min(90, Math.max(7, Math.ceil((Date.now() - (orders.at(-1)?._t || Date.now())) / DIA) + 1)) : Number(periodo);
  const serie = Array.from({ length: dias }, (_, i) => { const d = startOfDay(Date.now() - (dias - 1 - i) * DIA); return { d, v: 0, n: 0 }; });
  pagos.forEach(o => { const k = serie.find(s => o._t >= s.d && o._t < s.d + DIA); if (k) { k.v += o.total || 0; k.n++; } });
  const maxD = Math.max(1, ...serie.map(s => s.v));

  // Peças mais pedidas
  const prod = {};
  pagos.forEach(o => (o.itens || []).forEach(i => { const p = prod[i.id] ??= { id: i.id, nome: i.nome, cod: i.cod, q: 0, v: 0 }; p.q += i.q || 0; p.v += (i.q || 0) * (i.preco || 0); }));
  const top = Object.values(prod).sort((a, b) => b.q - a.q || b.v - a.v).slice(0, 6), maxQ = Math.max(1, ...top.map(p => p.q));
  const img = id => items.find(x => x.id === id)?.img || '';
  const semVenda = items.filter(p => p.visivel !== false && !p.esgotado && !prod[p.id]).length;

  // Quebras
  const soma = (fn, key) => { const m = {}; pagos.forEach(o => fn(o).forEach(([k, q]) => { m[k] = (m[k] || 0) + q; })); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const porCidade = soma(o => [[o.cidade || '—', o.total || 0]]);
  const porTam = soma(o => (o.itens || []).map(i => ['Tam. ' + i.tam, i.q || 0]));
  const secao = i => items.find(x => x.id === i.id)?.secao || (String(i.id).startsWith('m') ? 'masculino' : 'feminino');
  const porSecao = soma(o => (o.itens || []).map(i => [secao(i) === 'masculino' ? 'Masculino' : 'Feminino', (i.q || 0) * (i.preco || 0)]));
  const semana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'], porDia = semana.map(d => [d, 0]);
  pagos.forEach(o => { porDia[new Date(o._t).getDay()][1] += o.total || 0; });
  const faixas = [['Madrugada (0–6h)', 0, 6], ['Manhã (6–12h)', 6, 12], ['Tarde (12–18h)', 12, 18], ['Noite (18–24h)', 18, 24]].map(([k, a, b]) => [k, pagos.filter(o => { const h = new Date(o._t).getHours(); return h >= a && h < b; }).length]);
  const comCupom = pagos.filter(o => o.cupom), indicados = pagos.filter(o => o.ref);

  // Saúde do catálogo
  const total = items.length, ocultas = items.filter(p => p.visivel === false).length, esg = items.filter(p => p.esgotado).length;
  const semPreco = items.filter(p => !(p.preco > 0)).length, semDesc = items.filter(p => !p.descricao).length, promo = items.filter(p => p.precoAntigo > p.preco && p.preco > 0).length;

  box.innerHTML = `
  <div class="dsh-head"><div><h2>Visão geral</h2><p class="msg">Vendas confirmadas: pagas pelo Mercado Pago ou confirmadas por você nos pedidos do WhatsApp (aba Pedidos → Confirmar venda).</p></div>
    <div class="seg" role="group" aria-label="Período">${Object.entries(PERIODOS).map(([k, v]) => `<button type="button" data-per="${k}" class="${k === periodo ? 'on' : ''}">${v}</button>`).join('')}</div></div>
  ${orders.length ? '' : `<div class="dsh-hero"><b>Ainda não há pedidos.</b><span>Cada pedido que um cliente logado enviar pelo WhatsApp aparece na aba Pedidos. Ao confirmar a venda, ela entra aqui: faturamento, peças vendidas, mais pedidas e muito mais.</span></div>`}
  <div class="kpis">
    <div class="kpi gold"><small>Faturamento</small><b>${brl(fat)}</b><span>${n} ${n === 1 ? 'pedido pago' : 'pedidos pagos'}</span></div>
    <div class="kpi"><small>Peças vendidas</small><b>${num(pecas)}</b><span>${n ? (pecas / n).toFixed(1).replace('.', ',') + ' por pedido' : '—'}</span></div>
    <div class="kpi"><small>Ticket médio</small><b>${brl(n ? fat / n : 0)}</b><span>por pedido</span></div>
    <div class="kpi"><small>Para entregar</small><b>${novosEntregar}</b><span>pagos, ainda não entregues</span></div>
    <div class="kpi"><small>Aguardando confirmação</small><b>${aguard.length}</b><span>${brl(aguard.reduce((s, o) => s + (o.total || 0), 0))} em aberto</span></div>
    <div class="kpi"><small>Conversão</small><b>${conv}%</b><span>${n} pagos de ${inP.length} criados</span></div>
    <div class="kpi"><small>Clientes</small><b>${clientes.size}</b><span>${recorrentes} ${recorrentes === 1 ? 'voltou' : 'voltaram'} a comprar</span></div>
    <div class="kpi"><small>Descontos dados</small><b>${brl(desc)}</b><span>frete cobrado: ${brl(fret)}</span></div>
  </div>

  <section class="dsh-card"><h3>Vendas por dia</h3>
    <div class="vb" role="img" aria-label="Faturamento por dia">${serie.map(s => `<div class="vb-c" title="${new Date(s.d).toLocaleDateString('pt-BR')}: ${brl(s.v)} (${s.n} pedido${s.n === 1 ? '' : 's'})"><i style="height:${s.v ? Math.max(4, s.v / maxD * 100) : 1}%" class="${s.v ? '' : 'z'}"></i>${dias <= 14 ? `<span>${new Date(s.d).getDate()}</span>` : ''}</div>`).join('')}</div></section>

  <div class="dsh-grid">
    <section class="dsh-card"><h3>Peças mais pedidas</h3>
      ${top.length ? `<ol class="top">${top.map((p, i) => `<li><span class="rk">${i + 1}</span>${img(p.id) ? `<img src="${esc(img(p.id))}" alt="">` : '<span class="ph"></span>'}<div><b>${esc(p.nome)}</b><small>Cód. ${esc(p.cod)} · ${brl(p.v)}</small><span class="hb-b"><i style="width:${p.q / maxQ * 100}%"></i></span></div><em>${p.q}<small> un.</small></em></li>`).join('')}</ol>` : '<p class="dsh-empty">Nenhuma venda no período.</p>'}
      <p class="dsh-note">${semVenda} peça${semVenda === 1 ? '' : 's'} visível${semVenda === 1 ? '' : 'is'} sem nenhuma venda no período.</p></section>
    <section class="dsh-card"><h3>Feminino × Masculino</h3>${barras(porSecao, brl)}
      <h3 style="margin-top:18px">Tamanhos mais vendidos</h3>${barras(porTam.slice(0, 6))}</section>
    <section class="dsh-card"><h3>Faturamento por cidade</h3>${barras(porCidade, brl)}
      <h3 style="margin-top:18px">Dia da semana</h3>${barras(porDia, brl)}</section>
    <section class="dsh-card"><h3>Horário das compras</h3>${barras(faixas)}
      <h3 style="margin-top:18px">Cupons e indicações</h3>
      <ul class="mini"><li><b>${comCupom.length}</b> pedido${comCupom.length === 1 ? '' : 's'} com cupom (${n ? Math.round(comCupom.length / n * 100) : 0}%)</li><li><b>${indicados.length}</b> venda${indicados.length === 1 ? '' : 's'} vinda${indicados.length === 1 ? '' : 's'} de código de amigo</li><li><b>${recus.length}</b> pagamento${recus.length === 1 ? '' : 's'} recusado${recus.length === 1 ? '' : 's'}</li></ul></section>
  </div>

  <section class="dsh-card"><h3>Saúde do catálogo</h3>
    <div class="kpis small"><div class="kpi"><small>Peças</small><b>${total}</b></div><div class="kpi ${ocultas ? 'warn' : ''}"><small>Ocultas</small><b>${ocultas}</b></div><div class="kpi ${esg ? 'warn' : ''}"><small>Esgotadas</small><b>${esg}</b></div>
      <div class="kpi ${semPreco ? 'bad' : ''}"><small>Sem preço</small><b>${semPreco}</b></div><div class="kpi"><small>Sem descrição</small><b>${semDesc}</b></div><div class="kpi"><small>Em promoção (De/Por)</small><b>${promo}</b></div></div>
    ${semPreco ? '<p class="dsh-note bad">Peças sem preço não podem ser pagas online. Defina os preços na aba Peças.</p>' : ''}</section>`;
  box.querySelectorAll('[data-per]').forEach(b => b.onclick = () => setPeriodo(b.dataset.per));
}

/* Lista de pedidos: filtros, andamento da entrega, WhatsApp do cliente e planilha CSV. */
export function renderPedidos(box, orders, db, toast, filtro, setFiltro) {
  const q = (filtro.q || '').toLowerCase();
  const list = orders.filter(o => (!filtro.st || o.status === filtro.st) && (!q || [o.id, o.cliente?.nome, o.cliente?.tel, o.email, ...(o.itens || []).map(i => i.cod + ' ' + i.nome)].join(' ').toLowerCase().includes(q)));
  const wa = o => { const t = String(o.cliente?.tel || '').replace(/\D/g, ''); return t ? `https://wa.me/${t.length <= 11 ? '55' + t : t}?text=${encodeURIComponent(`Olá, ${(o.cliente?.nome || '').split(' ')[0]}! Aqui é da CLOUTS sobre o seu pedido ${o.id.slice(0, 6).toUpperCase()}.`)}` : ''; };
  box.innerHTML = `<div class="bar"><input id="pq" type="text" placeholder="Buscar por cliente, WhatsApp, código ou pedido" value="${esc(filtro.q || '')}" aria-label="Buscar pedido">
    <select id="pst" aria-label="Status"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${filtro.st === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
    <button class="btn line sm" id="csv" type="button">Baixar planilha (CSV)</button></div>
    <p class="msg">${list.length} pedido${list.length === 1 ? '' : 's'}${orders.length >= 500 ? ' (mostrando os 500 mais recentes)' : ''}</p>
    <div class="list ord">${list.length ? list.map(o => { const st = STATUS[o.status] || [o.status, 'g'], c = o.cliente || {}; return `
    <article class="item ordc" data-id="${esc(o.id)}"><div style="grid-column:1/-1">
      <div class="cod">#${esc(o.id.slice(0, 6).toUpperCase())} · ${new Date(o._t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}<span class="tags"><span class="tag ${st[1]}">${st[0]}</span>${o.cupom ? `<span class="tag">Cupom ${esc(o.cupom)} ${o.percent}%</span>` : ''}${o.ref ? '<span class="tag">Código de amigo</span>' : ''}<span class="tag g">${o.origem === 'whatsapp' ? 'WhatsApp' : 'Mercado Pago'}</span></span></div>
      <p class="ord-cli"><b>${esc(c.nome || '—')}</b> · ${esc(c.tel || '')} · ${esc(o.email || '')}</p>
      <p class="ord-end">${esc(c.rua || '')}, ${esc(c.num || '')}${c.comp ? ' — ' + esc(c.comp) : ''} — ${esc(c.bairro || '')}, ${esc(o.cidade || '')} · CEP ${esc(c.cep || '')}</p>
      <ul class="ord-it">${(o.itens || []).map(i => `<li>${i.q}× ${esc(i.nome)} <small>Cód. ${esc(i.cod)} · Tam. ${esc(i.tam)}</small><b>${brl(i.q * i.preco)}</b></li>`).join('')}</ul>
      <div class="ord-ft"><span>Subtotal ${brl(o.subtotal)}${o.desconto ? ` · desconto −${brl(o.desconto)}` : ''} · frete ${brl(o.frete)}</span><b>${brl(o.total)}</b></div>
      <div class="ord-act">${o.origem === 'whatsapp' && o.status === 'aguardando' ? '<button class="btn gold sm" data-conf type="button">Confirmar venda</button><button class="btn danger sm" data-canc type="button">Cancelar pedido</button>' : ''}${o.status === 'pago' ? `<label class="f">Andamento<select data-and>${Object.entries(ANDAMENTO).map(([k, v]) => `<option value="${k}" ${(o.andamento || 'novo') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
        ${wa(o) ? `<a class="btn line sm" href="${wa(o)}" target="_blank" rel="noopener">WhatsApp do cliente</a>` : ''}</div></div></article>`; }).join('') : `<p class="dsh-empty">${orders.length ? 'Nenhum pedido com esse filtro.' : 'Nenhum pedido ainda. Eles aparecem aqui quando um cliente logado envia o pedido pelo WhatsApp ou paga online.'}</p>`}</div>`;
  let tm; $('#pq', box).oninput = e => { clearTimeout(tm); tm = setTimeout(() => setFiltro({ ...filtro, q: e.target.value }, true), 250); };
  $('#pst', box).onchange = e => setFiltro({ ...filtro, st: e.target.value });
  box.querySelectorAll('[data-and]').forEach(s => s.onchange = async () => {
    const id = s.closest('.ordc').dataset.id;
    try { await updateDoc(doc(db, 'pedidos', id), { andamento: s.value }); toast('Andamento atualizado.'); }
    catch (e) { toast(e?.code === 'permission-denied' ? 'Sem permissão. Publique as regras mais recentes do Firestore.' : 'Não foi possível atualizar.', true); }
  });
  const mudar = async (id, status) => {
    try { await updateDoc(doc(db, 'pedidos', id), { status, andamento: 'novo' }); toast(status === 'pago' ? 'Venda confirmada. Já está no dashboard.' : 'Pedido cancelado.'); }
    catch (e) { toast(e?.code === 'permission-denied' ? 'Sem permissão. Publique as regras mais recentes do Firestore.' : 'Não foi possível atualizar.', true); }
  };
  box.querySelectorAll('[data-conf]').forEach(b => b.onclick = () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Toque de novo: o cliente já pagou?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Confirmar venda'; } }, 4000); return; }
    mudar(b.closest('.ordc').dataset.id, 'pago');
  });
  box.querySelectorAll('[data-canc]').forEach(b => b.onclick = () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Toque de novo para cancelar'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Cancelar pedido'; } }, 4000); return; }
    mudar(b.closest('.ordc').dataset.id, 'cancelado');
  });
  $('#csv', box).onclick = () => {
    const cel = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [['Pedido', 'Data', 'Status', 'Andamento', 'Cliente', 'WhatsApp', 'E-mail', 'Cidade', 'Endereço', 'Itens', 'Subtotal', 'Desconto', 'Frete', 'Total', 'Cupom'].map(cel).join(';')];
    orders.forEach(o => { const c = o.cliente || {}; linhas.push([o.id, new Date(o._t).toLocaleString('pt-BR'), STATUS[o.status]?.[0] || o.status, ANDAMENTO[o.andamento || 'novo'], c.nome, c.tel, o.email, o.cidade, `${c.rua}, ${c.num} ${c.comp || ''} - ${c.bairro} - CEP ${c.cep}`, (o.itens || []).map(i => `${i.q}x ${i.cod} ${i.nome} (${i.tam})`).join(' | '), String(o.subtotal).replace('.', ','), String(o.desconto || 0).replace('.', ','), String(o.frete || 0).replace('.', ','), String(o.total).replace('.', ','), o.cupom || ''].map(cel).join(';')); });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'pedidos-clouts.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}
