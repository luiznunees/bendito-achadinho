const { requireAdminAuth } = require("../../lib/adminAuth");
const { curateFromUrl } = require("../../lib/curate");

module.exports = async function handler(req, res) {
  if (!requireAdminAuth(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const url = (body?.url || "").trim();

  if (!url) {
    res.status(400).json({ error: "Envie { url } no corpo da requisição." });
    return;
  }

  try {
    const saved = await curateFromUrl(url);
    res.status(200).json(saved);
  } catch (err) {
    console.error("admin/curate: falha:", err);
    res.status(422).json({ error: err.message, code: err.code || "UNKNOWN" });
  }
};
