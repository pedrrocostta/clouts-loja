/* POST /api/email — dispara e-mails da loja. Sempre exige o token de login do Firebase (Authorization: Bearer ...).
 * { acao: 'boasvindas' }                              → boas-vindas (uma única vez por cliente)
 * { acao: 'carrinho', itens: [{id,q,tam}] }           → guarda o carrinho para o lembrete (vazio = limpa)
 * { acao: 'pedido', pedidoId }                        → "recebemos o seu pedido" (só o dono do pedido)
 * { acao: 'andamento', pedidoId, evento }             → confirmado | enviado | entregue (só o administrador) */
const { admin, db, usuario, erro, responder } = require('./_lib');
const { emailConfigurado, enviar, boasVindas, pedido } = require('./_mail');

const numCfg = (v, d, max) => Math.min(max, Number(v) > 0 ? Number(v) : d);

const ADMIN = 'clouts.oficial2026@gmail.com';
const ehAdmin = u => u && u.email === ADMIN && u.email_verified === true && u.firebase?.sign_in_provider === 'google.com';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  if (!emailConfigurado()) return res.status(503).json({ erro: 'E-mail ainda não configurado.' });
  try {
    const u = await usuario(req);
    if (!u) throw erro(401, 'Entre na sua conta.');
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const fs = db(), FV = admin.firestore.FieldValue;

    if (b.acao === 'boasvindas') {
      if (!u.email) return res.status(200).json({ ok: true });
      const ref = fs.collection('users').doc(u.uid).collection('meta').doc('email');
      const novo = await fs.runTransaction(async t => { const s = await t.get(ref); if (s.exists && s.data().boasVindasEm) return false; t.set(ref, { boasVindasEm: FV.serverTimestamp() }, { merge: true }); return true; });
      if (novo) {
        const cfg = (await fs.collection('config').doc('loja').get()).data() || {};
        const cupom = cfg.cupomPrimeira === false ? null : { percent: numCfg(cfg.primeiraPct, 10, 50), dias: numCfg(cfg.primeiraDias, 7, 30) };
        try {
          await enviar({ para: u.email, ...boasVindas({ nome: u.name, cupom }) });
          if (cupom) await fs.collection('primeira').doc(u.uid).set({ uid: u.uid, email: u.email, nome: u.name || '', criadoEm: FV.serverTimestamp(), lembrete: false });   // para o lembrete de 3 dias
        }
        catch (e) { await ref.set({ boasVindasEm: FV.delete() }, { merge: true }); throw e; }   // falhou: permite tentar de novo no próximo login
      }
      return res.status(200).json({ ok: true });
    }

    if (b.acao === 'carrinho') {
      const ref = fs.collection('carrinhos').doc(u.uid);
      const ult = await ref.get();
      if (ult.exists && Date.now() - (ult.data().atualizadoEm?.toMillis?.() || 0) < 8000) return res.status(200).json({ ok: true });   // freio: evita enxurrada de gravações
      const itens = Array.isArray(b.itens) ? b.itens.slice(0, 40) : [];
      if (!itens.length || !u.email) { await ref.delete(); return res.status(200).json({ ok: true }); }
      const linhas = [];
      for (const it of itens) {
        const id = String(it?.id || ''), q = Number(it?.q);
        if (!/^[\w.-]{1,80}$/.test(id) || !Number.isInteger(q) || q < 1 || q > 20) continue;
        const s = await fs.collection('produtos').doc(id).get();
        if (!s.exists || s.data().visivel === false) continue;
        const p = s.data(); linhas.push({ id, cod: p.cod, nome: p.nome, tam: String(it.tam || '').slice(0, 6), q, preco: Number(p.preco) || 0 });
      }
      if (!linhas.length) { await ref.delete(); return res.status(200).json({ ok: true }); }
      const ant = ult;
      if (ant.exists && JSON.stringify(ant.data().itens) === JSON.stringify(linhas)) return res.status(200).json({ ok: true });   // igual: não reinicia a contagem de horas
      await ref.set({ uid: u.uid, email: u.email, nome: u.name || '', itens: linhas, atualizadoEm: FV.serverTimestamp(), enviados: 0 });
      return res.status(200).json({ ok: true });
    }

    if (b.acao === 'pedido' || b.acao === 'andamento') {
      const id = String(b.pedidoId || '');
      if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw erro(400, 'Pedido inválido.');
      const ref = fs.collection('pedidos').doc(id), s = await ref.get();
      if (!s.exists) throw erro(404, 'Pedido não encontrado.');
      const o = s.data();
      let evento = 'recebido';
      if (b.acao === 'pedido') { if (o.uid !== u.uid) throw erro(403, 'Pedido de outra conta.'); }
      else {
        if (!ehAdmin(u)) throw erro(403, 'Somente o administrador.');
        evento = String(b.evento);
        if (!['confirmado', 'enviado', 'entregue'].includes(evento)) throw erro(400, 'Evento inválido.');
        if (evento === 'confirmado' && o.status !== 'pago') throw erro(409, 'O pedido ainda não está pago.');
      }
      // Destinatário confiável: o e-mail da conta Google (token) do dono do pedido, nunca o texto gravado no pedido (que o cliente poderia ter digitado).
      let para = null;
      if (b.acao === 'pedido') para = u.email || null;
      else { try { para = (await admin.auth().getUser(o.uid)).email || null; } catch { para = null; } }
      if (!para) return res.status(200).json({ ok: true });
      const marca = `emails.${evento}`;
      const ok = await fs.runTransaction(async t => { const x = await t.get(ref); if (x.get(marca)) return false; t.update(ref, { [marca]: FV.serverTimestamp() }); return true; });
      if (ok) {
        try { await enviar({ para, ...pedido({ evento, nome: o.cliente?.nome, pedidoId: id, itens: o.itens, subtotal: o.subtotal, desconto: o.desconto, frete: o.frete, total: o.total, cidade: o.cidade }) }); }
        catch (e) { await ref.update({ [marca]: FV.delete() }); throw e; }
      }
      return res.status(200).json({ ok: true });
    }
    throw erro(400, 'Ação inválida.');
  } catch (e) { responder(res, e); }
};
