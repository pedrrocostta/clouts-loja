/* Aplica no pedido o que o Mercado Pago diz sobre um pagamento (usado pelo webhook e pelo botão "Atualizar pagamento" do painel).
 * O pagamento (pg) SEMPRE vem de uma consulta direta à API do Mercado Pago com o token da loja; valor e pedido são conferidos aqui.
 * Aprovado → pedido "pago", estoque baixa, cupom é queimado, indicação conta e o cliente recebe o e-mail. Recusado/cancelado → "recusado". */
const { admin, db, cents } = require('./_lib');
const { emailConfigurado, enviar, pedido: emailPedido } = require('./_mail');
const { planejarReserva, planejarLiberacao, aplicar } = require('./_estoque');

/* Devolve o status que o pedido ficou ('pago', 'recusado', 'divergente'...) ou null se o pagamento não é de um pedido da loja. */
async function aplicarPagamento(pg) {
  const pedidoId = String(pg.external_reference || '');
  if (!/^[A-Za-z0-9]{10,40}$/.test(pedidoId)) return null;
  const id = String(pg.id), fs = db(), ref = fs.collection('pedidos').doc(pedidoId);
  let virouPago = null, ficou = null;
  await fs.runTransaction(async t => {
    const snap = await t.get(ref); if (!snap.exists) return;
    const o = snap.data(); ficou = o.status;
    const conv = o.ref && o.ref !== o.uid ? fs.collection('referrals').doc(o.ref).collection('convidados').doc(o.uid) : null;
    const jaContou = conv ? await t.get(conv) : null;   // todas as leituras antes das escritas
    const novo = pg.status === 'approved' ? 'pago' : (['rejected', 'cancelled'].includes(pg.status) ? 'recusado' : o.status);
    if (o.status === 'pago' || novo === o.status) return;
    const devolver = novo === 'recusado' && o.estoqueReservado === true ? await planejarLiberacao(t, fs, o.estoqueItens) : null;   // pedidos antigos que ainda tinham reserva
    const baixa = novo === 'pago' && o.estoqueReservado !== true ? await planejarReserva(t, fs, o.itens) : null;
    if (novo === 'pago' && cents(pg.transaction_amount) !== cents(o.total)) { t.update(ref, { status: 'divergente', mpPagamento: id }); ficou = 'divergente'; return; }
    t.update(ref, { status: novo, mpPagamento: id, pagoEm: novo === 'pago' ? admin.firestore.FieldValue.serverTimestamp() : null });
    ficou = novo;
    if (devolver) { aplicar(t, devolver); t.update(ref, { estoqueReservado: false, estoqueDevolvido: true }); }
    if (baixa) {   // pagamento aprovado: agora sim a peça sai do estoque (se faltar alguma, o pedido fica marcado para você resolver)
      aplicar(t, baixa.ups);
      t.update(ref, { estoqueReservado: true, estoqueItens: baixa.reservados, ...(baixa.falta.length ? { estoqueFalta: baixa.falta } : {}) });
    }
    if (novo !== 'pago') return;
    virouPago = o;
    if (o.cupom === 'AMIGO' || o.cupom === 'BEMVINDO') t.set(fs.collection('users').doc(o.uid).collection('cupons').doc(o.cupom), { usado: true }, { merge: true });
    if (conv && !jaContou.exists) {   // o amigo só conta depois da primeira compra paga dele
      t.set(conv, { criadoEm: admin.firestore.FieldValue.serverTimestamp(), pedido: pedidoId });
      t.set(fs.collection('referrals').doc(o.ref), { n: admin.firestore.FieldValue.increment(1) }, { merge: true });
    }
  });
  if (virouPago && virouPago.email && emailConfigurado()) {
    const o = virouPago;   // falha de e-mail nunca derruba a confirmação
    try { await enviar({ para: o.email, ...emailPedido({ evento: 'confirmado', nome: o.cliente?.nome, pedidoId, itens: o.itens, subtotal: o.subtotal, desconto: o.desconto, frete: o.frete, total: o.total, cidade: o.cidade }) }); }
    catch (e) { console.error('e-mail de pagamento confirmado:', e.message); }
  }
  return ficou;
}

module.exports = { aplicarPagamento };
