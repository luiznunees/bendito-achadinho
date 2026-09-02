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

// Chaves permitidas e valores padrão (usa env como fallback)
const DEFAULTS = {
  AUTOPUBLISH_KEYWORDS: "terço,terço de madeira,rosário,medalha,escapulário,imagem de santo,camiseta católica,caneca católica,chaveiro católico,bíblia,bíblia de estudo,catecismo,camiseta gospel,caneca gospel,blusa evangélica,livro evangélico,adesivo gospel,chaveiro gospel,caneca cristã,camiseta cristã,adesivo cristão,pulseira cristã,livro de oração",
  AUTOPUBLISH_MIN_DISCOUNT: "20",
  AUTOPUBLISH_MIN_PRICE: "5",
  AUTOPUBLISH_MAX_PRICE: "300",
  AUTOPUBLISH_MIN_COMMISSION: "0",
  AUTOPUBLISH_MAX_OFFERS: "5",
  AUTOPUBLISH_SORT_TYPE: "5",
  AUTOPUBLISH_SEND_IMAGE: "true",
  AUTOPUBLISH_DRY_RUN: "false",
  AUTOPUBLISH_SEND_DELAY: "8",
  AUTOPUBLISH_COUPON: "",
  AUTOPUBLISH_REQUIRE_NICHE: "true",
  AUTOPUBLISH_NICHE_TERMS: "santo,santa,terço,terco,rosário,rosario,bíblia,biblia,cristão,crista,católico,catolica,evangélico,evangelica,gospel,jesus,cruz,crucifixo,medalha,escapulário,escapulario,oração,oracao,fé,fe,devocional,nossa senhora,aparecida,padre,sagrado",
  AUTOPUBLISH_BLOCK_TERMS: "medusa,horus,ankh,olho de horus,buda,budismo,allah,islamica,islamico,maomé,maome,umbanda,espiritualismo,pachamama,satan,demonio,demônio,esqueleto,caveira,oculto,esoterico,esotérico,mágica,magica,energia,cristal",
  AUTOPUBLISH_TOKEN: "",
  AUTOPUBLISH_ENABLED: "true",
  AUTOPUBLISH_PAUSED_UNTIL: "",
  GROUP_WHATSAPP_ID: "",
};

async function getAllSettings() {
  const result = {};
  for (const key of Object.keys(DEFAULTS)) {
    result[key] = process.env[key] || DEFAULTS[key];
  }
  try {
    const supabase = getClient();
    const { data, error } = await supabase.from("settings").select("key, value");
    if (!error && data) {
      for (const row of data) result[row.key] = row.value;
    }
  } catch { /* tabela não existe ainda, usa env vars */ }
  return result;
}

async function getSetting(key) {
  if (!(key in DEFAULTS)) return undefined;
  try {
    const supabase = getClient();
    const { data, error } = await supabase.from("settings").select("value").eq("key", key).single();
    if (!error && data) return data.value;
  } catch { /* fallback */ }
  return process.env[key] || DEFAULTS[key];
}

async function updateSettings(updates) {
  const rows = Object.entries(updates)
    .filter(([k]) => k in DEFAULTS)
    .map(([key, value]) => ({ key, value: String(value), updated_at: new Date().toISOString() }));
  if (rows.length === 0) return;
  try {
    const supabase = getClient();
    const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
    if (error) throw error;
  } catch (err) {
    console.warn("settings.updateSettings: falha ao salvar no Supabase:", err.message);
  }
}

module.exports = { getAllSettings, getSetting, updateSettings, DEFAULTS };

// Checa se a automação pode rodar agora (enabled + não pausado).
// Retorna { ok: true } ou { ok: false, reason: string, pausedUntil?: string }.
async function checkPublishReady() {
  const s = await getAllSettings();
  if (s.AUTOPUBLISH_ENABLED !== "true") {
    return { ok: false, reason: "disabled" };
  }
  const pausedUntil = s.AUTOPUBLISH_PAUSED_UNTIL;
  if (pausedUntil) {
    const until = new Date(pausedUntil);
    if (Number.isFinite(until.getTime()) && until.getTime() > Date.now()) {
      return { ok: false, reason: "paused", pausedUntil: until.toISOString() };
    }
  }
  return { ok: true };
}

module.exports.checkPublishReady = checkPublishReady;
