// ============================================================
// Plano do dia (auto_publish_plan): ofertas selecionadas de uma
// vez no começo do dia para os disparos espaçados.
//
// Linhas: run_date + idx (posição na ordem do dia) + item (o
// candidato snapshot em JSON). A leitura/gravação NUNCA deve
// quebrar a publicação — em erro, devolve null (sem plano).
// ============================================================

const { createClient } = require("@supabase/supabase-js");

let client = null;
function getClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase não configurado");
    client = createClient(url, key);
  }
  return client;
}

// Retorna a lista de ofertas do dia na ordem (idx), ou:
//   []   -> tabela existe mas não há plano (ainda não montado)
//   null -> erro/tabela ausente (falha aberta: segue sem plano)
async function getDayPlan(runDate) {
  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from("auto_publish_plan")
      .select("item")
      .eq("run_date", runDate)
      .order("idx", { ascending: true });

    if (error) throw error;
    return (data || []).map((r) => r.item);
  } catch (err) {
    console.warn("plan.getDayPlan:", err.message);
    return null;
  }
}

// Substitui o plano do dia inteiro (reconstrói do zero se já existir).
async function replaceDayPlan(runDate, offers) {
  const supabase = getClient();
  await supabase.from("auto_publish_plan").delete().eq("run_date", runDate);
  const rows = offers.map((item, idx) => ({ run_date: runDate, idx, item }));
  const { error } = await supabase.from("auto_publish_plan").insert(rows);
  if (error) throw error;
}

module.exports = { getDayPlan, replaceDayPlan };