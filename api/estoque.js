/* POST /api/estoque — estoque por tamanho em tempo real. Exige o token de login do Firebase.
 * { acao: 'reservar', pedidoId }  → o cliente dono do pedido: baixa do estoque as peças do pedido (uma única vez, tudo ou nada)
 * { acao: 'liberar',  pedidoId }  → só o administrador: devolve ao estoque as peças de um pedido cancelado/recusado
 * Peças sem o campo "estoque" (controle ainda não ativado no painel) são ignoradas, como antes. */
const { admin, db, usuario, erro, responder } = require('./_lib');

const ADMIN = 'clouts.oficial2026@gmail.com';
const ehAdmin = u => u && u.email === ADMIN && u.email_verified === true && u.firebase?.sign_in_provider === 'google.com';
const MAX_ABERTOS = 3;                                  // por cliente: pedidos "aguardando" com peças reservadas ao mesmo tempo (evita esvaziar o estoque de brincadeira)

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  try {
    const u = await usuario(req);
    if (!u) throw erro(401, 'Entre na sua conta.');
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String(b.pedidoId || '');
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw erro(400, 'Pedido inválido.');
    const fs = db(), FV = admin.firestore.FieldValue, ref = fs.collection('pedidos').doc(id);

    if (b.acao === 'reservar') {
      const r = await fs.runTransaction(async t => {
        const s = await t.get(ref); if (!s.exists) throw erro(404, 'Pedido não encontrado.');
        const o = s.data(); if (o.uid !== u.uid) throw erro(403, 'Pedido de outra conta.');
        if (o.estoqueReservado !== undefined) return { ok: o.estoqueReservado === true, ja: true };
        if (o.status !== 'aguardando') return { ok: false };
        const abertos = await t.get(fs.collection('pedidos').where('uid', '==', u.uid).where('status', '==', 'aguardando').where('estoqueReservado', '==', true));
        if (abertos.size >= MAX_ABERTOS) { t.update(ref, { estoqueReservado: false, estoqueMotivo: 'limite' }); return { ok: false, motivo: 'limite' }; }
        // Quanto o pedido pede de cada peça/tamanho.
        const dem = new Map();
        for (const it of Array.isArray(o.itens) ? o.itens : []) {
          const pid = String(it?.id || ''), tam = String(it?.tam || ''), q = Number(it?.q);
          if (!/^[\w.-]{1,80}$/.test(pid) || !/^[A-Za-z0-9]{1,4}$/.test(tam) || !Number.isInteger(q) || q < 1 || q > 20) continue;
          const m = dem.get(pid) || {}; m[tam] = (m[tam] || 0) + q; dem.set(pid, m);
        }
        const ids = [...dem.keys()];
        const snaps = ids.length ? await t.getAll(...ids.map(x => fs.collection('produtos').doc(x))) : [];
        const falta = [], ups = [], itens = [];
        for (const sn of snaps) {
          if (!sn.exists) continue;
          const p = sn.data(), est = p.estoque;
          if (!est || typeof est !== 'object') continue;                 // controle de estoque não ativado nesta peça
          const upd = {}, zerou = [];
          for (const [tam, q] of Object.entries(dem.get(sn.id))) {
            if (!(tam in est)) continue;
            const atual = Number(est[tam]) || 0;
            if (atual < q) { falta.push({ id: sn.id, cod: String(p.cod || ''), tam, pedido: q, tem: atual }); continue; }
            upd['estoque.' + tam] = atual - q; if (atual - q === 0) zerou.push(tam);
            itens.push({ id: sn.id, tam, q });
          }
          if (zerou.length) upd.tam = FV.arrayRemove(...zerou);
          if (Object.keys(upd).length) ups.push([sn.ref, upd]);
        }
        if (falta.length) { t.update(ref, { estoqueReservado: false, estoqueFalta: falta }); return { ok: false, falta }; }
        ups.forEach(([pr, upd]) => t.update(pr, upd));
        t.update(ref, { estoqueReservado: true, estoqueItens: itens });
        return { ok: true };
      });
      return res.status(200).json(r);
    }

    if (b.acao === 'liberar') {
      if (!ehAdmin(u)) throw erro(403, 'Somente o administrador.');
      await fs.runTransaction(async t => {
        const s = await t.get(ref); if (!s.exists) throw erro(404, 'Pedido não encontrado.');
        const o = s.data(); if (o.estoqueReservado !== true) return;
        const itens = Array.isArray(o.estoqueItens) ? o.estoqueItens : [];
        const ids = [...new Set(itens.map(i => String(i.id)))];
        const snaps = ids.length ? await t.getAll(...ids.map(x => fs.collection('produtos').doc(x))) : [];
        const vivos = new Set(snaps.filter(x => x.exists).map(x => x.id));
        const por = new Map();
        for (const i of itens) { if (!vivos.has(i.id)) continue; const m = por.get(i.id) || {}; m[i.tam] = (m[i.tam] || 0) + Number(i.q); por.set(i.id, m); }
        for (const [pid, m] of por) {
          const upd = {}; for (const [tam, q] of Object.entries(m)) upd['estoque.' + tam] = FV.increment(q);
          upd.tam = FV.arrayUnion(...Object.keys(m));
          t.update(fs.collection('produtos').doc(pid), upd);
        }
        t.update(ref, { estoqueReservado: false, estoqueDevolvido: true });
      });
      return res.status(200).json({ ok: true });
    }
    throw erro(400, 'Ação inválida.');
  } catch (e) { responder(res, e); }
};
