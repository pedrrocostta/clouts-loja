/* POST /api/checkout — recalcula o pedido no servidor, grava em "pedidos" e:
 *   • metodo "pix"  → gera o Pix (QR Code + copia e cola) pela API de pagamentos do Mercado Pago, para mostrar dentro da loja;
 *   • senão         → devolve o link do Mercado Pago (cartão).
 * GET /api/checkout?pedido=ID — o cliente (dono do pedido) consulta se o Pix já foi pago; o servidor confere direto no Mercado Pago. */
const { admin, db, configurado, usuario, calcular, mp, erro, responder } = require('./_lib');
const { planejarReserva } = require('./_estoque');
const { aplicarPagamento } = require('./_pagamento');
const PIX_MIN = 30;   // minutos de validade do QR Code

const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    try {
      const u = await usuario(req); if (!u) throw erro(401, 'Entre com sua conta Google.');
      const id = String(req.query?.pedido || ''); if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw erro(400, 'Pedido inválido.');
      const ref = db().collection('pedidos').doc(id), s = await ref.get();
      if (!s.exists || s.data().uid !== u.uid) throw erro(404, 'Pedido não encontrado.');
      let o = s.data();
      if (o.status === 'aguardando' && o.pixPagamento && configurado()) {
        const pg = await mp(`/v1/payments/${o.pixPagamento}`);
        if (pg.external_reference === id) { await aplicarPagamento(pg); o = (await ref.get()).data(); }
      }
      return res.status(200).json({ status: o.status });
    } catch (e) { return responder(res, e); }
  }
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  if (!configurado()) return res.status(503).json({ erro: 'Pagamento online ainda não está ativo. Finalize pelo WhatsApp.' });
  try {
    const u = await usuario(req);
    if (!u) throw erro(401, 'Entre com sua conta Google para pagar.');
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const c = b.cliente || {};
    const cliente = { nome: txt(c.nome, 100), tel: txt(c.tel, 20), rua: txt(c.rua, 120), num: txt(c.num, 12), bairro: txt(c.bairro, 80), comp: txt(c.comp, 60), cep: txt(c.cep, 9) };
    if (!cliente.nome || !cliente.tel || !cliente.rua || !cliente.num || !cliente.bairro) throw erro(400, 'Preencha nome, WhatsApp e endereço.');

    // Freio: no máximo 8 pedidos online criados nos últimos 15 minutos por cliente (evita encher o banco e o Mercado Pago de pedidos falsos).
    const meus = await db().collection('pedidos').where('uid', '==', u.uid).get();
    if (meus.docs.filter(d => d.data().origem !== 'whatsapp' && (d.data().criadoEm?.toMillis?.() || 0) > Date.now() - 15 * 60000).length >= 8) throw erro(429, 'Muitas tentativas de pagamento seguidas. Aguarde alguns minutos.');

    const p = await calcular({ itens: b.itens, cupom: b.cupom, bf: b.bf === true, cep: cliente.cep, tel: cliente.tel, entrega: b.entrega }, u.uid);
    if (!(p.total > 0)) throw erro(400, 'Total inválido.');
    // O frete dos Correios pode mudar entre o carrinho e o pagamento: se o valor que a cliente viu for diferente, ela confere de novo antes de pagar.
    if (b.freteVisto != null && Math.abs(Number(b.freteVisto) - p.frete) > 0.011) throw erro(409, `O frete mudou para R$ ${p.frete.toFixed(2).replace('.', ',')}. Confira o total e finalize de novo.`);

    // Quem convidou vem do código de amigo que o cliente usou (users/{uid}/meta/indicacao, gravado uma única vez), não do navegador.
    const fs = db(), ind = await fs.collection('users').doc(u.uid).collection('meta').doc('indicacao').get();
    const ref = ind.exists && ind.data().ref && ind.data().ref !== u.uid ? String(ind.data().ref) : null;
    const doc = fs.collection('pedidos').doc();
    // Um link de pagamento por vez: pedidos online anteriores ainda não pagos deste cliente são cancelados e seus links expiram.
    // Assim o mesmo cupom não fica "preso" em vários links que poderiam ser pagos ao mesmo tempo.
    for (const d of meus.docs) {
      const x = d.data(); if (x.origem === 'whatsapp' || x.status !== 'aguardando') continue;
      await d.ref.update({ status: 'cancelado' }).catch(() => {});
      if (x.pixPagamento) mp(`/v1/payments/${x.pixPagamento}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) }).catch(() => {});
      if (x.mpPreference) mp(`/checkout/preferences/${x.mpPreference}`, { method: 'PUT', body: JSON.stringify({ expires: true, expiration_date_to: new Date().toISOString() }) }).catch(() => {});
    }
    // Só confere se ainda há estoque (a peça NÃO sai do estoque agora: ela só baixa quando o pagamento for aprovado, no webhook).
    await fs.runTransaction(async t => {
      const { falta } = await planejarReserva(t, fs, p.linhas);
      if (falta.length) throw erro(409, `A peça ${falta[0].cod} (tam. ${falta[0].tam}) acabou de esgotar. Atualize o carrinho.`);
      t.set(doc, {
        uid: u.uid, email: u.email || '', cliente, itens: p.linhas, subtotal: p.subtotal, desconto: p.desconto, frete: p.frete, total: p.total,
        cupom: p.cupom, percent: p.percent, ...(p.bf ? { bf: p.bf } : {}), cidade: p.cidade, uf: p.uf, entrega: p.entrega, telDigitos: String(cliente.tel).replace(/\D/g, '').slice(-11), ref, status: 'aguardando', criadoEm: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    const site = process.env.SITE_URL.replace(/\/$/, '');
    if (b.metodo === 'pix') {
      let pg;
      try {
        pg = await mp('/v1/payments', {
          method: 'POST', headers: { 'X-Idempotency-Key': doc.id },
          body: JSON.stringify({
            transaction_amount: p.total, description: `Pedido CLOUTS ${doc.id.slice(0, 6).toUpperCase()}`, payment_method_id: 'pix',
            payer: { email: u.email || 'cliente@cloutsoficial.com.br', first_name: cliente.nome.split(' ')[0] },
            external_reference: doc.id, notification_url: `${site}/api/webhook`, statement_descriptor: 'CLOUTS',
            date_of_expiration: new Date(Date.now() + PIX_MIN * 60000 - 3 * 3600000).toISOString().replace('Z', '-03:00')
          })
        });
      } catch (e) { await doc.update({ status: 'cancelado' }).catch(() => {}); throw e; }
      const td = pg.point_of_interaction?.transaction_data || {};
      if (!td.qr_code) { await doc.update({ status: 'cancelado' }).catch(() => {}); throw erro(502, 'Não foi possível gerar o Pix agora. Tente de novo ou use outra forma de pagamento.'); }
      await doc.update({ pixPagamento: String(pg.id), pagamentoTipo: 'pix' });
      return res.status(200).json({ pedido: doc.id, total: p.total, pix: { codigo: td.qr_code, qr: td.qr_code_base64 || null, minutos: PIX_MIN } });
    }
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
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }, { id: 'bank_transfer' }] },   // só cartão aqui (o Pix é gerado dentro da loja); sem boleto/lotérica: a confirmação precisa ser rápida (a peça só baixa quando o pagamento é aprovado)
        expires: true, expiration_date_to: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      })
    }); } catch (e) { await doc.update({ status: 'cancelado' }).catch(() => {}); throw e; }   // não deu para abrir o pagamento: não deixa pedido pendurado
    await doc.update({ mpPreference: pref.id });
    res.status(200).json({ pedido: doc.id, url: pref.init_point, total: p.total });
  } catch (e) { responder(res, e); }
};
