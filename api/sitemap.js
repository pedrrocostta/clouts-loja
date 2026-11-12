/* GET /sitemap.xml e /robots.txt (reescritos para /api/sitemap e /api/robots). O endereço vem do domínio que está sendo acessado,
 * então continua certo quando você trocar para o domínio próprio. */
const { db } = require('./_lib');

const origem = req => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

module.exports = async (req, res) => {
  const base = origem(req);
  if (req.query.tipo === 'robots') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(200).send(`User-agent: *\nAllow: /\nDisallow: /painel/\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`);
  }
  try {
    const snap = await db().collection('produtos').get();
    const urls = [`${base}/`, `${base}/trocas.html`, `${base}/privacidade.html`, `${base}/termos.html`];
    snap.docs.forEach(d => { if (d.data().visivel !== false && /^[\w.-]{1,80}$/.test(d.id)) urls.push(`${base}/p/${encodeURIComponent(d.id)}`); });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8'); res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${xml(u)}</loc></url>`).join('\n')}\n</urlset>\n`);
  } catch (e) { console.error('sitemap:', e.message); res.status(500).end(); }
};
