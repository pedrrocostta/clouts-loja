/* Funções compartilhadas do pagamento (Mercado Pago). Arquivos com "_" não viram endereços públicos na Vercel.
 * Variáveis de ambiente (Vercel → Settings → Environment Variables), NUNCA no código nem no GitHub:
 *   MP_ACCESS_TOKEN           Access Token de PRODUÇÃO da conta Mercado Pago (começa com APP_USR-)
 *   FIREBASE_SERVICE_ACCOUNT  JSON da conta de serviço do Firebase (Configurações do projeto → Contas de serviço → Gerar chave)
 *   SITE_URL                  https://www.cloutsoficial.com.br  (ou o domínio próprio, sem barra no final)
 *   MP_WEBHOOK_SECRET         (opcional, recomendado) "Assinatura secreta" das notificações do Mercado Pago
 */
const admin = require('firebase-admin');
const { cotarCorreios } = require('./_frete');

const CIDADES = ['Contagem', 'Betim', 'Belo Horizonte'];
// O frete vem dos Correios (api/_frete.js). A partir deste subtotal o serviço mais barato dos Correios é grátis, só em Contagem, Betim e Belo Horizonte.
const FRETE_GRATIS_ACIMA = 300;   // igual a CONFIG.freteGratisAcima em app.js
const DEGRAUS = [5, 10, 20];

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function configurado() {
  return !!(process.env.MP_ACCESS_TOKEN && process.env.FIREBASE_SERVICE_ACCOUNT && process.env.SITE_URL);
}

function db() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return admin.firestore();
}

async function usuario(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  try { db(); return await admin.auth().verifyIdToken(m[1]); } catch { return null; }
}

const cents = v => Math.round(Number(v) * 100);
const reais = c => Math.round(c) / 100;

/* Black Friday automática, todo ano: +5% em toda a loja na semana da Black Friday (da segunda até o domingo, 23h59 de Brasília).
 * A Black Friday é a sexta-feira depois da 4ª quinta-feira de novembro (2026: sexta 27/11, semana de 23/11 a 29/11). Fora da semana, os preços voltam ao normal sozinhos.
 * Soma com o cupom (ex.: 10% da primeira compra = 15%). A mesma regra está em app.js (bfJanela): mexa nos dois. */
const BF_PCT = 5;
function bfJanela(ms) {
  const ano = new Date(ms - 3 * 3600000).getUTCFullYear();
  let q = 0, d = 1; for (; d <= 30; d++) if (new Date(Date.UTC(ano, 10, d)).getUTCDay() === 4 && ++q === 4) break;
  const sexta = Date.UTC(ano, 10, d + 1, 3, 0, 0);   // 00h de Brasília = 03h UTC
  return { inicio: sexta - 4 * 86400000, fim: sexta + 3 * 86400000 - 1000 };
}
const bfVale = (ms = Date.now()) => { const j = bfJanela(ms); return ms >= j.inicio && ms <= j.fim; };

/* Calcula o pedido a partir do que está no Firestore (preço, estoque e cupom do servidor). O navegador só informa ids, tamanhos e quantidades. */
async function calcular({ itens, cupom, bf, cep, tel, entrega }, uid) {
  if (!Array.isArray(itens) || !itens.length || itens.length > 40) throw erro(400, 'Carrinho vazio ou inválido.');
  const fs = db();
  let sub = 0, qtd = 0; const linhas = [];
  for (const it of itens) {
    const id = String(it?.id || ''), q = Number(it?.q), tam = String(it?.tam || '');
    if (!/^[\w.-]{1,80}$/.test(id) || !Number.isInteger(q) || q < 1 || q > 20) throw erro(400, 'Item inválido no carrinho.');
    const snap = await fs.collection('produtos').doc(id).get();
    if (!snap.exists) throw erro(400, 'Uma das peças não está mais disponível.');
    const p = snap.data();
    if (p.visivel === false || p.esgotado === true) throw erro(409, `${p.nome} está esgotada.`);
    if (Array.isArray(p.tam) && p.tam.length && !p.tam.map(String).includes(tam)) throw erro(409, `Tamanho ${tam} indisponível em ${p.nome}.`);
    const pc = cents(p.preco);
    if (!(pc > 0)) throw erro(409, 'Preço da peça ainda não definido. Finalize pelo WhatsApp.');
    sub += pc * q; qtd += q;
    linhas.push({ id, cod: p.cod, nome: p.nome, tam, q, preco: reais(pc) });
  }
  // Entrega: Correios (PAC/Sedex, Brasil todo, preço de tabela) ou, só em Contagem, Betim e BH, retirada com a loja e motoboy/Uber (combinados no WhatsApp, sem frete).
  const tipo = String(entrega || 'pac'), info = await infoCep(cep);
  if (!['retirada', 'motoboy', 'pac', 'sedex'].includes(tipo)) throw erro(400, 'Forma de entrega inválida. Atualize a página e escolha a entrega de novo.');
  const cidade = info.cidade;
  let frete = 0, prazo = null, entregaNome = tipo === 'retirada' ? 'Retirada com a loja' : 'Motoboy/Uber (combinar no WhatsApp)';
  if (tipo === 'pac' || tipo === 'sedex') {
    const todas = await cotarCorreios(cep, qtd, info.local), op = todas.find(o => o.tipo === tipo);   // todas já vem da mais barata para a mais cara
    if (!op) throw erro(409, 'Esse serviço dos Correios não está disponível para o seu CEP. Escolha outro.');
    frete = op.valor; prazo = op.prazo; entregaNome = 'Correios ' + op.nome;
    if (info.local && FRETE_GRATIS_ACIMA != null && sub >= cents(FRETE_GRATIS_ACIMA) && op.tipo === todas[0].tipo) frete = 0;   // a partir de R$ 300 em Contagem, Betim e BH o serviço mais barato dos Correios (PAC ou, se não houver PAC, o Sedex) é grátis
  } else if (!info.local) throw erro(400, 'Retirada e motoboy valem só para Contagem, Betim e Belo Horizonte. Escolha os Correios.');
  let percent = 0;
  if (cupom && String(cupom) !== 'BLACKFRIDAY') {
    const code = String(cupom), cfg = (await fs.collection('config').doc('loja').get()).data() || {};
    if (code === 'AMIGO' || code === 'BEMVINDO') {
      // O dono pode ligar e desligar estes cupons no painel.
      if (cfg[code === 'AMIGO' ? 'cupomAmigo' : 'cupomBemvindo'] === false) throw erro(409, 'Este cupom está desativado no momento.');
      const c = await fs.collection('users').doc(uid).collection('cupons').doc(code).get();
      if (!c.exists || c.data().usado || !DEGRAUS.includes(c.data().percent)) throw erro(409, 'Cupom indisponível.');
      percent = c.data().percent;
      // BEMVINDO (código de amigo) vale só na primeira compra: quem já tem pedido pago não usa.
      if (code === 'BEMVINDO') {
        const ja = await fs.collection('pedidos').where('uid', '==', uid).where('status', '==', 'pago').limit(1).get();
        if (!ja.empty) throw erro(409, 'O cupom BEMVINDO vale apenas na primeira compra.');
      }
    } else if (code === 'PRIMEIRA') {
      // Cupom de primeira compra: conta nova (dentro do prazo) e sem nenhum pedido anterior.
      if (cfg.cupomPrimeira === false) throw erro(409, 'Este cupom está desativado no momento.');
      const pct = Math.min(50, Number(cfg.primeiraPct) > 0 ? Number(cfg.primeiraPct) : 10), dias = Math.min(30, Number(cfg.primeiraDias) > 0 ? Number(cfg.primeiraDias) : 7);
      const usr = await admin.auth().getUser(uid), criado = Date.parse(usr.metadata.creationTime);
      if (!(criado + dias * 86400000 > Date.now())) throw erro(409, 'O cupom de primeira compra expirou.');
      // Gasta o cupom: pedido pago, ou pedido do WhatsApp em andamento. Link de pagamento aberto e não pago NÃO gasta (o cliente pode voltar e tentar de novo).
      const gasta = x => !['cancelado', 'recusado'].includes(x.status) && !(x.origem !== 'whatsapp' && x.status === 'aguardando');
      const ant = await fs.collection('pedidos').where('uid', '==', uid).get();
      if (ant.docs.some(d => gasta(d.data()))) throw erro(409, 'O cupom de primeira compra vale apenas na primeira compra.');
      // Outra conta Google com o mesmo WhatsApp não ganha o cupom de novo.
      const t = String(tel || '').replace(/\D/g, '').slice(-11);
      if (t.length >= 10) {
        const mesmo = await fs.collection('pedidos').where('telDigitos', '==', t).where('cupom', '==', 'PRIMEIRA').get();
        if (mesmo.docs.some(d => d.data().uid !== uid && gasta(d.data()))) throw erro(409, 'O cupom de primeira compra já foi usado com este WhatsApp.');
      }
      percent = pct;
    } else {
      // Código promocional criado pelo dono no painel (campanhas/{CÓDIGO}): ativo, dentro da validade, uma vez por cliente.
      const c = await fs.collection('campanhas').doc(code).get(), d = c.data();
      if (cfg.campanhas === false || !c.exists || d.ativo !== true || (d.expiraEm && d.expiraEm.toMillis() < Date.now()) || !(d.percent >= 1 && d.percent <= 90)) throw erro(409, 'Código promocional indisponível.');
      const ja = await fs.collection('pedidos').where('uid', '==', uid).where('cupom', '==', code).where('status', '==', 'pago').limit(1).get();
      if (!ja.empty) throw erro(409, 'Você já usou este código promocional.');
      percent = d.percent;
    }
  }
  // Black Friday: soma com o cupom, só dentro das datas, e o servidor decide (o navegador só pede).
  const pediuBf = bf === true || String(cupom || '') === 'BLACKFRIDAY';
  if (pediuBf && !bfVale()) throw erro(409, 'A promoção Black Friday já terminou. Atualize a página.');
  const bfPct = bfVale() ? BF_PCT : 0, primario = !!percent;   // na semana da Black Friday o desconto vale para todos os pedidos, como nos preços mostrados
  const desc = Math.round(sub * (percent + bfPct) / 100);
  const total = sub - desc + cents(frete);
  return { linhas, cidade, uf: info.uf, entrega: { tipo, nome: entregaNome, ...(prazo ? { prazo } : {}) }, subtotal: reais(sub), desconto: reais(desc), frete: reais(cents(frete)), total: reais(total),
    percent: primario ? percent : bfPct, bf: primario ? bfPct : 0, cupom: primario ? String(cupom) : (bfPct ? 'BLACKFRIDAY' : null) };
}

/* Consulta o CEP (ViaCEP). local = Contagem, Betim ou Belo Horizonte (entrega própria). Qualquer outro CEP do Brasil só vai pelos Correios. */
async function infoCep(cep) {
  const c = String(cep || '').replace(/\D/g, '');
  if (c.length !== 8) throw erro(400, 'CEP inválido.');
  let d;
  try { d = await (await fetch(`https://viacep.com.br/ws/${c}/json/`, { signal: AbortSignal.timeout(5000) })).json(); }
  catch { throw erro(503, 'Não foi possível confirmar o CEP agora. Tente de novo.'); }
  if (d?.erro || !d?.localidade || !/^[A-Z]{2}$/.test(d.uf || '')) throw erro(400, 'CEP não encontrado.');
  const propria = CIDADES.find(x => norm(x) === norm(d.localidade));
  const local = !!propria && d.uf === 'MG';
  return { cidade: local ? propria : String(d.localidade).slice(0, 60), uf: d.uf, local, bairro: d.bairro || '', rua: d.logradouro || '' };
}

function erro(status, msg) { const e = new Error(msg); e.status = status; return e; }
function responder(res, e) {
  const status = e.status || 500;
  if (!e.status) console.error('erro interno:', e);
  res.status(status).json({ erro: e.status ? e.message : 'Erro interno. Tente de novo em instantes.' });
}

const mp = async (path, opt = {}) => {
  const r = await fetch('https://api.mercadopago.com' + path, {
    ...opt, headers: { Authorization: 'Bearer ' + process.env.MP_ACCESS_TOKEN, 'Content-Type': 'application/json', ...(opt.headers || {}) }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Mercado Pago', r.status, JSON.stringify(j).slice(0, 400)); const e = erro(502, 'O Mercado Pago não respondeu. Tente de novo.'); e.mpStatus = r.status; throw e; }
  return j;
};

const FRETE_INFO = { GRATIS: FRETE_GRATIS_ACIMA };
/* Administradores do painel: contas Google verificadas. Para autorizar mais alguém, acrescente o e-mail aqui, em painel/painel.js (ADMINS) e em firestore.rules (isAdmin) e republique as regras. */
const ADMINS = ['clouts.oficial2026@gmail.com', 'brenovilaca48@gmail.com'];
const ehAdmin = u => !!u && ADMINS.includes(String(u.email || '').toLowerCase()) && u.email_verified === true && u.firebase?.sign_in_provider === 'google.com';
module.exports = { admin, db, configurado, usuario, calcular, mp, erro, responder, cents, reais, DEGRAUS, FRETE_INFO, ADMINS, ehAdmin, BF_PCT, bfVale, bfJanela, infoCep };
