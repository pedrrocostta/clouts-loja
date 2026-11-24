/* Frete dos Correios (PAC e Sedex) pelo Melhor Envio. Só o servidor fala com o Melhor Envio: o token fica em MELHORENVIO_TOKEN (Vercel → Settings → Environment Variables).
 * Cobramos o preço de tabela dos Correios ("balcão"), não o preço com desconto da conta do Melhor Envio.
 * Medidas da embalagem de UMA calça (a maior, tam. 46): 29 × 27,5 × 4,5 cm e 575 g. Mais peças: soma a altura e o peso. */
const ORIGEM = '32280620';   // CEP de onde os pedidos saem (Contagem)
const PACOTE = { comp: 29, larg: 27.5, alt: 4.5, peso: 0.575 };
const SERVICOS = { 1: 'pac', 2: 'sedex' };   // códigos dos Correios no Melhor Envio
const NOMES = { pac: 'PAC', sedex: 'Sedex' };

const cache = new Map();   // cep|qtd → { t, opcoes }  (10 min; evita consultar de novo a cada clique)
const TTL = 10 * 60000;

function erro(status, msg) { const e = new Error(msg); e.status = status; return e; }

async function cotarCorreios(cepDestino, qtd) {
  const cep = String(cepDestino || '').replace(/\D/g, ''), q = Math.max(1, Math.min(20, Math.floor(Number(qtd)) || 1));
  if (cep.length !== 8) throw erro(400, 'CEP inválido.');
  if (!process.env.MELHORENVIO_TOKEN) throw erro(503, 'O frete dos Correios ainda não está ativo.');
  const k = cep + '|' + q, c = cache.get(k);
  if (c && Date.now() - c.t < TTL) return c.opcoes;
  let r, j;
  try {
    r = await fetch('https://www.melhorenvio.com.br/api/v2/me/shipment/calculate', {
      method: 'POST', signal: AbortSignal.timeout(9000),
      headers: { Authorization: 'Bearer ' + process.env.MELHORENVIO_TOKEN, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Loja Clouts (site cloutsoficial.com.br)' },
      body: JSON.stringify({
        from: { postal_code: ORIGEM }, to: { postal_code: cep },
        package: { height: Math.round(PACOTE.alt * q * 10) / 10, width: PACOTE.larg, length: PACOTE.comp, weight: Math.round(PACOTE.peso * q * 1000) / 1000 },
        options: { receipt: false, own_hand: false, collective: false }, services: Object.keys(SERVICOS).join(',')
      })
    });
    j = await r.json().catch(() => null);
  } catch { throw erro(503, 'Não foi possível calcular o frete dos Correios agora. Tente de novo.'); }
  if (!r.ok || !Array.isArray(j)) { console.error('Melhor Envio', r.status, JSON.stringify(j).slice(0, 300)); throw erro(503, 'Não foi possível calcular o frete dos Correios agora. Tente de novo.'); }
  if (globalThis.__bruto) globalThis.__bruto(j);   // TEMPORÁRIO (diagnóstico do preço)
  const opcoes = j.filter(s => SERVICOS[s.id] && !s.error && Number(s.price) > 0).map(s => ({
    tipo: SERVICOS[s.id], nome: NOMES[SERVICOS[s.id]],
    valor: Math.round(Number(s.price) * 100) / 100,   // preço de tabela (balcão)
    prazo: Number(s.delivery_range?.max || s.delivery_time) || null   // dias úteis dos Correios (o preparo do pedido vem à parte)
  })).sort((a, b) => a.valor - b.valor);
  if (!opcoes.length) throw erro(404, 'Os Correios não atendem este CEP pela loja. Fale com a gente no WhatsApp.');
  cache.set(k, { t: Date.now(), opcoes });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return opcoes;
}

module.exports = { cotarCorreios, ORIGEM, PACOTE };
