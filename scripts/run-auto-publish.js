// ============================================================
// Runner do pipeline de auto-publish para rodar FORA da Vercel.
//
// POR QUE EXISTE:
// O plano Free (Hobby) da Vercel limita funções serverless a 10s
// de execução — o pipeline (busca ~30 keywords + Gemini + envio
// com delay) estoura esse limite. Este script roda a MESMA lógica
// (lib/auto_publish.js) em qualquer ambiente sem limite de tempo:
// GitHub Actions, cron de VPS, laptop, etc.
//
// Uso:
//   node scripts/run-auto-publish.js products
//   node scripts/run-auto-publish.js greeting 8
//   node scripts/run-auto-publish.js greeting 23
//
// Precisa das variáveis de ambiente (supabase, shopee, gemini,
// evolution, group). Ex.: node --env-file=.env.local scripts/run-auto-publish.js products
// ============================================================

const { runAutoPublish, runGreeting } = require("../lib/auto_publish");

const type = (process.argv[2] || "products").toLowerCase();

async function main() {
  if (type === "greeting") {
    const hour = parseInt(process.argv[3] || "8", 10);
    const result = await runGreeting(hour);
    console.log("greeting:", JSON.stringify(result));
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