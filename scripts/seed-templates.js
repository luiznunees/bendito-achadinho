// ============================================================
// Semeia os "caption templates" (frases por horário) a partir da
// planilha Calendário 7 dias → Supabase.
//
// A planilha tem 7 dias x 7 horários = 49 linhas de copy, cada uma
// com gancho (título da capa) + mini-CTA. O texto do template junta
// as duas frases, separadas por quebra de linha.
//
// Prerequisitos:
//   - Tabela `caption_templates` criada (SQL no README)
//   - Pacote `xlsx` instalado (npm i --no-save xlsx)
//
// Uso:
//   node --env-file=.env.local scripts/seed-templates.js
//     ["caminho/do/arquivo.xlsx"]
// ============================================================

const { createClient } = require("@supabase/supabase-js");
const XLSX = require("xlsx");
const path = require("path");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de rodar este script.");
  process.exit(1);
}

const xlsxPath = path.resolve(process.argv[2] || "data/planilhas/calendario-7dias-ofertas-catolicas.xlsx");

// Mapa de horário -> categoria canônica (igual à SLOT_CONFIG do painel)
const SLOT_CATEGORY = {
  "08h": "Terços e papelaria",
  "11h": "Decoração católica",
  "13h": "Moda e acessórios",
  "15h": "Presentes / comunhão",
  "18h": "Livros espirituais",
  "21h": "Terços e decoração (mix)",
  "23h": "Joias e presentes",
};

// Mapa de "Tipo de gancho" da planilha -> hookType canônico do painel
function mapHookType(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("benef")) return "beneficio";
  if (s.includes("curios") || s.includes("achado")) return "curiosidade";
  if (s.includes("urg")) return "urgencia";
  return "identidade";
}

const supabase = createClient(url, key);

function buildTemplates(rows) {
  const templates = [];
  const seen = new Set();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const day = String(r[0] || "").trim();
    const timeSlot = String(r[1] || "").trim();
    const gancho = String(r[4] || "").trim();
    const miniCTA = String(r[5] || "").trim();

    if (!day || !timeSlot || !gancho) continue; // pula cabeçalho e linhas vazias

    const category = SLOT_CATEGORY[timeSlot];
    const hookType = mapHookType(r[3]);

    if (!category) {
      console.warn(`⚠️  Horário não mapeado: "${timeSlot}" (${day}) — pulando.`);
      continue;
    }

    const text = miniCTA ? `${gancho}\n\n${miniCTA}` : gancho;
    const keyStr = `${timeSlot}|${text}`;
    if (seen.has(keyStr)) continue; // evita duplicata perfeita
    seen.add(keyStr);

    templates.push({ day, timeSlot, category, hookType, templateText: text });
  }

  return templates;
}

async function main() {
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const templates = buildTemplates(rows);

  console.log(`Li ${templates.length} templates da planilha.`);

  // Limpa os templates existentes que vieram do calendário (mesmo horário)
  const { error: delError } = await supabase
    .from("caption_templates")
    .delete()
    .in("time_slot", Object.keys(SLOT_CATEGORY));

  if (delError) {
    console.error("Erro ao limpar templates antigos:", delError.message);
    process.exit(1);
  }
  console.log("Removi os templates antigos dos 7 horários.");

  const insertRows = templates.map((t) => ({
    time_slot: t.timeSlot,
    category: t.category,
    hook_type: t.hookType,
    template_text: t.templateText,
  }));

  const { error: insError } = await supabase.from("caption_templates").insert(insertRows);
  if (insError) {
    console.error("Erro ao inserir:", insError.message);
    process.exit(1);
  }
  console.log(`Semeei ${templates.length} templates no Supabase.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
