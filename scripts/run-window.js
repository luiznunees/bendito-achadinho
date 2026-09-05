// ============================================================
// Runner de JANELA — roda contínuo dentro do GitHub Actions.
//
// PROBLEMA: o cron do GitHub ("schedule") atrasa/descarta eventos
// sob fila (na prática não dispara a cada 5 min). Para disparos
// espaçados precisos, este script roda DURANTE a janela inteira:
// fica de pé, espera chegar o minuto de cada disparo e executa
// na hora certa — sem depender do cron.
//
// Uso (pelo workflow):
//   node scripts/run-window.js 06:00 12:00   (janela BRT)
//
// O workflow inicia uma janela por job (máx. 6h por job no GitHub
// público). Dentro da janela:
//   - 08:00 BRT → saudação bom dia
//   - 23:00 BRT → saudação boa noite
//   - cada horário de disparo espaçado → 1 oferta
// A cada tick (30s) a configuração é relida do Supabase — mudanças
// feitas no painel valem no próximo minuto, sem deploy.
// ============================================================

const { runAutoPublish, runGreeting, loadPipelineSettings, cfg } = require("../lib/auto_publish");
const { computeDispatchTimes, nowBRTMinutes, todayBRT, hhmmToMins, minsToHHMM } = require("../lib/schedule");
const { getLogsOfDay, getRecentLogs } = require("../lib/publish_log");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Houve execução real recente? Evita disparos duplicados quando a rede
// de segurança (cron de 5 min) roda na mesma janela que o job longo.
async function hasRecentRun(type, minutesBack = 8) {
  try {
    const logs = await getRecentLogs(8);
    const cutoff = Date.now() - minutesBack * 60000;
    return logs.some(
      (l) =>
        l.type === type &&
        ["sent", "dry_run", "no_offers", "in_progress"].includes(l.status) &&
        new Date(l.created_at).getTime() > cutoff
    );
  } catch {
    return false;
  }
}

// Quantas ofertas já foram publicadas hoje (para respeitar a meta diária).
async function sentTodayCount() {
  try {
    const logs = await getLogsOfDay(todayBRT());
    return logs
      .filter((l) => l.type === "products" && l.status === "sent")
      .reduce((s, l) => s + (l.published_count || 0), 0);
  } catch {
    return 0;
  }
}

// Executa o que deve acontecer exatamente no minuto `minutes` (BRT).
async function fireAt(minutes) {
  await loadPipelineSettings();

  if (minutes === 8 * 60 || minutes === 23 * 60) {
    if (await hasRecentRun("greeting", 12)) return "greeting_already_sent";
    const hour = minutes === 8 * 60 ? 8 : 23;
    console.log(`janela: saudação ${hour}h`);
    return await runGreeting(hour);
  }

  if (await hasRecentRun("products", 6)) return "already_sent";

  const dispatch = computeDispatchTimes(cfg);
  if (dispatch.spacingMode === "daily_target") {
    const target = Math.max(1, Math.round(Number(cfg("AUTOPUBLISH_DAILY_TARGET", "15")) || 15));
    const sent = await sentTodayCount();
    if (sent >= target) {
      console.log(`janela: meta diária atingida (${sent}/${target}).`);
      return "target_reached";
    }
  }

  console.log(`janela: disparo de oferta ${minsToHHMM(minutes)} BRT`);
  return await runAutoPublish({ maxOffers: 1 });
}

async function main() {
  const start = hhmmToMins(process.argv[2] || "06:00");
  const end = hhmmToMins(process.argv[3] || "12:00");
  console.log(`janela: ${minsToHHMM(start)} → ${minsToHHMM(end)} (BRT)`);

  await loadPipelineSettings();
  let lastFiredMin = -1;

  while (true) {
    await loadPipelineSettings();
    const now = nowBRTMinutes();

    // O job cobre [start, end). Encerra se a janela acabou ou se o
    // horário configurado do dia já passou.
    const configuredEnd = hhmmToMins(computeDispatchTimes(cfg).end);
    if (now >= end || now > configuredEnd) {
      console.log(`janela encerrada em ${minsToHHMM(now)} BRT (fim da janela/job).`);
      break;
    }

    // Alvos dentro desta janela: saudações fixas + disparos espaçados.
    const candidates = [];
    if (end > 8 * 60) candidates.push(8 * 60);
    if (end > 23 * 60) candidates.push(23 * 60);
    for (const t of computeDispatchTimes(cfg).times) {
      if (t >= start && t < end) candidates.push(t);
    }
    const upcoming = [...new Set(candidates)].filter((t) => t >= now).sort((a, b) => a - b);
    const chosen = upcoming[0];

    if (chosen !== undefined && chosen === now && chosen !== lastFiredMin) {
      try {
        const result = await fireAt(chosen);
        console.log("janela:", JSON.stringify(result));
      } catch (err) {
        console.error("janela: erro no disparo:", err.message);
      }
      lastFiredMin = chosen;
    }

    // Tick curto para pegar mudanças de configuração com rapidez.
    await sleep(chosen !== undefined ? 30 * 1000 : 60 * 1000);
  }
}

main().catch((err) => {
  console.error("ERRO na janela:", err.message);
  process.exit(1);
});