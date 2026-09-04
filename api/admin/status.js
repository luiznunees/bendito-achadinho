const { requireAdminAuth } = require("../../lib/adminAuth");
const { getAllProducts } = require("../../lib/db");
const { getAllSettings } = require("../../lib/settings");
const { getLogsOfDay, getRecentLogs } = require("../../lib/publish_log");

// Cronograma real da automação (disparada pelo GitHub Actions) em horário
// de Brasília. É a fonte da verdade usada pelo dashboard.
const SCHEDULE = [
  { hour: 8,  type: "greeting", label: "Bom dia",  emoji: "☀️" },
  { hour: 10, type: "products", label: "Produtos", emoji: "🛍️" },
  { hour: 12, type: "products", label: "Produtos", emoji: "🛍️" },
  { hour: 14, type: "products", label: "Produtos", emoji: "🛍️" },
  { hour: 16, type: "products", label: "Produtos", emoji: "🛍️" },
  { hour: 18, type: "products", label: "Produtos", emoji: "🛍️" },
  { hour: 20, type: "products", label: "Produtos", emoji: "🛍️" },
  { hour: 22, type: "products", label: "Produtos", emoji: "🛍️" },
  { hour: 23, type: "greeting", label: "Boa noite", emoji: "🌙" },
];

// Estados exibidos no dashboard para cada status registrado no log.
const STATUS_LABEL = {
  sent: "Enviado",
  no_offers: "Sem ofertas",
  disabled: "Desligado",
  dry_run: "Teste",
  error: "Falhou",
  skipped: "Pulado",
};

function pad(n) { return String(n).padStart(2, "0"); }

module.exports = async function handler(req, res) {
  if (!requireAdminAuth(req, res)) return;
  if (req.method !== "GET") { res.status(405).end(); return; }

  try {
    // ---- Relógio em Brasília ----
    const now = new Date();
    const br = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const todayBR = `${br.getFullYear()}-${pad(br.getMonth() + 1)}-${pad(br.getDate())}`;
    const brHour = br.getHours();
    const brMinute = br.getMinutes();
    const secondsNow = brHour * 3600 + brMinute * 60 + br.getSeconds();

    // ---- Produtos ----
    const products = await getAllProducts();
    const active = products.filter((p) => p.active);
    const totalValue = active.reduce((s, p) => s + p.price, 0);

    // ---- Evolução ----
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

    // ---- Automação (enabled / pausado) ----
    const settings = await getAllSettings();
    const enabled = settings.AUTOPUBLISH_ENABLED !== "false";
    const pausedUntil = settings.AUTOPUBLISH_PAUSED_UNTIL || "";
    let state = "ativo";
    if (!enabled) state = "desligado";
    else if (pausedUntil) {
      const until = new Date(pausedUntil);
      if (Number.isFinite(until.getTime()) && until.getTime() > Date.now()) state = "pausado";
    }

    // ---- Logs de hoje + últimos ----
    let todayLogs = [];
    let recentLogs = [];
    try {
      todayLogs = await getLogsOfDay(todayBR);
      recentLogs = await getRecentLogs(8);
    } catch (err) {
      console.warn("admin/status: tabela auto_publish_log indisponível:", err.message);
    }
    const lastLogBySlot = new Map();
    for (const log of todayLogs) lastLogBySlot.set(`${log.type}:${log.slot_hour}`, log);

    // ---- Grade de hoje ----
    let nextSlot = null;
    const slots = SCHEDULE.map((s) => {
      const log = lastLogBySlot.get(`${s.type}:${s.hour}`) || null;
      const atSeconds = s.hour * 3600;
      const at = `${pad(s.hour)}:00`;

      let status;
      if (log) status = log.status;
      else if (atSeconds <= secondsNow) status = "unregistered";
      else status = "scheduled";

      const isNext = !log && !nextSlot && atSeconds > secondsNow;
      if (isNext) nextSlot = { hour: s.hour, type: s.type, label: s.label, emoji: s.emoji };

      return {
        hour: s.hour,
        at,
        type: s.type,
        label: s.label,
        emoji: s.emoji,
        status,
        statusLabel:
          log ? (STATUS_LABEL[log.status] || log.status) :
          status === "unregistered" ? "Não registrado" : "Agendado",
        isNext,
        isPast: atSeconds <= secondsNow,
        log: log
          ? {
              time: log.created_at,
              detail: log.detail,
              published: log.published_count,
              saved: log.saved_count,
              skipped: log.skipped_count,
              errors: log.error_count,
            }
          : null,
      };
    });

    // ---- Próximo disparo (hoje; se passou tudo, amanhã 08h) ----
    let nextAtSeconds, nextRunInfo;
    if (nextSlot) {
      nextAtSeconds = nextSlot.hour * 3600;
      nextRunInfo = { hour: nextSlot.hour, at: `${pad(nextSlot.hour)}:00`, type: nextSlot.type, label: nextSlot.label, emoji: nextSlot.emoji };
    } else {
      // Todos os slots de hoje passaram -> próximo é amanhã 08h (Bom dia)
      nextAtSeconds = 8 * 3600 + 24 * 3600;
      nextRunInfo = { hour: 8, at: "08:00", type: "greeting", label: "Bom dia", emoji: "☀️", tomorrow: true };
    }
    const countdownSeconds = Math.max(0, nextAtSeconds - secondsNow);

    // ---- Resumo do dia ----
    const dayStats = todayLogs.reduce(
      (acc, l) => {
        acc.runs += 1;
        acc.published += l.published_count || 0;
        acc.saved += l.saved_count || 0;
        acc.errors += l.error_count || 0;
        if (l.status === "sent") acc.sentRuns += 1;
        return acc;
      },
      { runs: 0, published: 0, saved: 0, errors: 0, sentRuns: 0 }
    );

    const bomDia = slots.find((s) => s.hour === 8);
    const boaNoite = slots.find((s) => s.hour === 23);

    res.status(200).json({
      now: now.toISOString(),
      timezone: "America/Sao_Paulo",
      today: todayBR,
      brHour,
      brMinute,
      automation: { enabled, pausedUntil: pausedUntil || null, state },
      evolution: { instance: process.env.EVOLUTION_INSTANCE_NAME || "?", status: evolutionStatus },
      products: { total: products.length, active: active.length, removed: products.length - active.length, totalValue },
      schedule: { slots },
      nextRun: { ...nextRunInfo, countdownSeconds },
      greetings: {
        bomDia: { at: "08:00", status: bomDia.status, statusLabel: bomDia.statusLabel, sent: bomDia.status === "sent" },
        boaNoite: { at: "23:00", status: boaNoite.status, statusLabel: boaNoite.statusLabel, sent: boaNoite.status === "sent" },
      },
      todayStats: dayStats,
      slotsToday: { scheduled: slots.filter((s) => s.status === "scheduled").length, done: slots.filter((s) => s.status !== "scheduled" && s.status !== "unregistered").length },
      recentLogs: recentLogs.map((l) => ({
        id: l.id,
        runDate: l.run_date,
        hour: l.slot_hour,
        type: l.type,
        status: l.status,
        statusLabel: STATUS_LABEL[l.status] || l.status,
        detail: l.detail,
        published: l.published_count,
        saved: l.saved_count,
        skipped: l.skipped_count,
        errors: l.error_count,
        time: l.created_at,
      })),
    });
  } catch (err) {
    console.error("admin/status: erro:", err);
    res.status(500).json({ error: err.message });
  }
};