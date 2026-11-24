/* Frete dos Correios (PAC e Sedex) pelo Melhor Envio. Só o servidor fala com o Melhor Envio: o token fica em MELHORENVIO_TOKEN (Vercel → Settings → Environment Variables).
 * Cobramos o preço aproximado de balcão dos Correios (preço do Melhor Envio × FATOR_BALCAO), não o preço com desconto da conta do Melhor Envio.
 * Medidas da embalagem de UMA calça (a maior, tam. 46): 29 × 27,5 × 4,5 cm e 575 g. Mais peças: soma a altura e o peso. */
const ORIGEM = '32280620';   // CEP de onde os pedidos saem (Contagem)
const PACOTE = { comp: 29, larg: 27.5, alt: 4.5, peso: 0.575 };
/* O Melhor Envio só informa o preço com o desconto da conta dele; o preço de balcão dos Correios não vem na resposta. Para chegar perto do balcão, MULTIPLICAMOS por um fator que depende do serviço e da região.
 * Calibrado em 24/11/2026 com o calculador dos Correios (pacote de 575 g, faixa de 1 kg), origem 32280-620:
 *   Sedex Contagem→Contagem  ME 12,45 × balcão 27,60 = 2,217   (mesma região: Contagem, Betim e BH)
 *   Sedex →Rio               ME 31,27 × balcão 46,80 = 1,497
 *   Sedex →Curitiba          ME 43,77 × balcão 65,00 = 1,485   (Sedex fora da região ≈ 1,49)
 *   PAC   →Rio               ME 21,90 × balcão 30,50 = 1,393
 * Ainda NÃO conferidos: pacotes mais pesados (2 peças ou mais), PAC de outros destinos, outras cidades de MG. Reconfira de tempos em tempos no site dos Correios e ajuste os fatores. */
const FATOR_BALCAO = { local: { sedex: 2.217, pac: 2.217 }, nacional: { sedex: 1.49, pac: 1.393 } };
const SERVICOS = { 1: 'pac', 2: 'sedex' };   // códigos dos Correios no Melhor Envio
const NOMES = { pac: 'PAC', sedex: 'Sedex' };

const cache = new Map();   // cep|qtd → { t, opcoes }  (10 min; evita consultar de novo a cada clique)
const TTL = 10 * 60000;

function erro(status, msg) { const e = new Error(msg); e.status = status; return e; }

async function cotarCorreios(cepDestino, qtd, local = false) {
  const cep = String(cepDestino || '').replace(/\D/g, ''), q = Math.max(1, Math.min(20, Math.floor(Number(qtd)) || 1));
  if (cep.length !== 8) throw erro(400, 'CEP inválido.');
  if (!process.env.MELHORENVIO_TOKEN) throw erro(503, 'O frete dos Correios ainda não está ativo.');
  const k = cep + '|' + q + '|' + (local ? 'L' : 'N'), c = cache.get(k);
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
  const opcoes = j.filter(s => SERVICOS[s.id] && !s.error && Number(s.price) > 0).map(s => ({
    tipo: SERVICOS[s.id], nome: NOMES[SERVICOS[s.id]],
    valor: Math.round(Number(s.price) * FATOR_BALCAO[local ? 'local' : 'nacional'][SERVICOS[s.id]] * 100) / 100,   // aproxima o preço de balcão dos Correios
    prazo: Number(s.delivery_range?.max || s.delivery_time) || null   // dias úteis dos Correios (o preparo do pedido vem à parte)
  })).sort((a, b) => a.valor - b.valor);
  if (!opcoes.length) throw erro(404, 'Os Correios não atendem este CEP pela loja. Fale com a gente no WhatsApp.');
  cache.set(k, { t: Date.now(), opcoes });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return opcoes;
}

module.exports = { cotarCorreios, ORIGEM, PACOTE, FATOR_BALCAO };
