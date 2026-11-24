/* GET /api/frete?cep=XXXXXXXX&q=N — opções de entrega para o carrinho (q = número de peças).
 * Contagem/Betim/BH: entrega própria, retirada e motoboy/Uber. Resto do Brasil: PAC e Sedex (preço de tabela dos Correios). O valor que vale é sempre recalculado em /api/checkout. */
const { infoCep, FRETE_INFO, erro, responder } = require('./_lib');
const { cotarCorreios } = require('./_frete');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido.' });
  try {
    const cep = String(req.query?.cep || '').replace(/\D/g, ''), q = Number(req.query?.q) || 1;
    const info = await infoCep(cep);
    if (info.local) return res.status(200).json({ ...info, correios: false, tabela: FRETE_INFO.FRETE[info.cidade], gratisAcima: FRETE_INFO.GRATIS });
    res.status(200).json({ ...info, correios: true, opcoes: await cotarCorreios(cep, q) });
  } catch (e) { responder(res, e); }
};
