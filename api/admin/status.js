const { requireAdminAuth } = require("../../lib/adminAuth");
const { getAllProducts } = require("../../lib/db");
const { getAllSettings } = require("../../lib/settings");
const { getLogsOfDay, getRecentLogs } = require("../../lib/publish_log");
const { getDayPlan } = require("../../lib/plan");
const { computeDispatchTimes, minsToHHMM } = require("../../lib/schedule");

// Estados exibidos no dashboard para cada status registrado no log.
const STATUS_LABEL = {
  sent: "Enviado",
  no_offers: "Sem ofertas",
  disabled: "Desligado",
  dry_run: "Teste",
  error: "Falhou",
  skipped: "Pulado",
  in_progress: "Executando",
};

const GREETING_SLOTS = [
  { hour: 8, type: "greeting", label: "Bom dia", emoji: "☀️" },
  { hour: 23, type: "greeting", label: "Boa noite", emoji: "🌙" },
];

function pad(n) { return String(n).padStart(2, "0"); }

// Lê os valores de uma config (settings + env) e vira um getter simples,
// para o computeDispatchTimes funcionar igual ao runner.
function settingsGetter(settings) {
  return (name, fallback) => {
    const v = settings[name];
    if (v === undefined || v === null || String(v).trim() === "") return fallback;
    return v;
  };
}

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
    const minsNow = brHour * 60 + brMinute;
    const secondsNow = minsNow * 60 + br.getSeconds();

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

    // ---- Configuração de espaçamento (fonte da verdade do dashboard) ----
    const dispatch = computeDispatchTimes(settingsGetter(settings));
    const dailyTarget =
      dispatch.spacingMode === "daily_target"
        ? Math.max(1, Math.round(Number(settings.AUTOPUBLISH_DAILY_TARGET || 1) || 1))
        : null;

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
    for (const log of todayLogs) {
      // Saudação casa pelo horário cheio (slot_hour); produto casa pelo
      // minuto real da execução em BRT (UTC-3 fixo), próximo ao do disparo.
      if (log.type === "greeting") {
        lastLogBySlot.set(`greeting:${log.slot_hour}`, log);
      } else {
        const utcMin = new Date(log.created_at).getUTCHours() * 60 + new Date(log.created_at).getUTCMinutes();
        const brtMin = (utcMin - 180 + 1440) % 1440;
        lastLogBySlot.set(`products:${brtMin}`, log);
      }
    }

    const logAt = (type, hour, minutes) => {
      if (type === "greeting") return lastLogBySlot.get(`greeting:${hour}`) || null;
      const want = hour * 60 + minutes;
      // tolerância de ±3 min (o cron pode disparar um pouco depois do horário)
      for (const [key, log] of lastLogBySlot.entries()) {
        if (!key.startsWith("products:")) continue;
        const t = Number(key.split(":")[1]);
        if (Math.abs(t - want) <= 3) return log;
      }
      return null;
    };

    const buildSlot = (type, hour, minutes, label, emoji) => {
      const log = logAt(type, hour, minutes);
      const atSeconds = (hour * 60 + minutes) * 60;

      let status;
      if (log) status = log.status;
      else if (atSeconds <= secondsNow) status = "unregistered";
      else status = "scheduled";

return {
        at: minsToHHMM(hour * 60 + minutes),
        hour,
        minute: minutes,
        type,
        label,
        emoji,
        status,
        statusLabel:
          log ? (STATUS_LABEL[log.status] || log.status) :
          status === "unregistered" ? "Não registrado" : "Agendado",
        isNext: false,
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
    };

    // ---- Grade de hoje: saudações + disparos espaçados ----
    const greetingSlots = GREETING_SLOTS.map((g) =>
      buildSlot(g.type, g.hour, 0, g.label, g.emoji)
    );
    const productSlots = dispatch.times.map((minutes) =>
      buildSlot("products", Math.floor(minutes / 60), minutes % 60, "Oferta", "🛍️")
    );
    const allSlots = [...greetingSlots, ...productSlots].sort((a, b) => {
      const am = a.hour * 60 + a.minute;
      const bm = b.hour * 60 + b.minute;
      return am - bm;
    });

    // ---- Próximo disparo (hoje; se passou tudo, amanhã 08h) ----
    let nextSlot = allSlots.find(
      (s) => !s.log && (s.hour * 60 + s.minute) * 60 > secondsNow
    );
    let nextRunInfo, nextAtSeconds;
    if (nextSlot) {
      nextSlot.isNext = true;
      nextAtSeconds = (nextSlot.hour * 60 + nextSlot.minute) * 60;
      nextRunInfo = { at: nextSlot.at, minute: nextSlot.minute, type: nextSlot.type, label: nextSlot.label, emoji: nextSlot.emoji };
    } else {
      nextAtSeconds = (8 * 60) * 60 + 24 * 3600;
      nextRunInfo = { at: "08:00", minute: 0, type: "greeting", label: "Bom dia", emoji: "☀️", tomorrow: true };
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

    const bomDia = allSlots.find((s) => s.type === "greeting" && s.hour === 8);
    const boaNoite = allSlots.find((s) => s.type === "greeting" && s.hour === 23);

    // ---- Plano do dia (ofertas já selecionadas para hoje) ----
    let planInfo = { count: null, items: [] };
    try {
      const plan = await getDayPlan(todayBR);
      planInfo = plan
        ? {
            count: plan.length,
            items: plan.slice(0, 90).map((o, i) => {
              const atMin = dispatch.times[i] ?? -1;
              return {
                name: String(o.productName || o.title || "Achadinho").slice(0, 90),
                price: Number(o.priceMin ?? o.priceMax ?? 0),
                discount: Number(o.priceDiscountRate ?? 0),
                image: o.imageUrl || "",
                category: o.category || "",
                at: atMin >= 0 ? minsToHHMM(atMin) : "",
                atMin,
                past: atMin >= 0 && atMin * 60 <= secondsNow,
              };
            }),
          }
        : { count: null, items: [] };
    } catch {
      planInfo = { count: null, items: [] };
    }

    res.status(200).json({
      now: now.toISOString(),
      timezone: "America/Sao_Paulo",
      today: todayBR,
      brHour,
      brMinute,
      spacing: {
        mode: dispatch.spacingMode,
        intervalMinutes: dispatch.interval,
        start: dispatch.start,
        end: dispatch.end,
        dailyTarget,
        numDispatches: dispatch.numDispatches,
      },
      automation: { enabled, pausedUntil: pausedUntil || null, state },
      evolution: { instance: process.env.EVOLUTION_INSTANCE_NAME || "?", status: evolutionStatus },
      products: { total: products.length, active: active.length, removed: products.length - active.length, totalValue },
      schedule: { slots: allSlots },
      nextRun: { ...nextRunInfo, countdownSeconds },
      greetings: {
        bomDia: { at: "08:00", status: bomDia.status, statusLabel: bomDia.statusLabel, sent: bomDia.status === "sent" },
        boaNoite: { at: "23:00", status: boaNoite.status, statusLabel: boaNoite.statusLabel, sent: boaNoite.status === "sent" },
      },
      todayStats: { ...dayStats, target: dailyTarget },
      plan: planInfo,
      slotsToday: { scheduled: allSlots.filter((s) => s.status === "scheduled").length, done: allSlots.filter((s) => s.status !== "scheduled" && s.status !== "unregistered").length },
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