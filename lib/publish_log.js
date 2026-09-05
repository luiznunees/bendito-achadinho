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

// ============================================================
// TRAVA DE SLOT (anti-duplicata)
//
// O job de janela e o cron de segurança são processos separados e
// podem disparar no MESMO minuto. Para evitar 2 envios no mesmo
// slot, o slot é "reservado" no banco ANTES de fazer o trabalho
// pesado (busca + Gemini + envio): quem inserir a linha primeiro
// vence; o outro processo detecta o conflito e para.
//
// slotKey = `${type}|${runDate}|${slotMinute}`  ex: products|2026-09-05|780
// Retorno:
//   "claimed"  → esta execução ganhou o slot (prossiga e depois finishSlot())
//   "skipped"  → o slot já está sendo processado por outro processo
//   "fallback" → tabela sem coluna slot_key (migração pendente): segue
//                SEM trava (comportamento antigo), pra nunca travar o envio.
// ============================================================
async function acquireSlot(slotKey, type, slotHour) {
  try {
    const supabase = getClient();
    const [runDate] = slotKey.split("|").slice(1, 2);
    const row = {
      run_date: runDate,
      slot_hour: slotHour,
      type,
      status: "in_progress",
      detail: "disparo em andamento",
      published_count: 0,
      saved_count: 0,
      skipped_count: 0,
      error_count: 0,
      shopee_item_ids: [],
      slot_key: slotKey,
    };

    const ins = await supabase.from("auto_publish_log").insert(row);
    if (!ins.error) return "claimed";

    // Conflito de unicidade = outro processo ganhou o slot.
    if (ins.error.code === "23505" || /duplicate/i.test(ins.error.message || "")) {
      const { data } = await supabase
        .from("auto_publish_log")
        .select("id, status, created_at")
        .eq("slot_key", slotKey)
        .maybeSingle();

      // Recuperação de crash: se o dono do slot morreu no meio e a
      // reserva está velha (>5min), remove e tenta de novo.
      if (
        data &&
        data.status === "in_progress" &&
        Date.now() - new Date(data.created_at).getTime() > 5 * 60000
      ) {
        await supabase.from("auto_publish_log").delete().eq("id", data.id);
        const ins2 = await supabase.from("auto_publish_log").insert(row);
        if (!ins2.error) return "claimed";
      }
      return "skipped";
    }

    // Coluna slot_key ausente (migração pendente) ou outro erro não
    // relacionado a duplicidade → segue sem trava (fail-open).
    console.warn("publish_log.acquireSlot: sem trava de slot:", ins.error.message);
    return "fallback";
  } catch (err) {
    console.warn("publish_log.acquireSlot: erro ao reservar slot:", err.message);
    return "fallback";
  }
}

// Atualiza a linha reservada com o resultado final da execução.
async function finishSlot(slotKey, entry) {
  try {
    const supabase = getClient();
    const { data } = await supabase
      .from("auto_publish_log")
      .select("id")
      .eq("slot_key", slotKey)
      .maybeSingle();
    if (!data) return false;

    const { error } = await supabase
      .from("auto_publish_log")
      .update({
        status: entry.status,
        detail: entry.detail || "",
        published_count: entry.publishedCount ?? 0,
        saved_count: entry.savedCount ?? 0,
        skipped_count: entry.skippedCount ?? 0,
        error_count: entry.errorCount ?? 0,
        shopee_item_ids: entry.shopeeItemIds || [],
      })
      .eq("id", data.id);
    if (error) console.warn("publish_log.finishSlot:", error.message);
    return !error;
  } catch (err) {
    console.warn("publish_log.finishSlot:", err.message);
    return false;
  }
}

module.exports = { insertLog, getLogsOfDay, getRecentLogs, acquireSlot, finishSlot };