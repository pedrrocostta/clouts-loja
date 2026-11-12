/* E-mails da CLOUTS: envio (Resend ou Gmail) e modelos visuais. Arquivos com "_" não viram endereços públicos na Vercel.
 * Variáveis de ambiente (Vercel → Settings → Environment Variables):
 *   FIREBASE_SERVICE_ACCOUNT   (já usada pelo pagamento) JSON da conta de serviço
 *   SITE_URL                   https://clouts-loja.vercel.app (sem barra no final)
 *   Envio, escolha UMA das opções:
 *     A) Gmail da loja (sem domínio): GMAIL_USER=clouts.oficial2026@gmail.com  e  GMAIL_APP_PASSWORD=senha de app de 16 letras
 *     B) Resend (precisa de domínio verificado): RESEND_API_KEY=re_...  e  MAIL_FROM="CLOUTS <ola@seudominio.com.br>"
 *   CRON_SECRET                texto aleatório longo; a Vercel o envia sozinha na rotina diária de carrinho abandonado
 *   MAIL_SECRET                (opcional) texto aleatório longo para assinar o link "parar de receber"
 */
const crypto = require('crypto');

const OURO = '#cea147', OURO_ESC = '#b0842d', CREME = '#fdf2df', PAPEL = '#faf6ee', TINTA = '#12100c', TINTA2 = '#5f584c', LINHA = '#e8dfcd', ESCURO = '#0e0d0b';
const site = () => (process.env.SITE_URL || 'https://clouts-loja.vercel.app').replace(/\/$/, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const primeiroNome = n => esc(String(n || '').trim().split(/\s+/)[0] || 'cliente');

function emailConfigurado() {
  return !!(process.env.FIREBASE_SERVICE_ACCOUNT && ((process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || (process.env.RESEND_API_KEY && process.env.MAIL_FROM)));
}

async function enviar({ para, assunto, html, texto }) {
  if (!para || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) throw new Error('destinatário inválido');
  if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [para], subject: assunto, html, text: texto })
    });
    if (!r.ok) throw new Error('Resend ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return;
  }
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  await t.sendMail({ from: `"CLOUTS" <${process.env.GMAIL_USER}>`, to: para, subject: assunto, html, text: texto });
}

/* Link "parar de receber": assinado, para ninguém descadastrar outra pessoa. */
function segredo() { return process.env.MAIL_SECRET || crypto.createHash('sha256').update(process.env.FIREBASE_SERVICE_ACCOUNT || 'clouts').digest('hex'); }
const assinar = uid => crypto.createHmac('sha256', segredo()).update('unsub:' + uid).digest('hex').slice(0, 32);
const linkSair = uid => `${site()}/api/descadastrar?u=${encodeURIComponent(uid)}&t=${assinar(uid)}`;
const assinaturaOk = (uid, t) => { try { return crypto.timingSafeEqual(Buffer.from(assinar(uid)), Buffer.from(String(t))); } catch { return false; } };

/* ---------- Modelo base: capa escura com dourado, cartão claro, rodapé ---------- */
function layout({ preheader, capa, corpo, rodape }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>CLOUTS</title></head>
<body style="margin:0;padding:0;background:${PAPEL};font-family:Inter,Helvetica,Arial,sans-serif;color:${TINTA}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPEL}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${LINHA}">
<tr><td align="center" style="background:${ESCURO};padding:34px 24px 30px">
  <img src="${site()}/img/logo.png" width="74" alt="" style="display:block;margin:0 auto 14px;height:auto">
  <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:34px;letter-spacing:.34em;color:${OURO};padding-left:.34em">CLOUTS</div>
  <div style="height:1px;width:56px;background:${OURO};margin:16px auto 0;opacity:.7"></div>
</td></tr>
${capa || ''}
<tr><td style="padding:30px 30px 8px">${corpo}</td></tr>
<tr><td style="padding:8px 30px 30px"><div style="border-top:1px solid ${LINHA};padding-top:18px;font-size:12px;line-height:1.6;color:${TINTA2};text-align:center">${rodape || ''}
<div style="margin-top:8px">CLOUTS · CNPJ 70.043.901/0001-46 · Entregamos em Contagem, Betim e Belo Horizonte</div></div></td></tr>
</table></td></tr></table></body></html>`;
}

const botao = (txt, href) => `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:22px auto 6px"><tr><td style="background:${OURO};border-radius:999px"><a href="${esc(href)}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:600;color:${ESCURO};text-decoration:none;border-radius:999px">${esc(txt)}</a></td></tr></table>`;
const titulo = t => `<h1 style="margin:0 0 12px;font-size:25px;line-height:1.25;font-weight:700;color:${TINTA};text-align:center">${t}</h1>`;
const par = t => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${TINTA2};text-align:center">${t}</p>`;

function linhasItens(itens) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px">${(itens || []).map(i => `<tr>
  <td style="padding:11px 0;border-bottom:1px solid ${LINHA};font-size:14px;color:${TINTA}"><b>${esc(i.nome)}</b><br><span style="font-size:12px;color:${TINTA2}">Cód. ${esc(i.cod || '')} · Tam. ${esc(i.tam)} · ${esc(i.q)}x</span></td>
  <td align="right" style="padding:11px 0;border-bottom:1px solid ${LINHA};font-size:14px;color:${TINTA};white-space:nowrap">${brl(i.preco * i.q)}</td></tr>`).join('')}</table>`;
}

/* ---------- 1) Boas-vindas ---------- */
function boasVindas({ nome, codigo }) {
  const url = site();
  const convite = codigo ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;background:${CREME};border:1px dashed ${OURO};border-radius:14px"><tr><td align="center" style="padding:18px">
    <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${OURO_ESC};font-weight:600">Seu código de amigo</div>
    <div style="font-size:28px;letter-spacing:.2em;font-weight:700;color:${TINTA};margin:6px 0 4px">${esc(codigo)}</div>
    <div style="font-size:13px;color:${TINTA2};line-height:1.5">Passe para os amigos: eles ganham <b>10% OFF</b> na primeira compra<br>e você ganha de <b>5% a 20%</b> de desconto conforme eles compram.</div></td></tr></table>` : '';
  const capa = `<tr><td align="center" style="background:linear-gradient(180deg,${ESCURO} 0%,#2a2113 100%);padding:6px 30px 38px">
    <div style="font-size:13px;letter-spacing:.3em;text-transform:uppercase;color:${OURO}">Bem-vindo(a)</div>
    <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:38px;line-height:1.15;color:#fff;margin-top:10px">Agora você faz parte<br>do estilo <span style="color:${OURO}">CLOUTS</span></div></td></tr>`;
  const corpo = `${titulo(`Que bom ter você aqui, ${primeiroNome(nome)}!`)}
    ${par('Sua conta está criada. A CLOUTS é feita de jeans com caimento de verdade, do feminino ao masculino, pensada para quem gosta de peça com identidade. Entregamos em <b>Contagem, Betim e Belo Horizonte</b>.')}
    ${convite}
    ${botao('Ver as novidades', url)}
    ${par('Qualquer dúvida sobre tamanho ou entrega, é só chamar a gente no WhatsApp pela loja.')}`;
  return {
    assunto: `Bem-vindo(a) à CLOUTS, ${String(nome || '').trim().split(/\s+/)[0] || 'cliente'}!`,
    texto: `Bem-vindo(a) à CLOUTS! Sua conta está criada.${codigo ? ' Seu código de amigo: ' + codigo + '.' : ''} Veja as novidades: ${url}`,
    html: layout({ preheader: 'Sua conta está pronta. Veja as novidades e o seu código de amigo.', capa, corpo, rodape: 'Você recebeu este e-mail porque criou uma conta na loja CLOUTS.' })
  };
}

/* ---------- 2) Pedido (recebido / confirmado / enviado / entregue) ---------- */
function pedido({ evento, nome, pedidoId, itens, subtotal, desconto, frete, total, cidade }) {
  const cod = String(pedidoId || '').slice(0, 6).toUpperCase();
  const T = {
    recebido: ['Recebemos o seu pedido', 'Pedido recebido', 'Já anotamos tudo. Assim que o pagamento for confirmado, separamos as suas peças.'],
    confirmado: ['Pagamento confirmado', 'Pagamento confirmado', 'Deu tudo certo! Estamos separando as suas peças com carinho.'],
    enviado: ['Seu pedido saiu para entrega', 'Saiu para entrega', 'Seu pedido está a caminho. Fique de olho no WhatsApp: a nossa entrega combina com você.'],
    entregue: ['Pedido entregue', 'Pedido entregue', 'Esperamos que você ame as peças. Se puder, conta pra gente como ficou!']
  }[evento] || ['Atualização do seu pedido', 'Atualização', ''];
  const capa = `<tr><td align="center" style="background:${ESCURO};padding:0 30px 30px"><div style="font-size:13px;letter-spacing:.3em;text-transform:uppercase;color:${OURO}">Pedido ${esc(cod)}</div>
    <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:32px;line-height:1.2;color:#fff;margin-top:8px">${esc(T[1])}</div></td></tr>`;
  const resumo = (evento === 'recebido' || evento === 'confirmado') ? `${linhasItens(itens)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;font-size:14px;color:${TINTA2}">
    <tr><td style="padding:3px 0">Subtotal</td><td align="right">${brl(subtotal)}</td></tr>
    ${desconto > 0 ? `<tr><td style="padding:3px 0">Desconto</td><td align="right">− ${brl(desconto)}</td></tr>` : ''}
    <tr><td style="padding:3px 0">Frete${cidade ? ' (' + esc(cidade) + ')' : ''}</td><td align="right">${brl(frete)}</td></tr>
    <tr><td style="padding:10px 0 0;font-size:16px;font-weight:700;color:${TINTA}">Total</td><td align="right" style="padding-top:10px;font-size:18px;font-weight:700;color:${TINTA}">${brl(total)}</td></tr></table>` : '';
  const corpo = `${titulo(`${primeiroNome(nome)}, ${esc(T[0].toLowerCase())}!`)}${par(esc(T[2]))}${resumo}${botao('Falar com a CLOUTS', site())}`;
  return {
    assunto: `${T[0]} · CLOUTS #${cod}`,
    texto: `${T[0]}. Pedido ${cod}. ${T[2]}`,
    html: layout({ preheader: T[2], capa, corpo, rodape: 'E-mail sobre o seu pedido na CLOUTS.' })
  };
}

/* ---------- 3) Carrinho abandonado (n = 1 lembrete, 2 última chamada) ---------- */
function carrinho({ nome, itens, n, uid }) {
  const url = site() + '/#/carrinho';
  const t = n === 1
    ? ['Você esqueceu algo no carrinho', 'Percebi que você não finalizou o seu pedido. Precisa de alguma ajuda? Suas peças continuam separadas esperando por você.']
    : ['Suas peças ainda estão aqui', 'Passando para avisar que o seu carrinho segue guardado. O estoque é limitado, então vale finalizar antes que alguém leve a sua peça.'];
  const capa = `<tr><td align="center" style="background:${ESCURO};padding:0 30px 30px"><div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:32px;line-height:1.2;color:#fff">${esc(t[0])}</div></td></tr>`;
  const corpo = `${titulo(`Oi, ${primeiroNome(nome)}!`)}${par(esc(t[1]))}${linhasItens(itens)}${botao('Voltar ao meu carrinho', url)}${par('Dúvida de tamanho, prazo ou entrega? Responda pelo WhatsApp da loja que a gente ajuda.')}`;
  return {
    assunto: n === 1 ? 'Esqueceu algo no carrinho? · CLOUTS' : 'Suas peças ainda estão no carrinho · CLOUTS',
    texto: `${t[1]} Volte ao carrinho: ${url}`,
    html: layout({ preheader: t[1], capa, corpo, rodape: `Você recebeu este lembrete porque deixou itens no carrinho da CLOUTS.<br><a href="${linkSair(uid)}" style="color:${TINTA2}">Parar de receber lembretes</a>` })
  };
}

module.exports = { emailConfigurado, enviar, boasVindas, pedido, carrinho, assinaturaOk, site };
