/* Aba "Preços" do painel CLOUTS: tabela para editar preço, preço anterior (De/Por), custo e nome de várias peças de uma vez,
 * com reajuste em porcentagem, preço fixo e localizar/substituir nos nomes. Nada é salvo até clicar em "Salvar alterações". */
import { doc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const r2 = v => Math.round(v * 100) / 100;

export function novoEstadoPrecos() { return { q: '', secao: '', modelo: '', edits: {} }; }

export function renderPrecos(box, items, db, toast, st, redraw) {
  const cur = p => ({ nome: p.nome || '', preco: Number(p.preco) || 0, precoAntigo: Number(p.precoAntigo) || 0, custo: Number(p.custo) || 0, ...(st.edits[p.id] || {}) });
  const q = norm(st.q), modelos = [...new Set(items.map(p => p.modelo).filter(Boolean))].sort();
  const lista = [...items].filter(p => (!q || norm(`${p.cod} ${p.ref || ''} ${p.nome}`).includes(q)) && (!st.secao || p.secao === st.secao) && (!st.modelo || p.modelo === st.modelo))
    .sort((a, b) => String(a.cod).localeCompare(String(b.cod)));
  const mudou = () => Object.keys(st.edits).length;
  const margem = e => e.preco > 0 && e.custo > 0 ? Math.round((e.preco - e.custo) / e.preco * 100) + '%' : '—';

  box.innerHTML = `<div class="cfg-card"><h2>Preços em massa</h2>
    <p class="msg">Edite direto na tabela ou use os atalhos abaixo. Os atalhos valem para as peças que aparecem no filtro. Nada vai para a loja até você clicar em <b>Salvar alterações</b>.</p>
    <div class="bar"><input id="pr-q" type="text" placeholder="Buscar por código, referência ou nome" value="${esc(st.q)}" aria-label="Buscar">
      <select id="pr-s" aria-label="Seção"><option value="">Todas as seções</option><option value="feminino" ${st.secao === 'feminino' ? 'selected' : ''}>Feminino</option><option value="masculino" ${st.secao === 'masculino' ? 'selected' : ''}>Masculino</option></select>
      <select id="pr-m" aria-label="Modelagem"><option value="">Todas as modelagens</option>${modelos.map(m => `<option ${st.modelo === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
    <div class="two"><label class="f" for="pr-pct">Reajustar preço em % (use negativo para baixar)<input id="pr-pct" type="number" step="0.1" placeholder="Ex.: 10 ou -5"></label>
      <label class="f" for="pr-fix">Definir preço fixo (R$)<input id="pr-fix" type="number" min="0" step="0.01" placeholder="Ex.: 149.90"></label></div>
    <label class="sw"><input type="checkbox" id="pr-90" ${st.fim90 ? 'checked' : ''}><i></i>Arredondar para terminar em ,90</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button class="btn line sm" id="pr-ap" type="button">Aplicar % nas ${lista.length} peças</button><button class="btn line sm" id="pr-fx" type="button">Aplicar preço fixo nas ${lista.length} peças</button></div>
    <div class="two"><label class="f" for="pr-de">Localizar no nome<input id="pr-de" type="text" maxlength="60" placeholder="Ex.: Valentin Jeans"></label>
      <label class="f" for="pr-pa">Substituir por (vazio = apagar)<input id="pr-pa" type="text" maxlength="60"></label></div>
    <button class="btn line sm" id="pr-sub" type="button">Substituir nos nomes das ${lista.length} peças</button>
    <p class="msg" id="pr-msg"></p></div>
    <div class="pr-wrap"><table class="pr-t"><thead><tr><th>Código</th><th>Nome</th><th>Preço (R$)</th><th>Preço anterior</th><th>Custo (R$)</th><th>Margem</th></tr></thead><tbody>
    ${lista.map(p => { const e = cur(p), d = !!st.edits[p.id]; return `<tr data-id="${esc(p.id)}" class="${d ? 'dirty' : ''}">
      <td><b>${esc(p.cod)}</b><small>${p.secao === 'masculino' ? 'Masc.' : 'Fem.'}</small></td>
      <td><input data-f="nome" type="text" maxlength="140" value="${esc(e.nome)}" aria-label="Nome"></td>
      <td><input data-f="preco" type="number" min="0" step="0.01" inputmode="decimal" value="${e.preco || ''}" placeholder="0" aria-label="Preço"></td>
      <td><input data-f="precoAntigo" type="number" min="0" step="0.01" inputmode="decimal" value="${e.precoAntigo || ''}" placeholder="—" aria-label="Preço anterior"></td>
      <td><input data-f="custo" type="number" min="0" step="0.01" inputmode="decimal" value="${e.custo || ''}" placeholder="—" aria-label="Custo"></td>
      <td class="mg">${margem(e)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="dsh-empty">Nenhuma peça encontrada.</td></tr>'}
    </tbody></table></div>
    <div class="pr-save"><span id="pr-cnt">${mudou()} peça${mudou() === 1 ? '' : 's'} alterada${mudou() === 1 ? '' : 's'}</span><button class="btn line sm" id="pr-des" type="button" ${mudou() ? '' : 'disabled'}>Descartar</button><button class="btn gold" id="pr-ok" type="button" ${mudou() ? '' : 'disabled'}>Salvar alterações</button></div>`;

  const msg = (t, bad) => { const m = $('#pr-msg', box); m.textContent = t; m.className = 'msg' + (bad ? ' bad' : ''); };
  const set = (id, campo, v) => { const p = items.find(x => x.id === id), e = { ...(st.edits[id] || {}), [campo]: v }, o = { nome: p.nome || '', preco: Number(p.preco) || 0, precoAntigo: Number(p.precoAntigo) || 0, custo: Number(p.custo) || 0 };
    const full = { ...o, ...e }; if (Object.keys(o).every(k => full[k] === o[k])) delete st.edits[id]; else st.edits[id] = e; };
  const fim = v => $('#pr-90', box).checked ? Math.max(0, Math.floor(v) + 0.9) : r2(v);

  $('#pr-q', box).oninput = e => { clearTimeout(box._t); box._t = setTimeout(() => { st.q = e.target.value; redraw(true); }, 250); };
  $('#pr-s', box).onchange = e => { st.secao = e.target.value; redraw(); };
  $('#pr-m', box).onchange = e => { st.modelo = e.target.value; redraw(); };
  $('#pr-90', box).onchange = e => { st.fim90 = e.target.checked; };

  box.querySelectorAll('tbody input').forEach(inp => inp.oninput = () => {
    const tr = inp.closest('tr'), id = tr.dataset.id, f = inp.dataset.f;
    set(id, f, f === 'nome' ? inp.value : Math.max(0, parseFloat(inp.value) || 0));
    tr.classList.toggle('dirty', !!st.edits[id]);
    const p = items.find(x => x.id === id); $('.mg', tr).textContent = margem(cur(p));
    const n = mudou(); $('#pr-cnt', box).textContent = `${n} peça${n === 1 ? '' : 's'} alterada${n === 1 ? '' : 's'}`; $('#pr-ok', box).disabled = $('#pr-des', box).disabled = !n;
  });

  $('#pr-ap', box).onclick = () => {
    const pct = parseFloat($('#pr-pct', box).value); if (!Number.isFinite(pct) || pct === 0 || pct < -90 || pct > 300) return msg('Digite uma porcentagem entre -90 e 300 (ex.: 10).', true);
    let n = 0, zero = 0; lista.forEach(p => { const e = cur(p); if (!(e.preco > 0)) { zero++; return; } set(p.id, 'preco', Math.min(100000, fim(e.preco * (1 + pct / 100)))); n++; });
    redraw(); setTimeout(() => toast(`${n} preço${n === 1 ? '' : 's'} reajustado${n === 1 ? '' : 's'}${zero ? ` (${zero} sem preço foram ignorados)` : ''}. Falta salvar.`), 0);
  };
  $('#pr-fx', box).onclick = () => {
    const v = parseFloat($('#pr-fix', box).value); if (!(v > 0 && v <= 100000)) return msg('Digite um preço maior que zero.', true);
    lista.forEach(p => set(p.id, 'preco', fim(v))); redraw(); setTimeout(() => toast(`Preço aplicado em ${lista.length} peças. Falta salvar.`), 0);
  };
  $('#pr-sub', box).onclick = () => {
    const de = $('#pr-de', box).value; if (!de.trim()) return msg('Digite o trecho do nome que quer trocar.', true);
    const pa = $('#pr-pa', box).value; let n = 0;
    lista.forEach(p => { const e = cur(p); if (e.nome.includes(de)) { const novo = e.nome.split(de).join(pa).replace(/\s{2,}/g, ' ').trim(); if (novo) { set(p.id, 'nome', novo); n++; } } });
    redraw(); setTimeout(() => toast(n ? `${n} nome${n === 1 ? '' : 's'} alterado${n === 1 ? '' : 's'}. Falta salvar.` : 'Nenhum nome continha esse trecho.'), 0);
  };
  $('#pr-des', box).onclick = () => { st.edits = {}; redraw(); };
  $('#pr-ok', box).onclick = async () => {
    const ids = Object.keys(st.edits), ups = [];
    for (const id of ids) {
      const p = items.find(x => x.id === id); if (!p) continue; const e = cur(p), u = {};
      if (!e.nome.trim() || e.nome.length > 140) return msg(`Nome inválido na peça ${p.cod}.`, true);
      if (e.preco > 100000 || e.custo > 100000) return msg(`Valor alto demais na peça ${p.cod}.`, true);
      if (e.precoAntigo && e.precoAntigo <= e.preco) return msg(`Na peça ${p.cod}, o preço anterior precisa ser maior que o preço atual (ou deixe vazio).`, true);
      u.nome = e.nome.trim(); u.preco = r2(e.preco);
      if (e.precoAntigo || p.precoAntigo) u.precoAntigo = r2(e.precoAntigo);
      if (e.custo || p.custo) u.custo = r2(e.custo);
      ups.push([id, u]);
    }
    const b = $('#pr-ok', box); b.disabled = true; b.textContent = 'Salvando…';
    try {
      for (let i = 0; i < ups.length; i += 400) { const wb = writeBatch(db); ups.slice(i, i + 400).forEach(([id, u]) => wb.update(doc(db, 'produtos', id), u)); await wb.commit(); }
      st.edits = {}; toast(`${ups.length} peça${ups.length === 1 ? '' : 's'} salva${ups.length === 1 ? '' : 's'}. Já está na loja.`); redraw();
    } catch (er) { b.disabled = false; b.textContent = 'Salvar alterações'; msg(er?.code === 'permission-denied' ? 'O Firebase recusou. Publique as regras mais recentes (Firestore Database → Regras) e tente de novo.' : 'Não foi possível salvar. Tente de novo.', true); }
  };
}
