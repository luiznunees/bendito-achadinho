// ============================================================
// Registro de execuções do auto-publish (auto_publish_log).
//
// Alimenta o dashboard de status: o que foi enviado, quando, e
// o resultado de cada disparo. A escrita NUNCA deve quebrar a
// publicação — se a tabela não existir ou der erro, só loga.
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

async function insertLog(entry) {
  const {
    runDate,
    slotHour,
    type,        // "greeting" | "products"
    status,      // "sent" | "no_offers" | "disabled" | "dry_run" | "error" | "skipped"
    detail,
    publishedCount,
    savedCount,
    skippedCount,
    errorCount,
    shopeeItemIds,
  } = entry;

  try {
    const supabase = getClient();
    const { error } = await supabase.from("auto_publish_log").insert({
      run_date: runDate,
      slot_hour: slotHour,
      type,
      status,
      detail: detail || "",
      published_count: publishedCount ?? 0,
      saved_count: savedCount ?? 0,
      skipped_count: skippedCount ?? 0,
      error_count: errorCount ?? 0,
      shopee_item_ids: shopeeItemIds || [],
    });
    if (error) console.warn("publish_log.insertLog: falha:", error.message);
  } catch (err) {
    console.warn("publish_log.insertLog: tabela inexistente?:", err.message);
  }
}

async function getLogsOfDay(dateStr) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("auto_publish_log")
    .select("*")
    .eq("run_date", dateStr)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getRecentLogs(limit = 10) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("auto_publish_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

module.exports = { insertLog, getLogsOfDay, getRecentLogs };