/* Visitas do site (Google Analytics) dentro do dashboard do painel. Busca em /api/analytics e acompanha o mesmo período do dashboard. */
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v || 0).toLocaleString('pt-BR');
const dur = s => s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
const dm = d => `${d.slice(6, 8)}/${d.slice(4, 6)}`;
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const CANAIS = { 'Direct': 'Direto', 'Organic Search': 'Busca no Google', 'Paid Search': 'Anúncios na busca', 'Organic Social': 'Redes sociais', 'Paid Social': 'Anúncios em redes', 'Referral': 'Links de outros sites', 'Email': 'E-mail', 'Display': 'Display', 'Unassigned': 'Não identificado', 'Organic Video': 'Vídeos' };
const APARELHOS = { mobile: 'Celular', desktop: 'Computador', tablet: 'Tablet', 'smart tv': 'TV' };

const cache = {};   // por período, 2 minutos

const delta = (a, b) => {
  if (b == null) return '';
  if (!b && !a) return '';
  if (!b) return '<em class="dl up">novo no período</em>';
  const p = Math.round((a - b) / b * 100);
  return p === 0 ? '<em class="dl z">igual ao período anterior</em>' : `<em class="dl ${p > 0 ? 'up' : 'dn'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% <small>vs. período anterior</small></em>`;
};
const barras = (rows, fmt = num) => {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return rows.length ? `<ul class="hb">${rows.map(([k, v], i) => `<li><span class="hb-k" title="${esc(k)}">${esc(k)}</span><span class="hb-b"><i style="width:${Math.max(3, v / max * 100)}%;--i:${i}"></i></span><span class="hb-v">${fmt(v)}</span></li>`).join('')}</ul>` : '<p class="dsh-empty">Sem dados no período.</p>';
};

const guia = (motivo, conta) => {
  const passos = {
    'sem-config': ['Falta informar qual propriedade do Analytics ler.', ['No Google Analytics, abra <b>Administrador</b> (engrenagem) → <b>Configurações da propriedade</b> e copie o <b>ID da propriedade</b> (só números, ex.: 512345678).', 'Cole no painel em <b>Site → ID da propriedade do Analytics</b> e salve.']],
    'api-desativada': ['A leitura do Analytics ainda não está ativada no Google Cloud.', ['Abra o Google Cloud (projeto <b>clouts-409b7</b>) → <b>APIs e serviços</b> → <b>Biblioteca</b>.', 'Procure <b>Google Analytics Data API</b> e clique em <b>Ativar</b>. Espere 1 ou 2 minutos e recarregue.']],
    'sem-acesso': ['O painel ainda não tem permissão para ler o seu Analytics.', [`No Google Analytics, abra <b>Administrador</b> → <b>Gerenciamento de acesso à propriedade</b> → <b>+</b> → <b>Adicionar usuários</b>.`, `Cole este e-mail: <code>${esc(conta || 'a conta de serviço do Firebase')}</code>, escolha o papel <b>Leitor</b> e salve. Espere 1 ou 2 minutos e recarregue.`]],
    'propriedade-invalida': ['O ID da propriedade parece estar errado.', ['Confira no Google Analytics, em Administrador → Configurações da propriedade, o <b>ID da propriedade</b> (só números, não o código G-...), e corrija em <b>Site</b> no painel.']],
    erro: ['Não foi possível ler o Analytics agora.', ['Tente de novo em alguns minutos. Se persistir, me avise.']]
  }[motivo] || ['Não foi possível ler o Analytics agora.', []];
  return `<h3>Visitas do site</h3><div class="ga-guia"><b>${passos[0]}</b><ol>${passos[1].map(p => `<li>${p}</li>`).join('')}</ol></div>`;
};

function desenhar(box, d, periodo, pedidosPagos, animar) {
  const a = d.atual, p = d.anterior, dias = d.porDia, max = Math.max(1, ...dias.map(x => x.u));
  const vi = d.eventos.view_item || 0, ac = d.eventos.add_to_cart || 0, ld = d.eventos.generate_lead || 0, pg = pedidosPagos || 0;
  const pct = (x, y) => y ? Math.round(x / y * 100) + '%' : '—';
  const kpi = (t, v, nota, dl) => `<div class="kpi"><small>${t}</small><b>${v}</b><span>${nota}</span>${dl || ''}</div>`;
  box.innerHTML = `<div class="${animar ? 'anim' : ''}"><div class="ga-head"><h3>Visitas do site <small>(Google Analytics)</small></h3><span class="ga-ao-vivo"><i></i>${num(d.agora)} agora no site</span></div>
    <div class="kpis small ga-kpis">
      ${kpi('Visitantes', num(a.usuarios), 'pessoas diferentes', delta(a.usuarios, p?.usuarios))}
      ${kpi('Visitas', num(a.sessoes), `${a.usuarios ? (a.sessoes / a.usuarios).toFixed(1).replace('.', ',') : '0'} por visitante`, delta(a.sessoes, p?.sessoes))}
      ${kpi('Páginas vistas', num(a.visualizacoes), a.sessoes ? `${(a.visualizacoes / a.sessoes).toFixed(1).replace('.', ',')} por visita` : '—', delta(a.visualizacoes, p?.visualizacoes))}
      ${kpi('Novos visitantes', num(a.novos), a.usuarios ? `${Math.round(a.novos / a.usuarios * 100)}% do total` : '—', delta(a.novos, p?.novos))}
      ${kpi('Tempo médio', dur(a.duracao), 'por visita', delta(a.duracao, p?.duracao))}
    </div>
    <p class="vb-info" id="gaInfo" aria-live="polite">${dias.length ? 'Toque ou passe o dedo sobre as barras para ver cada dia.' : 'Ainda sem visitas medidas neste período.'}</p>
    ${dias.length ? `<div class="vb-wrap"><span class="vb-max">${num(max)} visitantes</span><div class="vb ga-vb" role="img" aria-label="Visitantes por dia">${dias.map((x, i) => `<button type="button" class="vb-c" data-i="${i}" aria-label="${dm(x.d)}: ${x.u} visitantes"><i style="height:${x.u ? Math.max(4, x.u / max * 100) : 1}%;--i:${i}" class="${x.u ? '' : 'z'}"></i></button>`).join('')}</div><div class="vb-ax"><span>${dm(dias[0].d)}</span><span>${dias.length > 2 ? dm(dias[Math.floor(dias.length / 2)].d) : ''}</span><span>${dm(dias[dias.length - 1].d)}</span></div></div>` : ''}
    <div class="dsh-grid ga-grid">
      <section class="dsh-card"><h3>Do olhar à compra</h3>${barras([['Viram uma peça', vi], ['Colocaram no carrinho', ac], ['Enviaram o pedido', ld], ['Vendas pagas', pg]])}
        <p class="dsh-note">${pct(ac, vi)} dos que veem uma peça colocam no carrinho · ${pct(pg, a.usuarios)} dos visitantes compram.</p></section>
      <section class="dsh-card"><h3>De onde vêm</h3>${barras(d.canais.map(([k, n]) => [CANAIS[k] || k, n]))}</section>
      <section class="dsh-card"><h3>Aparelhos</h3>${barras(d.aparelhos.map(([k, n]) => [APARELHOS[k] || k, n]))}<h3 style="margin-top:18px">Cidades</h3>${barras(d.cidades)}</section>
      <section class="dsh-card"><h3>Peças mais vistas</h3>${barras(d.pecas)}<p class="dsh-note">${num(d.eventos.solicitar_peca || 0)} pedido${(d.eventos.solicitar_peca || 0) === 1 ? '' : 's'} de peça (tamanho que faltava) no período.</p></section>
    </div>
    <p class="dsh-note">Conta só quem aceitou os cookies na loja, por isso os números do Analytics podem ser menores que o movimento real.</p></div>`;
  const info = box.querySelector('#gaInfo'), vb = box.querySelector('.ga-vb');
  if (vb) {
    const mostrar = i => { const x = dias[i]; if (!x) return; box.querySelectorAll('.vb-c.sel').forEach(e => e.classList.remove('sel')); box.querySelector(`.vb-c[data-i="${i}"]`)?.classList.add('sel');
      const dt = new Date(+x.d.slice(0, 4), +x.d.slice(4, 6) - 1, +x.d.slice(6, 8)); info.innerHTML = `<b>${SEMANA[dt.getDay()]}, ${dm(x.d)}</b> · ${num(x.u)} visitante${x.u === 1 ? '' : 's'} · ${num(x.s)} visita${x.s === 1 ? '' : 's'}`; };
    const porX = e => { const r = vb.getBoundingClientRect(); mostrar(Math.max(0, Math.min(dias.length - 1, Math.floor((e.clientX - r.left) / r.width * dias.length)))); };
    vb.addEventListener('pointermove', porX); vb.addEventListener('pointerdown', porX);
    box.querySelectorAll('.vb-c').forEach(b => b.onclick = () => mostrar(+b.dataset.i));
  }
}

let alvo = null;       // onde desenhar quando a resposta chegar (o dashboard se redesenha a cada pedido novo)
const voo = {};        // pedidos em andamento por período

/* Mostra as visitas do período. Desenha na hora o que já está em cache e atualiza em segundo plano. */
export async function montarVisitas(box, periodo, pedidosPagos) {
  if (!box) return;
  alvo = { box, periodo, pagos: pedidosPagos };
  const c = cache[periodo];
  if (c?.ok) { desenhar(box, c.dados, periodo, pedidosPagos, !c.visto); c.visto = true; }
  else if (!c) box.innerHTML = '<h3>Visitas do site</h3><p class="dsh-empty">Carregando as visitas…</p>';
  else box.innerHTML = guia(c.motivo, c.conta);
  if ((c && Date.now() - c.t < 120000) || voo[periodo]) return;
  voo[periodo] = true;
  let dados;
  try {
    const u = getAuth().currentUser; if (!u) return;
    const r = await fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await u.getIdToken() }, body: JSON.stringify({ periodo }) });
    dados = await r.json().catch(() => ({ ok: false, motivo: 'erro' }));
  } catch { dados = { ok: false, motivo: 'erro' }; }
  finally { delete voo[periodo]; }
  cache[periodo] = dados.ok ? { ok: true, dados, t: Date.now(), visto: !!c?.visto } : { ok: false, motivo: dados.motivo || 'erro', conta: dados.conta, t: Date.now() };
  if (alvo && alvo.periodo === periodo && document.body.contains(alvo.box)) {
    if (dados.ok) { const k = cache[periodo]; desenhar(alvo.box, dados, periodo, alvo.pagos, !k.visto); k.visto = true; }
    else alvo.box.innerHTML = guia(dados.motivo || 'erro', dados.conta);
  }
}

export { desenhar as renderVisitas, guia as guiaConfig };
