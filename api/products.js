const { getActiveProducts } = require("../lib/db");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  try {
    const products = await getActiveProducts();
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(products);
  } catch (err) {
    console.error("GET /api/products failed:", err);
    // Sem banco configurado ainda (ou erro transitório): devolve lista vazia
    // em vez de 500, pra o site cair no fallback local em js/app.js.
    res.status(200).json([]);
  }
};
