const { requireAdminAuth } = require("../../lib/adminAuth");
const { getAllProducts, setProductActive } = require("../../lib/db");

module.exports = async function handler(req, res) {
  if (!requireAdminAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      const products = await getAllProducts();
      res.status(200).json(products);
    } catch (err) {
      console.error("admin/products GET: falha:", err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!id || typeof body?.active !== "boolean") {
      res.status(400).json({ error: "Envie ?id=... e { active: true|false } no corpo." });
      return;
    }
    try {
      await setProductActive(id, body.active);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("admin/products PATCH: falha:", err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).end();
};
