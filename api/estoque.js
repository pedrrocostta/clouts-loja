/* POST /api/estoque — estoque por tamanho em tempo real. Exige o token de login do Firebase.
 * { acao: 'reservar', pedidoId }  → o cliente dono do pedido: baixa do estoque as peças do pedido (uma única vez, tudo ou nada)
 * { acao: 'liberar',  pedidoId }  → só o administrador: devolve ao estoque as peças de um pedido cancelado/recusado
 * Peças sem o campo "estoque" (controle ainda não ativado no painel) são ignoradas, como antes. */
const { admin, db, usuario, erro, responder } = require('./_lib');
const { planejarReserva, aplicar, liberarPedido } = require('./_estoque');

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
    const fs = db(), ref = fs.collection('pedidos').doc(id);

    if (b.acao === 'reservar') {
      const r = await fs.runTransaction(async t => {
        const s = await t.get(ref); if (!s.exists) throw erro(404, 'Pedido não encontrado.');
        const o = s.data(); if (o.uid !== u.uid) throw erro(403, 'Pedido de outra conta.');
        if (o.estoqueReservado !== undefined) return { ok: o.estoqueReservado === true, ja: true };
        if (o.status !== 'aguardando') return { ok: false };
        const abertos = await t.get(fs.collection('pedidos').where('uid', '==', u.uid).where('status', '==', 'aguardando').where('estoqueReservado', '==', true));
        if (abertos.size >= MAX_ABERTOS) { t.update(ref, { estoqueReservado: false, estoqueMotivo: 'limite' }); return { ok: false, motivo: 'limite' }; }
        const { falta, ups, reservados } = await planejarReserva(t, fs, o.itens);
        if (falta.length) { t.update(ref, { estoqueReservado: false, estoqueFalta: falta }); return { ok: false, falta }; }
        aplicar(t, ups);
        t.update(ref, { estoqueReservado: true, estoqueItens: reservados });
        return { ok: true };
      });
      return res.status(200).json(r);
    }

    if (b.acao === 'liberar') {
      if (!ehAdmin(u)) throw erro(403, 'Somente o administrador.');
      await liberarPedido(fs, ref);
      return res.status(200).json({ ok: true });
    }
    throw erro(400, 'Ação inválida.');
  } catch (e) { responder(res, e); }
};
