/* GET /p/:id (reescrito para /api/p?id=:id) — página própria de cada peça para Google, WhatsApp e Instagram.
 * Entrega o mesmo site (index.html), mas com título, descrição, imagem de compartilhamento (Open Graph) e dados de produto (schema.org) da peça.
 * O navegador do cliente abre a peça normalmente (app.js lê o endereço /p/ID). */
const fs = require('fs'), path = require('path');
const { db } = require('./_lib');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let html = null;
// A página inicial já traz tags de compartilhamento da loja; nas peças elas são trocadas pelas da peça.
const modelo = () => html ??= fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8')
  .replace(/<meta (?:property="og:|name="twitter:)[^>]*>\s*/g, '').replace(/<link rel="canonical"[^>]*>\s*/g, '').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '');
const origem = req => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

function imagem(p, base) {
  const u = String(p.img || '');
  if (/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/v?\d/.test(u)) return u.replace('/image/upload/', '/image/upload/f_jpg,q_auto,w_1200,c_limit/');
  if (/^https:\/\//.test(u)) return u;
  if (u.startsWith('data:')) return `${base}/api/img?id=${encodeURIComponent(p.id)}`;
  return `${base}/${u.replace(/^\//, '')}`;
}

module.exports = async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[\w.-]{1,80}$/.test(id)) { res.statusCode = 302; res.setHeader('Location', '/'); return res.end(); }
  try {
    const s = await db().collection('produtos').doc(id).get();
    const p = s.exists ? { id, ...s.data() } : null;
    if (!p || p.visivel === false) { res.statusCode = 302; res.setHeader('Location', '/'); return res.end(); }
    const base = origem(req), url = `${base}/p/${encodeURIComponent(id)}`, img = imagem(p, base);
    const sec = p.secao === 'masculino' ? 'masculino' : 'feminino';
    const preco = Number(p.preco) > 0 ? Number(p.preco) : 0, esg = p.esgotado === true || !(p.tam || []).length;
    const titulo = `${p.nome} — CLOUTS`;
    const desc = (p.descricao || `${p.nome}. ${sec === 'masculino' ? 'Masculino' : 'Feminino'} ${p.modelo || ''}`.trim() + '. Entrega em Contagem, Betim e Belo Horizonte.').slice(0, 300);
    const ld = {
      '@context': 'https://schema.org', '@type': 'Product', name: p.nome, sku: String(p.cod), image: [img], description: desc,
      brand: { '@type': 'Brand', name: 'CLOUTS' }, ...(p.cor ? { color: p.cor } : {}),
      ...(preco ? { offers: { '@type': 'Offer', url, priceCurrency: 'BRL', price: preco.toFixed(2), availability: esg ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition' } } : {})
    };
    const head = `<base href="/">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product"><meta property="og:site_name" content="CLOUTS"><meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(titulo)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(img)}">
${preco ? `<meta property="product:price:amount" content="${preco.toFixed(2)}"><meta property="product:price:currency" content="BRL">` : ''}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(titulo)}"><meta name="twitter:image" content="${esc(img)}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
    const corpo = `<main id="app"><article><h1>${esc(p.nome)}</h1><p>${esc(desc)}</p>${preco ? `<p>R$ ${preco.toFixed(2).replace('.', ',')}</p>` : ''}</article></main>`;
    const out = modelo()
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(titulo)}</title>`)
      .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(desc)}">`)
      .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${head}`)
      .replace('<main id="app"></main>', corpo);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(out);
  } catch (e) { console.error('p:', e.message); res.statusCode = 302; res.setHeader('Location', '/'); res.end(); }
};
