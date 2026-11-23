/* Conferência de um pedido do WhatsApp feita pelo servidor, antes de o administrador confirmar a venda.
 * O pedido do WhatsApp nasce no navegador do cliente (preço, frete e desconto vêm do celular dele), então aqui tudo é refeito com os dados reais:
 * preço do catálogo, frete da cidade, desconto permitido para o cupom e se o cupom já foi usado antes. Devolve uma lista de problemas (vazia = tudo certo). */
const { admin, FRETE_INFO, cents, BF_PCT, bfVale } = require('./_lib');

const arred = v => Math.round(Number(v) * 100) / 100;
const dig = t => String(t || '').replace(/\D/g, '');

async function conferirPedido(fs, o, idAtual) {
  const prob = [];
  const itens = Array.isArray(o.itens) ? o.itens : [];
  // 1) preço do catálogo
  let sub = 0, ok = itens.length > 0;
  for (const it of itens) {
    const id = String(it?.id || ''), q = Number(it?.q);
    if (!/^[\w.-]{1,80}$/.test(id) || !Number.isInteger(q) || q < 1 || q > 20) { ok = false; continue; }
    const s = await fs.collection('produtos').doc(id).get();
    if (!s.exists) { prob.push(`A peça ${esc(it.cod || id)} não existe mais no catálogo.`); ok = false; continue; }
    sub += cents(s.data().preco) * q;
  }
  sub = sub / 100;
  if (!ok) prob.push('Itens do pedido inválidos.');
  else if (Math.abs(sub - Number(o.subtotal)) > 0.011) prob.push(`Preço diferente do catálogo: o pedido diz R$ ${arred(o.subtotal).toFixed(2)} e o catálogo soma R$ ${sub.toFixed(2)}.`);
  // 2) frete
  const { FRETE, GRATIS } = FRETE_INFO;
  const freteCerto = GRATIS != null && sub >= GRATIS ? 0 : FRETE[o.cidade];
  if (!Number.isFinite(freteCerto)) prob.push('Cidade de entrega inválida.');
  else if (Math.abs(freteCerto - Number(o.frete)) > 0.011) prob.push(`Frete diferente: o pedido cobra R$ ${arred(o.frete).toFixed(2)} e o certo é R$ ${freteCerto.toFixed(2)}.`);
  // 3) conta fecha?
  if (Math.abs(arred(o.subtotal) - arred(o.desconto || 0) + arred(o.frete) - arred(o.total)) > 0.021) prob.push('O total do pedido não bate com subtotal − desconto + frete.');
  // 4) cupom e Black Friday
  const cup = o.cupom ? String(o.cupom) : null, pct = Number(o.percent) || 0;
  const criado = o.criadoEm?.toMillis?.() || Date.now(), bfOk = bfVale(criado), desc = arred(o.desconto || 0), sub4 = arred(o.subtotal);
  const bate = p => Math.abs(desc - arred(sub4 * p / 100)) <= 0.021;
  if (cup === 'BLACKFRIDAY') {
    if (!bfOk) prob.push('A Black Friday já tinha terminado quando o pedido foi feito.');
    if (pct !== BF_PCT || !bate(BF_PCT)) prob.push(`O desconto da Black Friday deveria ser ${BF_PCT}% do subtotal.`);
  } else if (!(cup && pct > 0)) {
    if (desc > 0.011 && !(bfOk && bate(BF_PCT))) prob.push(`O pedido tem desconto de R$ ${desc.toFixed(2)} sem cupom válido.`);
  } else {
    if (!(bate(pct) || (bfOk && bate(pct + BF_PCT)))) prob.push(`O desconto (R$ ${desc.toFixed(2)}) não bate com ${pct}% do subtotal (nem com ${pct + BF_PCT}%, somando a Black Friday).`);
    const cfg = (await fs.collection('config').doc('loja').get()).data() || {};
    let max = null, dias = null;
    if (cup === 'PRIMEIRA') { max = Math.min(50, Number(cfg.primeiraPct) > 0 ? Number(cfg.primeiraPct) : 10); dias = Math.min(30, Number(cfg.primeiraDias) > 0 ? Number(cfg.primeiraDias) : 7); if (cfg.cupomPrimeira === false) prob.push('O cupom de primeira compra está desligado.'); }
    else if (cup === 'AMIGO') max = 20;
    else if (cup === 'BEMVINDO') max = 10;
    else { const c = await fs.collection('campanhas').doc(cup).get(); if (!c.exists || c.data().ativo !== true) prob.push(`O código ${cup} não existe ou está pausado.`); else { max = Number(c.data().percent) || 0; const ex = c.data().expiraEm?.toMillis?.(); if (ex && ex < (o.criadoEm?.toMillis?.() || Date.now())) prob.push(`O código ${cup} já tinha vencido quando o pedido foi feito.`); } }
    if (max != null && pct > max) prob.push(`Desconto acima do permitido: ${pct}% com o cupom ${cup} (máximo ${max}%).`);
    // já usou antes?
    const meus = (await fs.collection('pedidos').where('uid', '==', o.uid).get()).docs.filter(d => d.id !== idAtual);
    if (cup === 'PRIMEIRA') {
      if (meus.some(d => !['cancelado', 'recusado'].includes(d.data().status))) prob.push('Este cliente já tem outro pedido: o cupom de primeira compra não vale.');
      try { const u = await admin.auth().getUser(o.uid); if (dias && Date.parse(u.metadata.creationTime) + dias * 86400000 < (o.criadoEm?.toMillis?.() || Date.now())) prob.push('A conta já tinha passado do prazo do cupom de primeira compra.'); } catch { /* sem dado da conta: não bloqueia */ }
      const tel = dig(o.cliente?.tel).slice(-11);
      if (tel.length >= 10) {
        const outros = (await fs.collection('pedidos').where('cupom', '==', 'PRIMEIRA').get()).docs.filter(d => d.id !== idAtual && d.data().uid !== o.uid && !['cancelado', 'recusado'].includes(d.data().status) && dig(d.data().cliente?.tel).slice(-11) === tel);
        if (outros.length) prob.push('Outra conta já usou o cupom de primeira compra com este mesmo WhatsApp.');
      }
    } else if (meus.some(d => d.data().cupom === cup && d.data().status === 'pago')) prob.push(`Este cliente já usou o cupom ${cup} em outra compra paga.`);
  }
  return prob;
}
const esc = s => String(s ?? '').slice(0, 40);

module.exports = { conferirPedido };
