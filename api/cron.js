/* GET /api/cron — rodada diária (Vercel Cron): lembra quem deixou o carrinho parado.
 * 1º lembrete depois de 3 horas parado; 2º (última chamada) depois de 3 dias. Quem pediu para parar de receber não recebe. */
const { db } = require('./_lib');
const { emailConfigurado, enviar, carrinho, lembreteCupom } = require('./_mail');
const { liberarPedido } = require('./_estoque');

const H = 3600000;
module.exports = async (req, res) => {
  const seg = process.env.CRON_SECRET;
  if (!seg || req.headers.authorization !== `Bearer ${seg}`) return res.status(401).end();
  if (!emailConfigurado()) return res.status(503).end();
  const fs = db(), agora = Date.now(); let enviados = 0;
  try {
    const snap = await fs.collection('carrinhos').get();
    for (const d of snap.docs) {
      const c = d.data(), idade = agora - (c.atualizadoEm?.toMillis?.() || agora), n = c.enviados || 0;
      if (idade > 10 * 24 * H) { await d.ref.delete(); continue; }
      const vez = n === 0 && idade >= 3 * H ? 1 : (n === 1 && idade >= 72 * H ? 2 : 0);
      if (!vez || !c.email) continue;
      const pref = await fs.collection('emailPrefs').doc(c.uid).get();
      if (pref.exists && pref.data().naoReceber) { await d.ref.delete(); continue; }
      // Já comprou depois de montar o carrinho? Então não incomoda.
      const ped = await fs.collection('pedidos').where('uid', '==', c.uid).get();
      if (ped.docs.some(p => (p.data().criadoEm?.toMillis?.() || 0) >= (c.atualizadoEm?.toMillis?.() || 0) - 60000)) { await d.ref.delete(); continue; }
      try { await enviar({ para: c.email, ...carrinho({ nome: c.nome, itens: c.itens, n: vez, uid: c.uid }) }); await d.ref.update({ enviados: vez }); enviados++; }
      catch (e) { console.error('cron carrinho', e.message); }
    }
    // Pagamento online que ninguém pagou: o link do Mercado Pago vence em 3 dias; depois disso a peça volta para o estoque.
    const reservados = await fs.collection('pedidos').where('status', '==', 'aguardando').where('estoqueReservado', '==', true).get();
    for (const d of reservados.docs) {
      const o = d.data();
      if (o.origem === 'whatsapp' || (o.criadoEm?.toMillis?.() || agora) > agora - 3 * 24 * H - 3600000) continue;
      try { await liberarPedido(fs, d.ref, { status: 'cancelado' }); } catch (e) { console.error('cron estoque', e.message); }
    }
    // Lembrete do cupom de primeira compra: 3 dias depois do cadastro, só para quem ainda não comprou e ainda está no prazo.
    const cfg = (await fs.collection('config').doc('loja').get()).data() || {};
    if (cfg.cupomPrimeira !== false) {
      const pct = Math.min(50, Number(cfg.primeiraPct) > 0 ? Number(cfg.primeiraPct) : 10), dias = Math.min(30, Number(cfg.primeiraDias) > 0 ? Number(cfg.primeiraDias) : 7);
      const ps = await fs.collection('primeira').where('lembrete', '==', false).get();
      for (const d of ps.docs) {
        const c = d.data(), idade = agora - (c.criadoEm?.toMillis?.() || agora);
        if (idade >= dias * 86400000) { await d.ref.delete(); continue; }
        if (idade < 3 * 86400000 || !c.email) continue;
        const pref = await fs.collection('emailPrefs').doc(c.uid).get();
        const ped = await fs.collection('pedidos').where('uid', '==', c.uid).get();
        if ((pref.exists && pref.data().naoReceber) || ped.docs.some(p => !['cancelado', 'recusado'].includes(p.data().status))) { await d.ref.delete(); continue; }
        const restam = Math.max(1, Math.ceil((dias * 86400000 - idade) / 86400000));
        try { await enviar({ para: c.email, ...lembreteCupom({ nome: c.nome, percent: pct, restam, uid: c.uid }) }); await d.ref.update({ lembrete: true }); enviados++; }
        catch (e) { console.error('cron lembrete cupom', e.message); }
      }
    }
    res.status(200).json({ ok: true, enviados });
  } catch (e) { console.error('cron:', e); res.status(500).end(); }
};
