// ============================================================
// Rebuild do plano do dia (auto_publish_plan) com as settings atuais.
// Útil quando o plano do dia foi montado enxuto (ex.: sortType ruim
// ou pool pequeno) e os slots do dia seguem sem oferta.
//
// Uso: node scripts/rebuild-plan.js [YYYY-MM-DD]
//   Sem argumento, reconstrói HOJE (BRT).
// ============================================================

const { createClient } = require("@supabase/supabase-js");
const { loadPipelineSettings, cfg, collectOffers, buildDiversePlan } = require("../lib/auto_publish.js");
const { todayBRT, computeDispatchTimes } = require("../lib/schedule.js");
const { getDayPlan, replaceDayPlan } = require("../lib/plan.js");

(async () => {
  await loadPipelineSettings();
  const runDate = process.argv[2] || todayBRT();

  const dispatch = computeDispatchTimes(cfg);
  const size = Math.min(Math.max(dispatch.numDispatches || 1, 1), 90);
  const maxPerSeller = Math.max(1, parseInt(cfg("AUTOPUBLISH_PLAN_MAX_PER_SELLER", "3"), 10) || 3);

  console.log(`rebuild do plano ${runDate}: size=${size} (${dispatch.start}->${dispatch.end}, ${dispatch.interval}min)`);

  const pool = await collectOffers(Math.min(Math.max(size * 4, 40), 200));
  console.log(`pool coletado (após filtros/no-repeat): ${pool.length}`);
  if (pool.length === 0) throw new Error("pool vazio — nada a gravar");

  const draft = buildDiversePlan(pool, size, maxPerSeller);
  if (draft.length === 0) throw new Error("plano vazio — nada a gravar");

  const existing = await getDayPlan(runDate);
  console.log(`plano atual: ${existing ? existing.length : "não montado"} itens -> novo: ${draft.length}`);

  await replaceDayPlan(runDate, draft);
  const byCat = draft.reduce((a, o) => {
    a[o.category] = (a[o.category] || 0) + 1;
    return a;
  }, {});
  console.log("mix:", JSON.stringify(byCat));
  console.log("primeiros 8:", draft.slice(0, 8).map((o) => String(o.productName).slice(0, 55)));
  process.exit(0);
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});