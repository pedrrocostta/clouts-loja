/* Estoque por tamanho (produtos/{id}.estoque = { "38": 1, "40": 2 }) — funções usadas por estoque.js, checkout.js, webhook.js e cron.js.
 * Peças sem o campo "estoque" (controle não ativado) são ignoradas. As funções "planejar…" só LEEM (chame antes de qualquer escrita da transação). */
const { admin } = require('./_lib');

const demanda = itens => {
  const dem = new Map();
  for (const it of Array.isArray(itens) ? itens : []) {
    const pid = String(it?.id || ''), tam = String(it?.tam || ''), q = Number(it?.q);
    if (!/^[\w.-]{1,80}$/.test(pid) || !/^[A-Za-z0-9]{1,4}$/.test(tam) || !Number.isInteger(q) || q < 1 || q > 20) continue;
    const m = dem.get(pid) || {}; m[tam] = (m[tam] || 0) + q; dem.set(pid, m);
  }
  return dem;
};

/* Devolve { falta, ups, reservados }. falta = o que não tem estoque; ups = escritas a aplicar (aplicar); reservados = lista para guardar no pedido. */
async function planejarReserva(t, fs, itens) {
  const FV = admin.firestore.FieldValue, dem = demanda(itens), ids = [...dem.keys()];
  const snaps = ids.length ? await t.getAll(...ids.map(x => fs.collection('produtos').doc(x))) : [];
  const falta = [], ups = [], reservados = [];
  for (const sn of snaps) {
    if (!sn.exists) continue;
    const p = sn.data(), est = p.estoque;
    if (!est || typeof est !== 'object') continue;
    const upd = {}, zerou = [];
    for (const [tam, q] of Object.entries(dem.get(sn.id))) {
      if (!(tam in est)) continue;
      const atual = Number(est[tam]) || 0;
      if (atual < q) { falta.push({ id: sn.id, cod: String(p.cod || ''), tam, pedido: q, tem: atual }); continue; }
      upd['estoque.' + tam] = atual - q; if (atual - q === 0) zerou.push(tam);
      reservados.push({ id: sn.id, tam, q });
    }
    if (zerou.length) upd.tam = FV.arrayRemove(...zerou);
    if (Object.keys(upd).length) ups.push([sn.ref, upd]);
  }
  return { falta, ups, reservados };
}

async function planejarLiberacao(t, fs, reservados) {
  const FV = admin.firestore.FieldValue, itens = Array.isArray(reservados) ? reservados : [];
  const ids = [...new Set(itens.map(i => String(i.id)))];
  const snaps = ids.length ? await t.getAll(...ids.map(x => fs.collection('produtos').doc(x))) : [];
  const vivos = new Set(snaps.filter(x => x.exists).map(x => x.id)), por = new Map(), ups = [];
  for (const i of itens) { if (!vivos.has(i.id)) continue; const m = por.get(i.id) || {}; m[i.tam] = (m[i.tam] || 0) + Number(i.q); por.set(i.id, m); }
  for (const [pid, m] of por) {
    const upd = {}; for (const [tam, q] of Object.entries(m)) upd['estoque.' + tam] = FV.increment(q);
    upd.tam = FV.arrayUnion(...Object.keys(m));
    ups.push([fs.collection('produtos').doc(pid), upd]);
  }
  return ups;
}

const aplicar = (t, ups) => ups.forEach(([r, u]) => t.update(r, u));

/* Devolve ao estoque as peças reservadas de um pedido (uma única vez) e marca o pedido. extra = campos a gravar junto (ex.: status). */
async function liberarPedido(fs, ref, extra = {}) {
  return fs.runTransaction(async t => {
    const s = await t.get(ref); if (!s.exists) return false;
    const o = s.data(); if (o.estoqueReservado !== true) { if (Object.keys(extra).length) t.update(ref, extra); return false; }
    const ups = await planejarLiberacao(t, fs, o.estoqueItens);
    aplicar(t, ups); t.update(ref, { ...extra, estoqueReservado: false, estoqueDevolvido: true });
    return true;
  });
}

module.exports = { planejarReserva, planejarLiberacao, aplicar, liberarPedido };
