/* POST /api/estoque — estoque por tamanho. Só o administrador. Exige o token de login do Firebase.
 * A peça só sai do estoque quando a venda é CONFIRMADA (pagamento online aprovado = webhook; pedido do WhatsApp = botão "Confirmar venda" do painel).
 * { acao: 'baixar',   pedidoId, forcar? } → baixa do estoque as peças do pedido (uma única vez). Se faltar estoque, avisa; com forcar:true baixa o que houver.
 * { acao: 'liberar',  pedidoId }          → devolve ao estoque as peças de um pedido que já tinha baixado (cancelamento)
 * { acao: 'cancelar', pedidoId }          → cancela um pedido ainda "aguardando" e devolve o que ele tiver reservado (pedidos antigos)
 * Peças sem o campo "estoque" (controle não ativado) são ignoradas. */
const { admin, db, usuario, erro, responder } = require('./_lib');
const { planejarReserva, aplicar, liberarPedido } = require('./_estoque');

const ADMIN = 'clouts.oficial2026@gmail.com';
const ehAdmin = u => u && u.email === ADMIN && u.email_verified === true && u.firebase?.sign_in_provider === 'google.com';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  try {
    const u = await usuario(req);
    if (!u) throw erro(401, 'Entre na sua conta.');
    if (!ehAdmin(u)) throw erro(403, 'Somente o administrador.');
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String(b.pedidoId || '');
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw erro(400, 'Pedido inválido.');
    const fs = db(), ref = fs.collection('pedidos').doc(id);

    if (b.acao === 'baixar') {
      const r = await fs.runTransaction(async t => {
        const s = await t.get(ref); if (!s.exists) throw erro(404, 'Pedido não encontrado.');
        const o = s.data(); if (o.estoqueReservado === true) return { ok: true, ja: true };
        const { falta, ups, reservados } = await planejarReserva(t, fs, o.itens);
        if (falta.length && b.forcar !== true) return { ok: false, falta };
        aplicar(t, ups);
        t.update(ref, { estoqueReservado: true, estoqueItens: reservados, ...(falta.length ? { estoqueFalta: falta } : {}) });
        return { ok: true, falta };
      });
      return res.status(200).json(r);
    }

    if (b.acao === 'liberar') { await liberarPedido(fs, ref); return res.status(200).json({ ok: true }); }

    if (b.acao === 'cancelar') {
      const s = await ref.get(); if (!s.exists) throw erro(404, 'Pedido não encontrado.');
      if (s.data().status !== 'aguardando') throw erro(409, 'Só dá para cancelar pedidos aguardando.');
      await liberarPedido(fs, ref, { status: 'cancelado' });
      return res.status(200).json({ ok: true });
    }
    throw erro(400, 'Ação inválida.');
  } catch (e) { responder(res, e); }
};
