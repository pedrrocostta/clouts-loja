/* GET /api/img?id=ID — foto principal da peça como imagem de verdade (para a prévia do link no WhatsApp/Instagram/Google).
 * Fotos antigas ficam dentro do banco (base64); esta rota as entrega como arquivo. Fotos no Cloudinary só redirecionam. */
const { db } = require('./_lib');

module.exports = async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[\w.-]{1,80}$/.test(id)) return res.status(400).end();
  try {
    const s = await db().collection('produtos').doc(id).get();
    const u = s.exists && s.data().visivel !== false ? String(s.data().img || '') : '';
    if (!u) return res.status(404).end();
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(u);
    if (m) {
      res.setHeader('Content-Type', m[1]); res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).send(Buffer.from(m[2], 'base64'));
    }
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.statusCode = 302; res.setHeader('Location', /^https:\/\//.test(u) ? u : '/' + u.replace(/^\//, '')); res.end();
  } catch (e) { console.error('img:', e.message); res.status(500).end(); }
};
