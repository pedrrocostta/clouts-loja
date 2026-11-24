/* GET /api/frete?cep=XXXXXXXX&q=N — opções de entrega para o carrinho (q = número de peças).
 * PAC e Sedex (preço de tabela dos Correios) para qualquer CEP; em Contagem/Betim/BH o cliente também pode escolher retirada ou motoboy/Uber (sem frete). O valor que vale é sempre recalculado em /api/checkout. */
const { infoCep, FRETE_INFO, erro, responder } = require('./_lib');
const { cotarCorreios } = require('./_frete');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido.' });
  try {
    const cep = String(req.query?.cep || '').replace(/\D/g, ''), q = Number(req.query?.q) || 1;
    const info = await infoCep(cep);
    res.status(200).json({ ...info, gratisPac: info.local ? FRETE_INFO.GRATIS : null, opcoes: await cotarCorreios(cep, q) });
  } catch (e) { responder(res, e); }
};
