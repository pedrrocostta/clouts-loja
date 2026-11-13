/* Dashboard e pedidos do painel CLOUTS. Lê a coleção "pedidos" (criada pelo servidor quando o cliente paga online ou pelo site no pedido do WhatsApp). */
import { collection, onSnapshot, query, orderBy, limit, doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

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
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const dm = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const dmLongo = t => new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');

/* Escuta os pedidos em tempo real (últimos 500). _t = quando foi criado; _p = quando o pagamento foi confirmado (se houver). */
export function ouvirPedidos(db, onChange, onErr) {
  return onSnapshot(query(collection(db, 'pedidos'), orderBy('criadoEm', 'desc'), limit(500)),
    snap => onChange(snap.docs.map(d => { const x = d.data(); return { id: d.id, ...x, _t: ms(x.criadoEm) || Date.now(), _p: ms(x.pagoEm) }; })),
    e => onErr && onErr(e));
}

/* Data que vale para o período: venda paga conta no dia em que foi confirmada; os demais pedidos, no dia em que foram criados. */
const quando = o => o.status === 'pago' ? (o._p ?? o._t) : o._t;
const desde = p => p === 'tudo' ? 0 : p === 'hoje' ? startOfDay(Date.now()) : startOfDay(Date.now() - (Number(p) - 1) * DIA);
const tamanhoPeriodo = p => p === 'hoje' ? 1 : Number(p);   // em dias; 'tudo' não tem período anterior

/* ---------- peças de gráfico ---------- */
const barras = (rows, fmt = num) => {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return rows.length ? `<ul class="hb">${rows.map(([k, v, extra], i) => `<li><span class="hb-k">${esc(k)}</span><span class="hb-b"><i style="width:${Math.max(3, v / max * 100)}%;--i:${i}"></i></span><span class="hb-v">${fmt(v)}${extra ? `<small>${esc(extra)}</small>` : ''}</span></li>`).join('')}</ul>` : '<p class="dsh-empty">Sem dados no período.</p>';
};

/* Rosca em SVG (anima desenhando). centro/sub aparecem no meio. */
const pizza = (fatias, centro, sub) => {
  const tot = fatias.reduce((a, f) => a + f.v, 0); let acc = 0;
  const arcos = tot ? fatias.filter(f => f.v > 0).map((f, i) => { const p = f.v / tot * 100, el = `<circle class="pz-s" cx="21" cy="21" r="15.9155" fill="none" stroke="${f.c}" stroke-width="6" pathLength="100" stroke-dasharray="${p} ${100 - p}" stroke-dashoffset="${-acc}" transform="rotate(-90 21 21)" style="--d:${i * 140}ms"/>`; acc += p; return el; }).join('') : '';
  return `<div class="pz"><div class="pz-d" role="img" aria-label="${esc(fatias.map(f => f.k + ': ' + f.v).join(', '))}"><svg viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="#e8dfcd" stroke-width="6"/>${arcos}</svg><div><b data-n="${esc(centro)}" data-f="int">${esc(centro)}</b><small>${esc(sub)}</small></div></div>
    <ul class="pz-l">${fatias.map(f => `<li><i style="background:${f.c}"></i><span>${esc(f.k)}</span><b>${num(f.v)}</b><small>${tot ? Math.round(f.v / tot * 100) : 0}%</small></li>`).join('')}</ul></div>`;
};

/* Variação em relação ao período anterior. */
const delta = (atual, ant, invert) => {
  if (ant == null) return '';
  if (!ant && !atual) return '<em class="dl z">sem vendas nos dois períodos</em>';
  if (!ant) return '<em class="dl up">novo no período</em>';
  const p = Math.round((atual - ant) / ant * 100);
  if (p === 0) return '<em class="dl z">igual ao período anterior</em>';
  const bom = invert ? p < 0 : p > 0;
  return `<em class="dl ${bom ? 'up' : 'dn'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% <small>vs. período anterior</small></em>`;
};

const FORMATOS = { brl: v => brl(v), int: v => num(Math.round(v)), pct: v => Math.round(v) + '%', dec: v => v.toFixed(1).replace('.', ',') };
/* Números que "sobem" até o valor final quando o gráfico anima. */
function contar(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('[data-n]').forEach(el => {
    const alvo = parseFloat(String(el.dataset.n).replace(',', '.')); if (!Number.isFinite(alvo) || !alvo) return;
    const f = FORMATOS[el.dataset.f] || FORMATOS.int, final = el.textContent, t0 = performance.now(), dur = 750;
    const passo = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = k < 1 ? f(alvo * e) : final; if (k < 1) requestAnimationFrame(passo); };
    requestAnimationFrame(passo);
  });
}

/* Métricas de um intervalo [ini, fim). */
function metricas(orders, items, ini, fim) {
  const dentro = orders.filter(o => { const t = quando(o); return t >= ini && t < fim; });
  const pagos = dentro.filter(o => o.status === 'pago');
  const fat = pagos.reduce((s, o) => s + (o.total || 0), 0), n = pagos.length;
  const pecas = pagos.reduce((s, o) => s + (o.itens || []).reduce((a, i) => a + (i.q || 0), 0), 0);
  const desc = pagos.reduce((s, o) => s + (o.desconto || 0), 0), fret = pagos.reduce((s, o) => s + (o.frete || 0), 0);
  let lucro = 0, comCusto = 0, semCusto = 0;
  pagos.forEach(o => (o.itens || []).forEach(i => { const p = items.find(x => x.id === i.id); if (p && Number(p.custo) > 0) { lucro += ((i.preco || 0) - p.custo) * (i.q || 0); comCusto += i.q || 0; } else semCusto += i.q || 0; }));
  return { dentro, pagos, fat, n, pecas, desc, fret, ticket: n ? fat / n : 0, lucro, comCusto, semCusto };
}

export function renderDashboard(box, orders, items, periodo = '30', setPeriodo) {
  const agora = Date.now(), t0 = desde(periodo), dias = periodo === 'tudo' ? null : tamanhoPeriodo(periodo);
  const m = metricas(orders, items, t0, agora + 1), ant = dias ? metricas(orders, items, t0 - dias * DIA, t0) : null;
  const { dentro: inP, pagos, fat, n, pecas, desc, fret, ticket, lucro, comCusto, semCusto } = m;
  const animar = box.dataset.per !== periodo || !box.dataset.pronto; box.dataset.per = periodo; box.dataset.pronto = '1';

  const aguard = orders.filter(o => o.status === 'aguardando');
  const conv = inP.length ? Math.round(n / inP.length * 100) : 0;
  const convAnt = ant && ant.dentro.length ? Math.round(ant.n / ant.dentro.length * 100) : null;
  const comprasPorCliente = {}; orders.filter(o => o.status === 'pago').forEach(o => { comprasPorCliente[o.uid] = (comprasPorCliente[o.uid] || 0) + 1; });
  const clientes = new Set(pagos.map(o => o.uid)), recorrentes = [...clientes].filter(u => comprasPorCliente[u] > 1).length;
  const clientesAnt = ant ? new Set(ant.pagos.map(o => o.uid)).size : null;
  const paraEntregar = orders.filter(o => o.status === 'pago' && (o.andamento || 'novo') !== 'entregue').length;

  // Vendas por dia
  const nDias = periodo === 'hoje' ? 1 : periodo === 'tudo' ? Math.min(90, Math.max(7, Math.ceil((agora - Math.min(agora, ...orders.map(quando))) / DIA) + 1)) : Number(periodo);
  const serie = Array.from({ length: nDias }, (_, i) => ({ d: startOfDay(agora - (nDias - 1 - i) * DIA), v: 0, n: 0 }));
  pagos.forEach(o => { const t = quando(o), k = serie.find(s => t >= s.d && t < s.d + DIA); if (k) { k.v += o.total || 0; k.n++; } });
  const maxD = Math.max(1, ...serie.map(s => s.v)), melhor = serie.reduce((a, s) => s.v > a.v ? s : a, serie[0]);

  // Peças mais pedidas
  const prod = {};
  pagos.forEach(o => (o.itens || []).forEach(i => { const p = prod[i.id] ??= { id: i.id, nome: i.nome, cod: i.cod, q: 0, v: 0 }; p.q += i.q || 0; p.v += (i.q || 0) * (i.preco || 0); }));
  const top = Object.values(prod).sort((a, b) => b.q - a.q || b.v - a.v).slice(0, 6), maxQ = Math.max(1, ...top.map(p => p.q));
  const img = id => items.find(x => x.id === id)?.img || '';
  const semVenda = items.filter(p => p.visivel !== false && !p.esgotado && !prod[p.id]).length;

  // Quebras
  const soma = fn => { const mm = {}; pagos.forEach(o => fn(o).forEach(([k, q]) => { mm[k] = (mm[k] || 0) + q; })); return Object.entries(mm).sort((a, b) => b[1] - a[1]); };
  const porCidade = soma(o => [[o.cidade || '—', o.total || 0]]);
  const porTam = soma(o => (o.itens || []).map(i => ['Tam. ' + i.tam, i.q || 0]));
  const secao = i => items.find(x => x.id === i.id)?.secao || (String(i.id).startsWith('m') ? 'masculino' : 'feminino');
  const porSecao = soma(o => (o.itens || []).map(i => [secao(i) === 'masculino' ? 'Masculino' : 'Feminino', (i.q || 0) * (i.preco || 0)]));
  const porDia = SEMANA.map(d => [d, 0]); pagos.forEach(o => { porDia[new Date(quando(o)).getDay()][1] += o.total || 0; });
  const faixas = [['Madrugada (0–6h)', 0, 6], ['Manhã (6–12h)', 6, 12], ['Tarde (12–18h)', 12, 18], ['Noite (18–24h)', 18, 24]].map(([k, a, b]) => [k, pagos.filter(o => { const h = new Date(quando(o)).getHours(); return h >= a && h < b; }).length]);
  const comCupom = pagos.filter(o => o.cupom), indicados = pagos.filter(o => o.ref), recus = inP.filter(o => o.status === 'recusado');
  const cancel = inP.filter(o => ['cancelado', 'recusado', 'divergente'].includes(o.status)).length;
  const gPedidos = pizza([{ k: 'Pagos', v: n, c: '#2f8f5b' }, { k: 'Aguardando', v: inP.filter(o => o.status === 'aguardando').length, c: '#cea147' }, { k: 'Cancelados/recusados', v: cancel, c: '#b3372b' }], String(inP.length), inP.length === 1 ? 'pedido' : 'pedidos');

  // Situação atual do catálogo (não depende do período)
  const total = items.length, ocultas = items.filter(p => p.visivel === false).length, esg = items.filter(p => p.esgotado).length;
  const semPreco = items.filter(p => !(p.preco > 0)).length, semDesc = items.filter(p => !p.descricao).length, promo = items.filter(p => p.precoAntigo > p.preco && p.preco > 0).length;
  const ativas = items.filter(p => p.visivel !== false && !p.esgotado && p.preco > 0).length;
  const esgVis = items.filter(p => p.visivel !== false && p.esgotado).length, semPrecoVis = items.filter(p => p.visivel !== false && !p.esgotado && !(p.preco > 0)).length;
  const gCatalogo = pizza([{ k: 'Ativas na loja', v: ativas, c: '#2f8f5b' }, { k: 'Ocultas', v: ocultas, c: '#8a8272' }, { k: 'Esgotadas', v: esgVis, c: '#cea147' }, { k: 'Sem preço', v: semPrecoVis, c: '#b3372b' }], String(total), total === 1 ? 'peça' : 'peças');
  const fem = items.filter(p => p.secao === 'feminino').length, masc = items.filter(p => p.secao === 'masculino').length;
  const gSecao = pizza([{ k: 'Feminino', v: fem, c: '#cea147' }, { k: 'Masculino', v: masc, c: '#12100c' }], String(total), 'no catálogo');
  const fotos1 = items.filter(p => !p.nFotos).length;
  const comEst = items.filter(p => p.estoque), unidades = comEst.reduce((s, p) => s + Object.values(p.estoque).reduce((a, b) => a + (Number(b) || 0), 0), 0);
  const ultima = comEst.filter(p => p.visivel !== false && Object.values(p.estoque).reduce((a, b) => a + (Number(b) || 0), 0) === 1).length, semCtl = items.length - comEst.length;

  const intervalo = periodo === 'tudo' ? 'Desde o primeiro pedido' : periodo === 'hoje' ? `Hoje, ${dmLongo(agora)}` : `${dmLongo(t0)} a ${dmLongo(agora)}`;
  const kpi = (cls, titulo, valor, fmt, nota, dl = '') => `<div class="kpi ${cls}"><small>${titulo}</small><b data-n="${valor}" data-f="${fmt}">${FORMATOS[fmt](valor)}</b><span>${nota}</span>${dl}</div>`;

  box.innerHTML = `<div class="dsh ${animar ? 'anim' : ''}">
  <div class="dsh-head"><div><h2>Visão geral</h2><p class="msg">Vendas confirmadas: pagas pelo Mercado Pago ou confirmadas por você (aba Pedidos → Confirmar venda). Cada venda conta no dia em que foi confirmada.</p></div>
    <div class="seg" role="group" aria-label="Período">${Object.entries(PERIODOS).map(([k, v]) => `<button type="button" data-per="${k}" class="${k === periodo ? 'on' : ''}" aria-pressed="${k === periodo}">${v}</button>`).join('')}</div></div>
  <p class="dsh-range"><b>${intervalo}</b>${dias ? ` · comparado com ${dmLongo(t0 - dias * DIA)} a ${dmLongo(t0 - 1)}` : ''}</p>
  ${orders.length ? '' : `<div class="dsh-hero"><b>Ainda não há pedidos.</b><span>Cada pedido que um cliente logado enviar pelo WhatsApp aparece na aba Pedidos. Ao confirmar a venda, ela entra aqui: faturamento, peças vendidas, mais pedidas e muito mais.</span></div>`}
  <div class="kpis">
    ${kpi('gold', 'Faturamento', fat, 'brl', `${n} ${n === 1 ? 'pedido pago' : 'pedidos pagos'}`, delta(fat, ant?.fat))}
    ${kpi('', 'Ticket médio', ticket, 'brl', 'por pedido', delta(ticket, ant?.ticket))}
    ${kpi('', 'Peças vendidas', pecas, 'int', n ? (pecas / n).toFixed(1).replace('.', ',') + ' por pedido' : '—', delta(pecas, ant?.pecas))}
    ${kpi('', 'Clientes', clientes.size, 'int', `${recorrentes} ${recorrentes === 1 ? 'voltou' : 'voltaram'} a comprar`, delta(clientes.size, clientesAnt))}
    ${kpi('', 'Conversão', conv, 'pct', `${n} pagos de ${inP.length} pedidos`, delta(conv, convAnt))}
    ${kpi('', 'Descontos dados', desc, 'brl', `frete cobrado: ${brl(fret)}`, delta(desc, ant?.desc, true))}
    ${comCusto ? kpi('', 'Lucro estimado', lucro, 'brl', `${Math.round(lucro / Math.max(1, fat) * 100)}% do faturamento${semCusto ? ` · ${semCusto} un. sem custo` : ''}`, delta(lucro, ant?.lucro)) : kpi('', 'Lucro estimado', 0, 'brl', 'cadastre o custo na aba Preços')}
  </div>

  <section class="dsh-card"><h3>Vendas por dia</h3>
    <p class="vb-info" id="vbInfo" aria-live="polite">${melhor.v ? `Melhor dia: <b>${dmLongo(melhor.d)}</b> · ${brl(melhor.v)} (${melhor.n} pedido${melhor.n === 1 ? '' : 's'})` : 'Toque em uma barra para ver o dia.'}</p>
    <div class="vb-wrap"><span class="vb-max">${brl(maxD)}</span>
      <div class="vb" role="img" aria-label="Faturamento por dia">${serie.map((s, i) => `<button type="button" class="vb-c ${s === melhor && s.v ? 'best' : ''}" data-i="${i}" aria-label="${dm(s.d)}: ${brl(s.v)}"><i style="height:${s.v ? Math.max(4, s.v / maxD * 100) : 1}%;--i:${i}" class="${s.v ? '' : 'z'}"></i></button>`).join('')}</div>
      <div class="vb-ax"><span>${dm(serie[0].d)}</span><span>${nDias > 2 ? dm(serie[Math.floor(nDias / 2)].d) : ''}</span><span>${dm(serie[nDias - 1].d)}</span></div></div></section>

  <div class="dsh-grid">
    <section class="dsh-card"><h3>Pedidos no período</h3>${gPedidos}<p class="dsh-note">${recus.length} pagamento${recus.length === 1 ? '' : 's'} recusado${recus.length === 1 ? '' : 's'}</p></section>
    <section class="dsh-card"><h3>Peças mais pedidas</h3>
      ${top.length ? `<ol class="rank">${top.map((p, i) => `<li><span class="rk">${i + 1}</span>${img(p.id) ? `<img src="${esc(img(p.id))}" alt="" loading="lazy">` : '<span class="ph"></span>'}<div><b>${esc(p.nome)}</b><small>Cód. ${esc(p.cod)} · ${brl(p.v)}</small><span class="hb-b"><i style="width:${p.q / maxQ * 100}%;--i:${i}"></i></span></div><em>${p.q}<small> un.</small></em></li>`).join('')}</ol>` : '<p class="dsh-empty">Nenhuma venda no período.</p>'}
      <p class="dsh-note">${semVenda} peça${semVenda === 1 ? '' : 's'} visível${semVenda === 1 ? '' : 'is'} sem nenhuma venda no período.</p></section>
    <section class="dsh-card"><h3>Faturamento: Feminino × Masculino</h3>${barras(porSecao, brl)}
      <h3 style="margin-top:18px">Tamanhos mais vendidos</h3>${barras(porTam.slice(0, 6))}</section>
    <section class="dsh-card"><h3>Faturamento por cidade</h3>${barras(porCidade, brl)}
      <h3 style="margin-top:18px">Dia da semana</h3>${barras(porDia, brl)}</section>
    <section class="dsh-card"><h3>Horário das compras</h3>${barras(faixas)}
      <h3 style="margin-top:18px">Cupons e indicações</h3>
      <ul class="mini"><li><b>${comCupom.length}</b> pedido${comCupom.length === 1 ? '' : 's'} com cupom (${n ? Math.round(comCupom.length / n * 100) : 0}%)</li><li><b>${indicados.length}</b> venda${indicados.length === 1 ? '' : 's'} vinda${indicados.length === 1 ? '' : 's'} de código de amigo</li></ul></section>
  </div>

  <div class="dsh-sec"><h2>Situação atual da loja</h2><p class="msg">Estes números mostram como a loja está agora e não mudam com o período.</p></div>
  <div class="kpis small">
    <div class="kpi ${paraEntregar ? 'warn' : ''}"><small>Para entregar</small><b>${paraEntregar}</b><span>pagos, ainda não entregues</span></div>
    <div class="kpi ${aguard.length ? 'warn' : ''}"><small>Aguardando confirmação</small><b>${aguard.length}</b><span>${brl(aguard.reduce((s, o) => s + (o.total || 0), 0))} em aberto</span></div>
    <div class="kpi"><small>Unidades em estoque</small><b>${num(unidades)}</b><span>${comEst.length} peça${comEst.length === 1 ? '' : 's'} com controle</span></div>
    <div class="kpi ${ultima ? 'warn' : ''}"><small>Na última unidade</small><b>${ultima}</b><span>peças visíveis</span></div>
  </div>
  <div class="dsh-grid three">
    <section class="dsh-card"><h3>Situação das peças</h3>${gCatalogo}</section>
    <section class="dsh-card"><h3>Feminino × Masculino</h3>${gSecao}<p class="dsh-note">${fotos1} peça${fotos1 === 1 ? '' : 's'} com só 1 foto.</p></section>
    <section class="dsh-card"><h3>Saúde do catálogo</h3>
      <div class="kpis small tight"><div class="kpi"><small>Peças</small><b>${total}</b></div><div class="kpi ${ocultas ? 'warn' : ''}"><small>Ocultas</small><b>${ocultas}</b></div><div class="kpi ${esg ? 'warn' : ''}"><small>Esgotadas</small><b>${esg}</b></div>
        <div class="kpi ${semPreco ? 'bad' : ''}"><small>Sem preço</small><b>${semPreco}</b></div><div class="kpi"><small>Sem descrição</small><b>${semDesc}</b></div><div class="kpi"><small>Em promoção</small><b>${promo}</b></div>
        <div class="kpi ${semCtl ? 'warn' : ''}"><small>Sem controle de estoque</small><b>${semCtl}</b></div></div>
      ${semPreco ? '<p class="dsh-note bad">Peças sem preço não podem ser pagas online. Defina os preços na aba Preços.</p>' : ''}</section>
  </div></div>`;

  box.querySelectorAll('[data-per]').forEach(b => b.onclick = () => setPeriodo(b.dataset.per));
  const info = $('#vbInfo', box), mostrar = i => { const s = serie[i]; box.querySelectorAll('.vb-c.sel').forEach(x => x.classList.remove('sel')); box.querySelector(`.vb-c[data-i="${i}"]`)?.classList.add('sel');
    info.innerHTML = `<b>${SEMANA[new Date(s.d).getDay()]}, ${dm(s.d)}</b> · ${s.v ? brl(s.v) : 'sem vendas'}${s.n ? ` (${s.n} pedido${s.n === 1 ? '' : 's'})` : ''}`; };
  const vb = $('.vb', box), porX = e => { const r = vb.getBoundingClientRect(); mostrar(Math.max(0, Math.min(nDias - 1, Math.floor((e.clientX - r.left) / r.width * nDias)))); };
  vb.addEventListener('pointermove', porX); vb.addEventListener('pointerdown', porX);   // mouse passando ou dedo arrastando sobre as barras
  box.querySelectorAll('.vb-c').forEach(b => b.onclick = () => mostrar(+b.dataset.i));
  if (animar) contar(box);
}

/* Estoque (só o administrador): 'baixar' tira as peças do estoque na venda confirmada; 'liberar' devolve as peças de um pedido cancelado que já tinha baixado; 'cancelar' cancela um pedido online antigo que ainda segurava a peça. */
async function estoqueApi(acao, pedidoId, extra = {}) {
  try {
    const u = getAuth().currentUser; if (!u) return null;
    const r = await fetch('/api/estoque', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await u.getIdToken() }, body: JSON.stringify({ acao, pedidoId, ...extra }) });
    return await r.json();
  } catch { return null; }
}
const devolverEstoque = id => estoqueApi('liberar', id);

/* Avisa o cliente por e-mail (confirmado / enviado / entregue) pelo servidor. Se o e-mail não estiver configurado, ignora em silêncio. */
async function avisarCliente(pedidoId, evento) {
  if (!['confirmado', 'enviado', 'entregue'].includes(evento)) return;
  try {
    const u = getAuth().currentUser; if (!u) return;
    await fetch('/api/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await u.getIdToken() }, body: JSON.stringify({ acao: 'andamento', pedidoId, evento }) });
  } catch {}
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
      <div class="cod">#${esc(o.id.slice(0, 6).toUpperCase())} · ${new Date(o._t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}<span class="tags"><span class="tag ${st[1]}">${st[0]}</span>${o.cupom ? `<span class="tag">Cupom ${esc(o.cupom)} ${o.percent}%</span>` : ''}${o.ref ? '<span class="tag">Código de amigo</span>' : ''}<span class="tag g">${o.origem === 'whatsapp' ? 'WhatsApp' : 'Mercado Pago'}</span>${o.estoqueReservado === true ? `<span class="tag">${o.status === 'pago' ? 'Estoque baixado' : 'Peça reservada'}</span>` : ''}${o.status === 'aguardando' && Date.now() - o._t > 2 * DIA ? `<span class="tag r">Parado há ${Math.floor((Date.now() - o._t) / DIA)} dias</span>` : ''}${o.estoqueDevolvido ? '<span class="tag g">Estoque devolvido</span>' : ''}${(o.estoqueFalta || []).length ? '<span class="tag r">Estoque insuficiente</span>' : ''}</span></div>
      <p class="ord-cli"><b>${esc(c.nome || '—')}</b> · ${esc(c.tel || '')} · ${esc(o.email || '')}</p>
      ${(o.estoqueFalta || []).length ? `<p class="ord-end" style="color:#b3372b;font-weight:600">Faltou estoque: ${o.estoqueFalta.map(f => `${esc(f.cod)} tam. ${esc(f.tam)} (pediu ${f.pedido}, tinha ${f.tem})`).join(' · ')}. Fale com o cliente antes de confirmar.</p>` : ''}
      <p class="ord-end">${esc(c.rua || '')}, ${esc(c.num || '')}${c.comp ? ' — ' + esc(c.comp) : ''} — ${esc(c.bairro || '')}, ${esc(o.cidade || '')} · CEP ${esc(c.cep || '')}</p>
      <ul class="ord-it">${(o.itens || []).map(i => `<li>${i.q}× ${esc(i.nome)} <small>Cód. ${esc(i.cod)} · Tam. ${esc(i.tam)}</small><b>${brl(i.q * i.preco)}</b></li>`).join('')}</ul>
      <div class="ord-ft"><span>Subtotal ${brl(o.subtotal)}${o.desconto ? ` · desconto −${brl(o.desconto)}` : ''} · frete ${brl(o.frete)}</span><b>${brl(o.total)}</b></div>
      <div class="ord-act">${o.origem === 'whatsapp' && o.status === 'aguardando' ? '<button class="btn gold sm" data-conf type="button">Confirmar venda</button>' : ''}${o.origem !== 'whatsapp' && ['aguardando', 'divergente', 'cancelado'].includes(o.status) ? '<button class="btn line sm" data-verif type="button">Atualizar pagamento</button>' : ''}${o.status !== 'aguardando' ? '' : o.estoqueReservado === true ? '<button class="btn danger sm" data-libmp type="button">Cancelar e devolver a peça</button><button class="btn danger sm" data-semdev type="button">Cancelar (já repus o estoque)</button>' : o.origem === 'whatsapp' ? '<button class="btn danger sm" data-canc type="button">Cancelar pedido</button>' : '<button class="btn danger sm" data-libmp type="button">Cancelar pedido</button>'}${o.status === 'pago' ? `<label class="f">Andamento<select data-and>${Object.entries(ANDAMENTO).map(([k, v]) => `<option value="${k}" ${(o.andamento || 'novo') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
        ${wa(o) ? `<a class="btn line sm" href="${wa(o)}" target="_blank" rel="noopener">WhatsApp do cliente</a>` : ''}</div></div></article>`; }).join('') : `<p class="dsh-empty">${orders.length ? 'Nenhum pedido com esse filtro.' : 'Nenhum pedido ainda. Eles aparecem aqui quando um cliente logado envia o pedido pelo WhatsApp ou paga online.'}</p>`}</div>`;
  let tm; $('#pq', box).oninput = e => { clearTimeout(tm); tm = setTimeout(() => setFiltro({ ...filtro, q: e.target.value }, true), 250); };
  $('#pst', box).onchange = e => setFiltro({ ...filtro, st: e.target.value });
  box.querySelectorAll('[data-and]').forEach(s => s.onchange = async () => {
    const id = s.closest('.ordc').dataset.id;
    try { await updateDoc(doc(db, 'pedidos', id), { andamento: s.value }); toast('Andamento atualizado.'); avisarCliente(id, s.value); }
    catch (e) { toast(e?.code === 'permission-denied' ? 'Sem permissão. Publique as regras mais recentes do Firestore.' : 'Não foi possível atualizar.', true); }
  });
  const mudar = async (id, status) => {
    if (status === 'pago') {   // venda confirmada: a peça sai do estoque agora
      let r = await estoqueApi('baixar', id);
      if (r && r.ok === false && (r.falta || []).length) {
        const txt = r.falta.map(f => `${f.cod} tam. ${f.tam} (pedido ${f.pedido}, estoque ${f.tem})`).join('\n');
        if (!confirm(`Estoque insuficiente:\n${txt}\n\nA peça já pode ter sido vendida para outra pessoa. Confirmar a venda mesmo assim?`)) return;
        r = await estoqueApi('baixar', id, { forcar: true });
      }
      if (!r) { toast('Não foi possível atualizar o estoque. Tente de novo.', true); return; }
    }
    try {
      try { await updateDoc(doc(db, 'pedidos', id), { status, andamento: 'novo', ...(status === 'pago' ? { pagoEm: serverTimestamp() } : {}) }); }
      catch (e0) { if (status !== 'pago' || e0?.code !== 'permission-denied') throw e0; await updateDoc(doc(db, 'pedidos', id), { status, andamento: 'novo' }); }   // regras antigas ainda sem o campo pagoEm
      toast(status === 'pago' ? 'Venda confirmada. Já está no dashboard.' : 'Pedido cancelado.'); if (status === 'pago') avisarCliente(id, 'confirmado'); if (status === 'cancelado') devolverEstoque(id); }
    catch (e) { toast(e?.code === 'permission-denied' ? 'Sem permissão. Publique as regras mais recentes do Firestore.' : 'Não foi possível atualizar.', true); }
  };
  box.querySelectorAll('[data-conf]').forEach(b => b.onclick = () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Toque de novo: o cliente já pagou?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Confirmar venda'; } }, 4000); return; }
    mudar(b.closest('.ordc').dataset.id, 'pago');
  });
  box.querySelectorAll('[data-verif]').forEach(b => b.onclick = async () => {
    b.disabled = true; const t0 = b.textContent; b.textContent = 'Consultando o Mercado Pago…';
    const pid = b.closest('.ordc').dataset.id;
    let r = await estoqueApi('verificar', pid);
    if (r && !r.erro && !r.pagamentos) {   // a busca pelo pedido não achou: tenta pelo número da transação
      const n = (prompt('O Mercado Pago não achou pagamento para este pedido.\n\nSe você tem o número da transação (ex.: 188413842645, aparece na tela do Mercado Pago), cole aqui. Se não tem, deixe vazio.') || '').replace(/\D/g, '');
      if (n) r = await estoqueApi('verificar', pid, { pagamentoId: n });
    }
    b.disabled = false; b.textContent = t0;
    if (!r || r.erro) return toast(r?.erro || 'Não foi possível consultar agora.', true);
    if (r.pagamentos && r.doPedido === false) return toast(`Esse pagamento (${r.mp}) pertence ao pedido ${String(r.referencia).slice(0, 6).toUpperCase()}, não a este. Atualizei o pedido certo.`);
    toast(!r.pagamentos ? 'O Mercado Pago ainda não tem pagamento para este pedido.' : r.status === 'pago' ? 'Pagamento aprovado! Pedido atualizado e peça baixada do estoque.' : r.status === 'recusado' ? 'O pagamento foi recusado. Pedido atualizado.' : `Pagamento ainda em análise no Mercado Pago (${r.mp || 'pendente'}).`);
  });
  box.querySelectorAll('[data-libmp],[data-semdev]').forEach(b => b.onclick = async () => {
    const txt = b.dataset.txt ??= b.textContent, sem = b.hasAttribute('data-semdev');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Toque de novo para cancelar'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = txt; } }, 4000); return; }
    const r = await estoqueApi('cancelar', b.closest('.ordc').dataset.id, sem ? { devolver: false } : {});
    toast(r?.ok ? (sem ? 'Pedido cancelado. O estoque ficou como está.' : 'Pedido cancelado.') : 'Não foi possível cancelar agora.', !r?.ok);
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
