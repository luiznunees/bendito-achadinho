const { requireAdminAuth } = require("../../lib/adminAuth");
const { curateFromUrl, extractShopeeLink } = require("../../lib/curate");

module.exports = async function handler(req, res) {
  if (!requireAdminAuth(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  // Aceita tanto { url } (link limpo, colado no painel) quanto { text }
  // (texto cru compartilhado de outro app, ex: Atalhos do iPhone a partir
  // do "Compartilhar" do app da Shopee) — extrai o link de qualquer um dos dois.
  const raw = (body?.url || body?.text || "").trim();
  const shopeeUrl = extractShopeeLink(raw) || (/^https?:\/\//i.test(raw) ? raw : null);

  if (!shopeeUrl) {
    res.status(400).json({ error: "Não encontrei um link da Shopee no texto enviado." });
    return;
  }

  try {
    const saved = await curateFromUrl(shopeeUrl);
    res.status(200).json(saved);
  } catch (err) {
    console.error("admin/curate: falha:", err);
    res.status(422).json({ error: err.message, code: err.code || "UNKNOWN" });
  }
};
