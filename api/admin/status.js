const { requireAdminAuth } = require("../../lib/adminAuth");
const { getAllProducts } = require("../../lib/db");
const { getAllSettings } = require("../../lib/settings");

module.exports = async function handler(req, res) {
  if (!requireAdminAuth(req, res)) return;
  if (req.method !== "GET") { res.status(405).end(); return; }

  try {
    // 1) Produtos
    const products = await getAllProducts();
    const active = products.filter(p => p.active);
    const totalValue = active.reduce((s, p) => s + p.price, 0);

    // 2) Evolution API - status da instância
    let evolutionStatus = "desconhecido";
    try {
      const baseUrl = process.env.EVOLUTION_API_URL;
      const instance = process.env.EVOLUTION_INSTANCE_NAME;
      const token = process.env.EVOLUTION_INSTANCE_TOKEN;
      if (baseUrl && instance && token) {
        const r = await fetch(`${baseUrl.replace(/\/$/, "")}/instance/connectionState/${instance}`, {
          headers: { apikey: token },
          signal: AbortSignal.timeout(5000),
        });
        const j = await r.json();
        evolutionStatus = j?.instance?.connectionStatus || j?.instance?.state || "desconhecido";
      }
    } catch { evolutionStatus = "erro ao verificar"; }

    // 3) Próximos crons (horário de Brasília)
    const now = new Date();
    const brNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const h = brNow.getHours();
    const cronHours = [8, 10, 12, 14, 16, 18, 20, 22, 23];
    const nextCron = cronHours.find(ch => ch > h) || cronHours[0];
    const isGreeting = nextCron === 8 || nextCron === 23;

    // 4) Estado da automação
    const settings = await getAllSettings();
    const enabled = settings.AUTOPUBLISH_ENABLED !== "false";
    const pausedUntil = settings.AUTOPUBLISH_PAUSED_UNTIL || "";
    let state = "ativo";
    if (!enabled) state = "desligado";
    else if (pausedUntil) {
      const until = new Date(pausedUntil);
      if (Number.isFinite(until.getTime()) && until.getTime() > Date.now()) {
        state = "pausado";
      }
    }

    res.status(200).json({
      products: { total: products.length, active: active.length, removed: products.length - active.length, totalValue },
      evolution: { instance: process.env.EVOLUTION_INSTANCE_NAME || "?", status: evolutionStatus },
      schedule: { nextHour: nextCron, nextType: isGreeting ? "saudação" : "produtos", timezone: "America/Sao_Paulo" },
      automation: { enabled, pausedUntil: pausedUntil || null, state },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
