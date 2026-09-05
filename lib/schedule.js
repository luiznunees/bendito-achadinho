// ============================================================
// Cronograma de disparos espaçados (substitui os slots fixos).
//
// Dois modos de espaçamento:
//   interval    : dispara 1 oferta a cada AUTOPUBLISH_INTERVAL_MINUTES,
//                 entre AUTOPUBLISH_START_TIME e AUTOPUBLISH_END_TIME (BRT).
//   daily_target: o usuário define AUTOPUBLISH_DAILY_TARGET (ex. 20 ofertas
//                 por dia) e o sistema calcula o intervalo que distribui
//                 essa quantidade dentro da janela determinada.
//
// Os GETTERS recebem uma função cfg(nome, fallback) para ler a config na
// mesma fonte do pipeline (tabela settings + env). O painel e o runner
// compartilham este módulo — por isso os horários mostrados no dashboard
// são sempre os mesmos que o GitHub Actions vai usar.
// ============================================================

function brtDate(date = new Date()) {
  return new Date(date.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function todayBRT(date = new Date()) {
  return brtDate(date).toISOString().slice(0, 10);
}

// Minutos do dia em Brasília (0..1439).
function nowBRTMinutes(date = new Date()) {
  const d = brtDate(date);
  return d.getHours() * 60 + d.getMinutes();
}

function minsToHHMM(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function hhmmToMins(hhmm) {
  if (typeof hhmm !== "string") return 60 * 9;
  const parts = hhmm.trim().split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 60 * 9;
  // "24:00" marca o fim do dia (1440), usado nas janelas do workflow.
  return (h === 24 ? 1440 : (h % 24) * 60) + (m % 60);
}

function numVal(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Calcula os minutos de disparo do dia.
function computeDispatchTimes(cfg) {
  const spacingMode = String(cfg("AUTOPUBLISH_SPACING_MODE", "interval")).toLowerCase();
  const start = hhmmToMins(cfg("AUTOPUBLISH_START_TIME", "08:00"));
  const end = hhmmToMins(cfg("AUTOPUBLISH_END_TIME", "23:00"));

  let interval;
  if (spacingMode === "daily_target") {
    const target = Math.max(1, Math.round(numVal(cfg("AUTOPUBLISH_DAILY_TARGET", "15"), 15)));
    const span = end - start;
    const raw = span > 0 && target > 1 ? span / (target - 1) : 60;
    interval = Math.max(5, Math.round(raw / 5) * 5);
  } else {
    interval = Math.max(5, Math.round(numVal(cfg("AUTOPUBLISH_INTERVAL_MINUTES", "15"), 15)));
  }

  const times = [];
  if (end > start) {
    for (let t = start; t <= end; t += interval) times.push(t);
  } else if (end === start) {
    times.push(start);
  } else {
    // janela da meia-noite: vai até 24h e continua do 0 até o fim
    for (let t = start; t < 1440; t += interval) times.push(t);
    for (let t = 0; t <= end; t += interval) times.push(t);
  }

  return {
    times,
    interval,
    start: minsToHHMM(start),
    end: minsToHHMM(end),
    spacingMode,
    numDispatches: times.length,
  };
}

// O minuto atual (BRT) coincide com algum disparo (tolerância p/ atraso do cron)?
function isDispatchTime(dispatch, now, toleranceMin = 2) {
  return dispatch.times.some((t) => Math.abs(now - t) <= toleranceMin);
}

module.exports = { brtDate, todayBRT, nowBRTMinutes, minsToHHMM, hhmmToMins, computeDispatchTimes, isDispatchTime };