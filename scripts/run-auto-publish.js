// ============================================================
// Runner do pipeline de auto-publish para rodar FORA da Vercel.
//
// POR QUE EXISTE:
// O plano Free (Hobby) da Vercel limita funções serverless a 10s
// de execução — o pipeline (busca ~30 keywords + Gemini + envio)
// estoura esse limite. Este script roda a MESMA lógica
// (lib/auto_publish.js) em qualquer ambiente sem limite de tempo:
// GitHub Actions, cron de VPS, laptop, etc.
//
// Uso:
//   node scripts/run-auto-publish.js auto        (modo padrão do cron)
//   node scripts/run-auto-publish.js products    (força uma execução agora)
//   node scripts/run-auto-publish.js greeting 8  (força saudação)
//   node scripts/run-auto-publish.js greeting 23
//
// O modo "auto" decide sozinho o que fazer neste minuto com base nas
// configurações do painel (tabela settings):
//   - 08:00 BRT            -> bom dia
//   - 23:00 BRT            -> boa noite
//   - horário de disparo   -> publica 1 oferta espaçada
//   - qualquer outro       -> não faz nada (cron roda a cada 5 min)
//
// Precisa das variáveis de ambiente (supabase, shopee, gemini,
// evolution, group). Ex.: node --env-file=.env.local scripts/run-auto-publish.js auto
// ============================================================

const { runAutoPublish, runGreeting, loadPipelineSettings, cfg } = require("../lib/auto_publish");
const { computeDispatchTimes, isDispatchTime, nowBRTMinutes, todayBRT, minsToHHMM } = require("../lib/schedule");
const { getLogsOfDay, getRecentLogs } = require("../lib/publish_log");

const type = (process.argv[2] || "auto").toLowerCase();

// Houve execução real recente? Evita duplicar quando a rede de segurança
// (cron 5 min) chega logo depois do job de janela.
async function hasRecentRun(typeName, minutesBack = 8) {
  try {
    const logs = await getRecentLogs(8);
    const cutoff = Date.now() - minutesBack * 60000;
    return logs.some(
      (l) =>
        l.type === typeName &&
        ["sent", "dry_run", "no_offers"].includes(l.status) &&
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

async function runAuto() {
  await loadPipelineSettings();

  const enabled = cfg("AUTOPUBLISH_ENABLED", "true").toLowerCase() !== "false";
  const now = nowBRTMinutes();

  // Saudações têm prioridade nos minutos exatos (08:00 e 23:00).
  if (now === 8 * 60) {
    if (await hasRecentRun("greeting", 12)) return { action: "greeting_already_sent" };
    return await runGreeting(8);
  }
  if (now === 23 * 60) {
    if (await hasRecentRun("greeting", 12)) return { action: "greeting_already_sent" };
    return await runGreeting(23);
  }

  if (!enabled) {
    console.log("auto: automação desligada no painel.");
    return { action: "disabled" };
  }

  const dispatch = computeDispatchTimes(cfg);
  if (!isDispatchTime(dispatch, now)) {
    console.log(`auto: ${minsToHHMM(now)} BRT fora do agendamento (próximo às ${minsToHHMM(dispatch.times.find((t) => t > now) || dispatch.times[0] || 0)}).`);
    return { action: "idle" };
  }

  // Rede de segurança: se o job de janela já fez o disparo deste minuto, não duplica.
  if (await hasRecentRun("products", 6)) {
    console.log("auto: disparo deste minuto já registrado (job de janela).");
    return { action: "already_sent" };
  }

  // Se o modo for meta diária, respeita o limite de ofertas no dia.
  if (dispatch.spacingMode === "daily_target") {
    const target = Math.max(1, Math.round(Number(cfg("AUTOPUBLISH_DAILY_TARGET", "15")) || 15));
    const sent = await sentTodayCount();
    if (sent >= target) {
      console.log(`auto: meta diária atingida (${sent}/${target}).`);
      return { action: "target_reached", sent };
    }
  }

  const result = await runAutoPublish({ maxOffers: 1 });
  console.log("auto: oferta espaçada", JSON.stringify(result));
  return { action: "published", ...result };
}

async function main() {
  if (type === "greeting") {
    const hour = parseInt(process.argv[3] || "8", 10);
    const result = await runGreeting(hour);
    console.log("greeting:", JSON.stringify(result));
    return;
  }

  if (type === "auto") {
    const result = await runAuto();
    console.log("auto:", JSON.stringify(result));
    if (result.disabled) process.exitCode = 1;
    return;
  }

  const result = await runAutoPublish();
  console.log("products:", JSON.stringify(result));
  if (result.disabled) process.exitCode = 1;
}

main().catch((err) => {
  console.error("ERRO no auto-publish:", err.message);
  process.exit(1);
});