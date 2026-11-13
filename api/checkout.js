/* POST /api/checkout — recalcula o pedido no servidor, grava em "pedidos" e devolve o link de pagamento do Mercado Pago (Pix e cartão). */
const { admin, db, configurado, usuario, calcular, mp, erro, responder } = require('./_lib');
const { planejarReserva, aplicar, liberarPedido } = require('./_estoque');

const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  if (!configurado()) return res.status(503).json({ erro: 'Pagamento online ainda não está ativo. Finalize pelo WhatsApp.' });
  try {
    const u = await usuario(req);
    if (!u) throw erro(401, 'Entre com sua conta Google para pagar.');
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const c = b.cliente || {};
    const cliente = { nome: txt(c.nome, 100), tel: txt(c.tel, 20), rua: txt(c.rua, 120), num: txt(c.num, 12), bairro: txt(c.bairro, 80), comp: txt(c.comp, 60), cep: txt(c.cep, 9) };
    if (!cliente.nome || !cliente.tel || !cliente.rua || !cliente.num || !cliente.bairro) throw erro(400, 'Preencha nome, WhatsApp e endereço.');

    const p = await calcular({ itens: b.itens, cupom: b.cupom, cep: cliente.cep }, u.uid);
    if (!(p.total > 0)) throw erro(400, 'Total inválido.');

    // Quem convidou vem do código de amigo que o cliente usou (users/{uid}/meta/indicacao, gravado uma única vez), não do navegador.
    const fs = db(), ind = await fs.collection('users').doc(u.uid).collection('meta').doc('indicacao').get();
    const ref = ind.exists && ind.data().ref && ind.data().ref !== u.uid ? String(ind.data().ref) : null;
    const doc = fs.collection('pedidos').doc();
    // O pedido e a reserva do estoque nascem juntos (tudo ou nada): se a peça acabou de esgotar, nem cria o pedido.
    await fs.runTransaction(async t => {
      const { falta, ups, reservados } = await planejarReserva(t, fs, p.linhas);
      if (falta.length) throw erro(409, `A peça ${falta[0].cod} (tam. ${falta[0].tam}) acabou de esgotar. Atualize o carrinho.`);
      aplicar(t, ups);
      t.set(doc, {
        uid: u.uid, email: u.email || '', cliente, itens: p.linhas, subtotal: p.subtotal, desconto: p.desconto, frete: p.frete, total: p.total,
        cupom: p.cupom, percent: p.percent, cidade: p.cidade, ref, status: 'aguardando', estoqueReservado: true, estoqueItens: reservados, criadoEm: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    const site = process.env.SITE_URL.replace(/\/$/, '');
    let pref;
    try { pref = await mp('/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ id: doc.id, title: `Pedido CLOUTS (${p.linhas.reduce((s, i) => s + i.q, 0)} peça${p.linhas.reduce((s, i) => s + i.q, 0) > 1 ? 's' : ''})`, quantity: 1, currency_id: 'BRL', unit_price: p.total }],
        payer: { name: cliente.nome, email: u.email || undefined },
        external_reference: doc.id,
        notification_url: `${site}/api/webhook`,
        back_urls: { success: `${site}/?pedido=${doc.id}&s=ok`, pending: `${site}/?pedido=${doc.id}&s=pendente`, failure: `${site}/?pedido=${doc.id}&s=falha` },
        auto_return: 'approved',
        statement_descriptor: 'CLOUTS',
        expires: true, expiration_date_to: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString()
      })
    }); } catch (e) { await liberarPedido(fs, doc, { status: 'cancelado' }).catch(() => {}); throw e; }   // não deu para abrir o pagamento: devolve a peça ao estoque
    await doc.update({ mpPreference: pref.id });
    res.status(200).json({ pedido: doc.id, url: pref.init_point, total: p.total });
  } catch (e) { responder(res, e); }
};
