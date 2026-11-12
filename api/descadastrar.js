/* GET /api/descadastrar?u=UID&t=ASSINATURA — "parar de receber lembretes" (link do rodapé dos e-mails de carrinho). */
const { db } = require('./_lib');
const { assinaturaOk, site } = require('./_mail');

const pagina = (t, m) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CLOUTS</title></head><body style="margin:0;background:#faf6ee;font-family:Inter,Arial,sans-serif;color:#12100c;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px"><div><h1 style="font-size:22px">${t}</h1><p style="color:#5f584c">${m}</p><p><a href="${site()}" style="color:#b0842d">Voltar para a loja</a></p></div></body></html>`;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  const uid = String(req.query.u || ''), t = String(req.query.t || '');
  if (!/^[\w-]{10,64}$/.test(uid) || !assinaturaOk(uid, t)) return res.status(400).send(pagina('Link inválido', 'Este link não é válido ou expirou.'));
  try {
    const fs = db();
    await fs.collection('emailPrefs').doc(uid).set({ naoReceber: true });
    await fs.collection('carrinhos').doc(uid).delete();
    res.status(200).send(pagina('Pronto!', 'Você não vai mais receber lembretes de carrinho da CLOUTS.'));
  } catch (e) { console.error('descadastrar:', e); res.status(500).send(pagina('Erro', 'Não foi possível agora. Tente de novo em instantes.')); }
};
