/* POST /api/webhook — aviso do Mercado Pago. Não confia no corpo: consulta o pagamento direto na API do Mercado Pago e deixa _pagamento.js
 * conferir valor e pedido, marcar como pago, baixar o estoque, queimar o cupom e contar a indicação (só na primeira compra paga do amigo). */
const crypto = require('crypto');
const { configurado, mp } = require('./_lib');
const { aplicarPagamento } = require('./_pagamento');

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
    // A assinatura é uma camada extra: o Mercado Pago usa um segredo diferente no modo de teste e no de produção, e uma assinatura que não confere não pode travar a venda.
    // A segurança real vem daqui para baixo: o pagamento é buscado direto na API do Mercado Pago com o nosso token (o corpo do aviso nunca é confiado), e valor e pedido são conferidos.
    if (!assinaturaOk(req, id)) console.warn('webhook: assinatura não confere; seguindo com a conferência direta no Mercado Pago');

    const pg = await mp(`/v1/payments/${id}`);   // nunca confia no corpo do aviso: pergunta ao Mercado Pago
    await aplicarPagamento(pg);
    res.status(200).end();
  } catch (e) {
    if (e.mpStatus === 404) return res.status(200).end();   // pagamento que não existe nesta conta (aviso falso ou de outra loja): ignora, sem erro e sem novas tentativas
    console.error('webhook:', e); res.status(500).end();
  }
};
