/* POST /api/analytics { periodo: 'hoje'|'7'|'30'|'90'|'tudo' }  ou  { agora: true } (só o contador de pessoas no site, sem memória) — visitas do site (Google Analytics 4) para o dashboard do painel. Só o administrador.
 * Usa a mesma conta de serviço do Firebase (FIREBASE_SERVICE_ACCOUNT) para ler a propriedade do Analytics. Para funcionar:
 *   1) ativar a "Google Analytics Data API" no projeto do Google Cloud (clouts-409b7);
 *   2) no Analytics → Administrador → Gerenciamento de acesso da propriedade, adicionar o e-mail da conta de serviço como "Leitor";
 *   3) no painel → Site → "ID da propriedade do Analytics" (número, não o G-XXXX).
 * Os números só incluem quem aceitou os cookies. */
const crypto = require('crypto');
const { db, usuario, erro, responder } = require('./_lib');

const ADMIN = 'clouts.oficial2026@gmail.com';
const PROPRIEDADE_PADRAO = '556669532';   // propriedade do GA4 da loja (não é segredo); o painel (Site) pode trocar
const ehAdmin = u => u && u.email === ADMIN && u.email_verified === true && u.firebase?.sign_in_provider === 'google.com';

/* Token de acesso (JWT assinado com a chave da conta de serviço), guardado até perto de vencer. */
let tok = { v: null, exp: 0 }, tokP = null;
async function token() {
  if (tok.v && tok.exp > Date.now() + 60000) return tok.v;
  return tokP ??= obterToken().finally(() => { tokP = null; });   // vários relatórios em paralelo dividem um único pedido de token
}
async function obterToken() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT), agora = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sem = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 })}`;
  const ass = crypto.createSign('RSA-SHA256').update(sem).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${sem}.${ass}` }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { const e = new Error(j.error_description || j.error || 'token'); e.gaStatus = r.status; throw e; }
  tok = { v: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return tok.v;
}

async function ga(prop, metodo, corpo) {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${prop}:${metodo}`, { method: 'POST', headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j?.error?.message || `GA ${r.status}`); e.gaStatus = r.status; e.gaMsg = String(j?.error?.message || ''); throw e; }
  return j;
}

const FAIXAS = { hoje: [['today', 'today'], ['yesterday', 'yesterday']], 7: [['6daysAgo', 'today'], ['13daysAgo', '7daysAgo']], 30: [['29daysAgo', 'today'], ['59daysAgo', '30daysAgo']], 90: [['89daysAgo', 'today'], ['179daysAgo', '90daysAgo']], tudo: [['365daysAgo', 'today'], null] };
const linhas = r => (r?.rows || []).map(x => [...(x.dimensionValues || []).map(v => v.value), ...(x.metricValues || []).map(v => Number(v.value))]);
const METRICAS = ['activeUsers', 'sessions', 'screenPageViews', 'newUsers', 'averageSessionDuration'];
const totais = r => { const v = linhas(r)[0] || [0, 0, 0, 0, 0]; return { usuarios: v[0], sessoes: v[1], visualizacoes: v[2], novos: v[3], duracao: Math.round(v[4] || 0) }; };

const ativos = r => Number(r?.totals?.[0]?.metricValues?.[0]?.value ?? r?.rows?.[0]?.metricValues?.[0]?.value ?? 0) || 0;
const memo = {};   // 60 s por período: o painel pode atualizar sem gastar a cota do Google

async function relatorio(prop, periodo) {
  const [cur, ant] = FAIXAS[periodo], rg = ([a, b]) => [{ startDate: a, endDate: b }];
  const T = (nome, p) => p.then(v => v, e => { if (nome === 'atual') throw e; return null; });   // só o principal derruba tudo; os outros são opcionais
  const [atual, anterior, dia, canais, aparelhos, eventos, pecas, cidades, agora] = await Promise.all([
    T('atual', ga(prop, 'runReport', { dateRanges: rg(cur), metrics: METRICAS.map(name => ({ name })) })),
    ant ? T('ant', ga(prop, 'runReport', { dateRanges: rg(ant), metrics: METRICAS.map(name => ({ name })) })) : null,
    T('dia', ga(prop, 'runReport', { dateRanges: rg(cur), dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 100 })),
    T('canais', ga(prop, 'runReport', { dateRanges: rg(cur), dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 })),
    T('aparelhos', ga(prop, 'runReport', { dateRanges: rg(cur), dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }] })),
    T('eventos', ga(prop, 'runReport', { dateRanges: rg(cur), dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: ['view_item', 'add_to_cart', 'generate_lead', 'solicitar_peca'] } } } })),
    T('pecas', ga(prop, 'runReport', { dateRanges: rg(cur), dimensions: [{ name: 'itemName' }], metrics: [{ name: 'itemsViewed' }], orderBys: [{ metric: { metricName: 'itemsViewed' }, desc: true }], limit: 6 })),
    T('cidades', ga(prop, 'runReport', { dateRanges: rg(cur), dimensions: [{ name: 'city' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 6 })),
    ga(prop, 'runRealtimeReport', { metrics: [{ name: 'activeUsers' }] }).then(v => ({ v }), e => ({ e }))
  ]);
  const ev = {}; linhas(eventos).forEach(([k, n]) => { ev[k] = n; });
  const rt = ativos(agora?.v);
  return {
    ok: true, periodo, atual: totais(atual), anterior: anterior ? totais(anterior) : null,
    porDia: linhas(dia).map(([d, u, s]) => ({ d, u, s })), canais: linhas(canais).filter(x => x[0] !== '(not set)'), aparelhos: linhas(aparelhos),
    agoraErro: agora?.e ? String(agora.e.gaMsg || agora.e.message).slice(0, 160) : null,
    eventos: ev, pecas: linhas(pecas).filter(x => x[0] && x[0] !== '(not set)'), cidades: linhas(cidades).filter(x => x[0] && x[0] !== '(not set)'), agora: Number(rt) || 0
  };
}

function motivoDe(e) {
  const msg = String(e.gaMsg || e.message || ''), sa = (() => { try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT).client_email; } catch { return ''; } })();
  if (e.gaStatus === 403 && /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg)) return { ok: false, motivo: 'api-desativada', conta: sa };
  if (e.gaStatus === 403) return { ok: false, motivo: 'sem-acesso', conta: sa };
  if (e.gaStatus === 400 || e.gaStatus === 404) return { ok: false, motivo: 'propriedade-invalida', conta: sa };
  console.error('analytics:', msg); return { ok: false, motivo: 'erro', conta: sa };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  try {
    const u = await usuario(req); if (!u) throw erro(401, 'Entre na sua conta.');
    if (!ehAdmin(u)) throw erro(403, 'Somente o administrador.');
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const periodo = FAIXAS[String(b.periodo)] ? String(b.periodo) : '30';
    const cfg = (await db().collection('config').doc('loja').get()).data() || {}, prop = String(cfg.gaPropertyId || PROPRIEDADE_PADRAO).replace(/\D/g, '');
    if (!prop) return res.status(200).json({ ok: false, motivo: 'sem-config' });
    if (b.agora === true) {   // contador "agora no site": sempre fresco
      try { return res.status(200).json({ ok: true, agora: ativos(await ga(prop, 'runRealtimeReport', { metrics: [{ name: 'activeUsers' }] })) }); }
      catch (e) { return res.status(200).json(motivoDe(e)); }
    }
    const m = memo[prop + periodo]; if (m && Date.now() - m.t < 60000) return res.status(200).json(m.dados);
    try {
      const dados = await relatorio(prop, periodo); memo[prop + periodo] = { t: Date.now(), dados };
      return res.status(200).json(dados);
    } catch (e) { return res.status(200).json(motivoDe(e)); }
  } catch (e) { responder(res, e); }
};
