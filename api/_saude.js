/* Rede de segurança da loja (roda na rotina diária, api/cron.js):
 *  1) conferirPagamentos: pedido online "aguardando" que na verdade foi pago (aviso do Mercado Pago que se perdeu) é confirmado.
 *  2) verificarSaude: testa Mercado Pago, Correios (Melhor Envio), banco de dados e e-mail; se algo falhar, avisa a loja por e-mail.
 *  3) fazerBackup: copia produtos, pedidos, cupons, avisos, campanhas, solicitações e configurações para um arquivo e envia para o e-mail da loja (toda segunda).
 * Arquivos com "_" não viram endereços públicos na Vercel. */
const zlib = require('zlib');
const { db, mp, ADMINS } = require('./_lib');
const { cotarCorreios } = require('./_frete');
const { aplicarPagamento } = require('./_pagamento');
const { emailConfigurado, enviar } = require('./_mail');

const DIA = 86400000;

/* Pagamentos aprovados no Mercado Pago que a loja ainda não registrou. Devolve quantos foram corrigidos. */
async function conferirPagamentos(agora = Date.now()) {
  const fs = db(); let corrigidos = 0;
  const snap = await fs.collection('pedidos').where('status', '==', 'aguardando').get();
  for (const d of snap.docs) {
    const o = d.data();
    if (o.origem === 'whatsapp' || (o.criadoEm?.toMillis?.() || agora) < agora - 3 * DIA) continue;
    try {
      const r = await mp(`/v1/payments/search?external_reference=${encodeURIComponent(d.id)}&sort=date_created&criteria=desc`);
      const pg = (r.results || []).find(x => x.status === 'approved');
      if (pg && (await aplicarPagamento(pg)) === 'pago') corrigidos++;
    } catch (e) { console.error('conferir pagamento', d.id, e.message); }
  }
  return corrigidos;
}

/* Lista de problemas encontrados (vazia = tudo certo). */
async function verificarSaude() {
  const problemas = [];
  try { await mp('/users/me'); } catch (e) { problemas.push('Mercado Pago não respondeu ou o token (MP_ACCESS_TOKEN) é inválido/expirou.'); }
  try { await db().collection('config').doc('loja').get(); } catch (e) { problemas.push('O banco de dados (Firestore) não respondeu: ' + e.message); }
  if (!process.env.MELHORENVIO_TOKEN) problemas.push('MELHORENVIO_TOKEN não está configurado: o frete dos Correios não funciona.');
  else { try { await cotarCorreios('01001000', 1); } catch (e) { problemas.push('O frete dos Correios (Melhor Envio) não respondeu. O token pode ter vencido: gere outro em Integrações → Tokens e troque MELHORENVIO_TOKEN na Vercel. Detalhe: ' + e.message); } }
  if (!process.env.CRON_SECRET) problemas.push('CRON_SECRET não está configurado.');
  return problemas;
}

/* Timestamps do Firestore viram texto; o resto segue igual. */
const serializar = v => {
  if (v && typeof v === 'object') {
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (Array.isArray(v)) return v.map(serializar);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serializar(x)]));
  }
  return v;
};
const COLECOES = ['produtos', 'pedidos', 'codigos', 'campanhas', 'avisos', 'solicitacoes', 'config'];

async function fazerBackup(agora = new Date()) {
  const fs = db(), dados = {};
  for (const c of COLECOES) { const s = await fs.collection(c).get(); dados[c] = Object.fromEntries(s.docs.map(d => [d.id, serializar(d.data())])); }
  const resumo = Object.fromEntries(COLECOES.map(c => [c, Object.keys(dados[c]).length]));
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ geradoEm: agora.toISOString(), dados }), 'utf8'));
  if (gz.length > 18 * 1024 * 1024) throw new Error('backup grande demais para e-mail (' + Math.round(gz.length / 1048576) + ' MB)');
  const dia = agora.toISOString().slice(0, 10);
  await enviar({
    para: ADMINS[0], assunto: `CLOUTS: backup dos dados (${dia})`,
    texto: `Backup semanal da loja CLOUTS.\n\n${Object.entries(resumo).map(([k, n]) => `${k}: ${n}`).join('\n')}\n\nO arquivo anexo (.json.gz) guarda tudo. Guarde-o em local seguro (Drive, por exemplo). Ele tem dados de clientes: não compartilhe.`,
    html: `<p>Backup semanal da loja CLOUTS.</p><ul>${Object.entries(resumo).map(([k, n]) => `<li>${k}: <b>${n}</b></li>`).join('')}</ul><p>O arquivo anexo (<code>.json.gz</code>) guarda tudo. Guarde-o em local seguro (Drive, por exemplo). Ele tem dados de clientes: não compartilhe.</p>`,
    anexos: [{ nome: `clouts-backup-${dia}.json.gz`, conteudo: gz }]
  });
  return resumo;
}

async function alertar(problemas) {
  if (!problemas.length || !emailConfigurado()) return;
  await enviar({
    para: ADMINS[0], assunto: 'CLOUTS: atenção, algo precisa de conferência',
    texto: 'A verificação diária da loja encontrou:\n\n- ' + problemas.join('\n- ') + '\n\nAbra a Vercel (Logs) ou fale com o suporte para corrigir.',
    html: '<p>A verificação diária da loja encontrou:</p><ul>' + problemas.map(p => `<li>${String(p).replace(/[<>&]/g, '')}</li>`).join('') + '</ul><p>Abra a Vercel (Logs) ou fale com o suporte para corrigir.</p>'
  });
}

module.exports = { conferirPagamentos, verificarSaude, fazerBackup, alertar };
