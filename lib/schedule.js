// ============================================================
// Cronograma de disparos espaçados (substitui os slots fixos).
//
// Dois modos de espaçamento:
//   interval    : dispara 1 oferta a cada intervalo ALEATÓRIO entre
//                 AUTOPUBLISH_INTERVAL_MIN_MINUTES e _MAX_MINUTES (padrão
//                 3-15min), entre AUTOPUBLISH_START_TIME e _END_TIME (BRT).
//                 O sorteio é determinístico por dia (seed = data BRT):
//                 mesma sequência o dia inteiro, muda de um dia pro outro —
//                 sem isso, cada chamada geraria uma lista diferente e o
//                 "disparo do minuto X" nunca bateria com o plano do dia.
//   daily_target: o usuário define AUTOPUBLISH_DAILY_TARGET (ex. 20 ofertas
//                 por dia) e o sistema calcula o intervalo fixo que distribui
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

// PRNG determinístico (mulberry32) a partir de uma string-seed — mesma
// seed sempre gera a mesma sequência. Usado pra sortear os gaps do modo
// "interval" de forma estável durante o dia (seed = data BRT).
function seededGapPicker(seedStr, min, max) {
  let seed = 0;
  const s = String(seedStr || "");
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
  return function nextGap() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return min + Math.floor(r * (max - min + 1));
  };
}

// Calcula os minutos de disparo do dia. `seedDate` (padrão: hoje em BRT)
// fixa o sorteio do modo "interval" — passe o mesmo valor (ou deixe o
// padrão) em todas as chamadas do mesmo dia pra ter a mesma lista.
function computeDispatchTimes(cfg, seedDate) {
  const spacingMode = String(cfg("AUTOPUBLISH_SPACING_MODE", "interval")).toLowerCase();
  const start = hhmmToMins(cfg("AUTOPUBLISH_START_TIME", "08:00"));
  const end = hhmmToMins(cfg("AUTOPUBLISH_END_TIME", "23:00"));

  let interval;
  let nextGap;
  if (spacingMode === "daily_target") {
    const target = Math.max(1, Math.round(numVal(cfg("AUTOPUBLISH_DAILY_TARGET", "15"), 15)));
    const span = end - start;
    const raw = span > 0 && target > 1 ? span / (target - 1) : 60;
    interval = Math.max(5, Math.round(raw / 5) * 5);
    nextGap = () => interval;
  } else {
    const minGap = Math.max(1, Math.round(numVal(cfg("AUTOPUBLISH_INTERVAL_MIN_MINUTES", "3"), 3)));
    const maxGap = Math.max(minGap, Math.round(numVal(cfg("AUTOPUBLISH_INTERVAL_MAX_MINUTES", "15"), 15)));
    interval = Math.round((minGap + maxGap) / 2);
    nextGap = seededGapPicker(seedDate || todayBRT(), minGap, maxGap);
  }

  const times = [];
  if (end > start) {
    for (let t = start; t <= end; t += nextGap()) times.push(t);
  } else if (end === start) {
    times.push(start);
  } else {
    // janela da meia-noite: vai até 24h e continua do 0 até o fim
    let t = start;
    while (t < 1440) {
      times.push(t);
      t += nextGap();
    }
    t = 0;
    while (t <= end) {
      times.push(t);
      t += nextGap();
    }
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