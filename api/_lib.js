/* Funções compartilhadas do pagamento (Mercado Pago). Arquivos com "_" não viram endereços públicos na Vercel.
 * Variáveis de ambiente (Vercel → Settings → Environment Variables), NUNCA no código nem no GitHub:
 *   MP_ACCESS_TOKEN           Access Token de PRODUÇÃO da conta Mercado Pago (começa com APP_USR-)
 *   FIREBASE_SERVICE_ACCOUNT  JSON da conta de serviço do Firebase (Configurações do projeto → Contas de serviço → Gerar chave)
 *   SITE_URL                  https://clouts-loja.vercel.app  (ou o domínio próprio, sem barra no final)
 *   MP_WEBHOOK_SECRET         (opcional, recomendado) "Assinatura secreta" das notificações do Mercado Pago
 */
const admin = require('firebase-admin');

const CIDADES = ['Contagem', 'Betim', 'Belo Horizonte'];
// Fonte da verdade do frete: o servidor. Mantenha igual ao CONFIG.frete do app.js (que só exibe o valor).
const FRETE = { 'Contagem': 0, 'Betim': 0, 'Belo Horizonte': 0 };
const FRETE_GRATIS_ACIMA = null;
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

/* Calcula o pedido a partir do que está no Firestore (preço, estoque e cupom do servidor). O navegador só informa ids, tamanhos e quantidades. */
async function calcular({ itens, cupom, cep }, uid) {
  if (!Array.isArray(itens) || !itens.length || itens.length > 40) throw erro(400, 'Carrinho vazio ou inválido.');
  const fs = db();
  let sub = 0; const linhas = [];
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
    sub += pc * q;
    linhas.push({ id, cod: p.cod, nome: p.nome, tam, q, preco: reais(pc) });
  }
  const cidade = await cidadePorCep(cep);
  let frete = FRETE[cidade] ?? 0;
  if (FRETE_GRATIS_ACIMA != null && sub >= cents(FRETE_GRATIS_ACIMA)) frete = 0;
  let percent = 0;
  if (cupom) {
    const c = await fs.collection('users').doc(uid).collection('cupons').doc(String(cupom)).get();
    if (!c.exists || c.data().usado || !DEGRAUS.includes(c.data().percent)) throw erro(409, 'Cupom indisponível.');
    percent = c.data().percent;
  }
  const desc = Math.round(sub * percent / 100);
  const total = sub - desc + cents(frete);
  return { linhas, cidade, subtotal: reais(sub), desconto: reais(desc), frete: reais(cents(frete)), total: reais(total), percent, cupom: percent ? String(cupom) : null };
}

async function cidadePorCep(cep) {
  const c = String(cep || '').replace(/\D/g, '');
  if (c.length !== 8) throw erro(400, 'CEP inválido.');
  let d;
  try { d = await (await fetch(`https://viacep.com.br/ws/${c}/json/`, { signal: AbortSignal.timeout(5000) })).json(); }
  catch { throw erro(503, 'Não foi possível confirmar o CEP agora. Tente de novo.'); }
  const cidade = CIDADES.find(x => norm(x) === norm(d?.localidade));
  if (d?.erro || !cidade || d.uf !== 'MG') throw erro(400, 'Entregamos apenas em Contagem, Betim e Belo Horizonte.');
  return cidade;
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
  if (!r.ok) { console.error('Mercado Pago', r.status, JSON.stringify(j).slice(0, 400)); throw erro(502, 'O Mercado Pago não respondeu. Tente de novo.'); }
  return j;
};

module.exports = { admin, db, configurado, usuario, calcular, mp, erro, responder, cents, reais, DEGRAUS };
