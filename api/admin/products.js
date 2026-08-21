const { requireAdminAuth } = require("../../lib/adminAuth");
const { getAllProducts, setProductActive, updateProduct } = require("../../lib/db");

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

    if (!id) {
      res.status(400).json({ error: "Envie ?id=... na URL." });
      return;
    }

    try {
      if (typeof body?.active === "boolean") {
        await setProductActive(id, body.active);
      }
      if (body?.title !== undefined || body?.price !== undefined) {
        if (body.price !== undefined && (typeof body.price !== "number" || body.price <= 0)) {
          res.status(400).json({ error: "price precisa ser um número maior que zero." });
          return;
        }
        if (body.title !== undefined && !String(body.title).trim()) {
          res.status(400).json({ error: "title não pode ficar vazio." });
          return;
        }
        const saved = await updateProduct(id, { title: body.title, price: body.price });
        res.status(200).json(saved);
        return;
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("admin/products PATCH: falha:", err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).end();
};
