// ============================================================
// Vercel Function: dispara a automação de publicação automática.
//
// Pode ser chamada:
//  1. Por Vercel Cron (automaticamente, em horários configurados
//     no vercel.json).
//  2. Manualmente: GET/POST /api/auto-publish?token=AUTOPUBLISH_TOKEN
//
// Tipos de chamada (via query ?type=):
//  - products (default): busca e publica ofertas no grupo
//  - greeting: envia mensagem de bom dia/boa noite
//
// Protegida por token — sem o AUTOPUBLISH_TOKEN correto, 401.
// ============================================================

const { runAutoPublish, runGreeting } = require("../lib/auto_publish");

function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const expected = process.env.AUTOPUBLISH_TOKEN;
  const isVercelCron = req.headers["x-vercel-cron"] === "1";
  const provided = req.query.token
    || req.headers["x-autopublish-token"]
    || req.headers["authorization"]?.replace(/^Bearer\s+/i, "")
    || "";

  if (!isVercelCron && (!expected || !timingSafeEqualStr(provided, expected))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const type = (req.query.type || "products").toLowerCase();

  try {
    if (type === "greeting") {
      const hour = parseInt(req.query.hour || "8", 10);
      const result = await runGreeting(hour);
      res.status(200).json({ ok: true, type: "greeting", ...result });
    } else {
      const summary = await runAutoPublish();
      res.status(200).json({ ok: true, type: "products", ...summary });
    }
  } catch (err) {
    console.error("auto-publish API failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
