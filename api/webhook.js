/* POST /api/webhook — aviso do Mercado Pago. Não confia no corpo: consulta o pagamento direto na API do Mercado Pago,
 * confere valor e pedido, marca como pago, queima o cupom e conta a indicação (só na primeira compra paga do amigo). */
const crypto = require('crypto');
const { admin, db, configurado, mp, cents } = require('./_lib');
const { planejarLiberacao, aplicar } = require('./_estoque');
const { emailConfigurado, enviar, pedido: emailPedido } = require('./_mail');

function assinaturaOk(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;   // sem segredo configurado: a verificação direta na API do Mercado Pago (abaixo) já garante a autenticidade
  const sig = String(req.headers['x-signature'] || ''), rid = String(req.headers['x-request-id'] || '');
  const ts = /ts=(\d+)/.exec(sig)?.[1], v1 = /v1=([a-f0-9]+)/.exec(sig)?.[1];
  if (!ts || !v1) return false;
  const calc = crypto.createHmac('sha256', secret).update(`id:${String(dataId).toLowerCase()};request-id:${rid};ts:${ts};`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(v1)); } catch { return false; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).end();
  if (!configurado()) return res.status(503).end();
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const tipo = b.type || req.query.type || req.query.topic;
    const id = b.data?.id || req.query['data.id'] || req.query.id;
    if (tipo !== 'payment' || !id || !/^\d{1,20}$/.test(String(id))) return res.status(200).end();
    if (!assinaturaOk(req, id)) return res.status(401).end();

    const pg = await mp(`/v1/payments/${id}`);
    const pedidoId = String(pg.external_reference || '');
    if (!/^[A-Za-z0-9]{10,40}$/.test(pedidoId)) return res.status(200).end();

    const fs = db(), ref = fs.collection('pedidos').doc(pedidoId);
    let virouPago = null;
    await fs.runTransaction(async t => {
      const snap = await t.get(ref); if (!snap.exists) return;
      const o = snap.data();
      const conv = o.ref && o.ref !== o.uid ? fs.collection('referrals').doc(o.ref).collection('convidados').doc(o.uid) : null;
      const jaContou = conv ? await t.get(conv) : null;   // todas as leituras antes das escritas
      const novo = pg.status === 'approved' ? 'pago' : (['rejected', 'cancelled'].includes(pg.status) ? 'recusado' : o.status);
      if (o.status === 'pago' || novo === o.status) return;
      const devolver = novo === 'recusado' && o.estoqueReservado === true ? await planejarLiberacao(t, fs, o.estoqueItens) : null;   // leitura antes das escritas
      if (novo === 'pago' && cents(pg.transaction_amount) !== cents(o.total)) { t.update(ref, { status: 'divergente', mpPagamento: String(id) }); return; }
      t.update(ref, { status: novo, mpPagamento: String(id), pagoEm: novo === 'pago' ? admin.firestore.FieldValue.serverTimestamp() : null });
      if (devolver) { aplicar(t, devolver); t.update(ref, { estoqueReservado: false, estoqueDevolvido: true }); }   // pagamento recusado/cancelado: a peça volta para a loja
      if (novo !== 'pago') return;
      virouPago = o;

      // Cupom usado
      if (o.cupom === 'AMIGO' || o.cupom === 'BEMVINDO') t.set(fs.collection('users').doc(o.uid).collection('cupons').doc(o.cupom), { usado: true }, { merge: true });
      // Indicação: o amigo só conta depois da primeira compra paga dele
      if (conv && !jaContou.exists) {
        t.set(conv, { criadoEm: admin.firestore.FieldValue.serverTimestamp(), pedido: pedidoId });
        t.set(fs.collection('referrals').doc(o.ref), { n: admin.firestore.FieldValue.increment(1) }, { merge: true });
      }
    });
    if (virouPago && virouPago.email && emailConfigurado()) {
      const o = virouPago;   // e-mail de pagamento confirmado; falha de e-mail nunca derruba o webhook
      try { await enviar({ para: o.email, ...emailPedido({ evento: 'confirmado', nome: o.cliente?.nome, pedidoId, itens: o.itens, subtotal: o.subtotal, desconto: o.desconto, frete: o.frete, total: o.total, cidade: o.cidade }) }); } catch (e) { console.error('email pago:', e.message); }
    }
    res.status(200).end();
  } catch (e) { console.error('webhook:', e); res.status(500).end(); }
};
