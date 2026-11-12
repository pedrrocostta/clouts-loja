/* GET /api/cron — rodada diária (Vercel Cron): lembra quem deixou o carrinho parado.
 * 1º lembrete depois de 3 horas parado; 2º (última chamada) depois de 3 dias. Quem pediu para parar de receber não recebe. */
const { db } = require('./_lib');
const { emailConfigurado, enviar, carrinho } = require('./_mail');

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
    res.status(200).json({ ok: true, enviados });
  } catch (e) { console.error('cron:', e); res.status(500).end(); }
};
