// ============================================================
// Roda uma vez pra semear os produtos de exemplo, caso a tabela
// `products` esteja vazia. Antes de rodar, crie a tabela colando o
// SQL do README (seção "Bot de curadoria") no SQL Editor do Supabase.
//
// Uso (precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente):
//   node --env-file=.env.local scripts/seed.js
// ============================================================

const { createClient } = require("@supabase/supabase-js");
const PRODUCTS = require("../data/products.js");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de rodar este script.");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { count, error: countError } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.error(
      "Não consegui ler a tabela `products` — crie ela primeiro com o SQL do README (seção Bot de curadoria).",
      countError.message
    );
    process.exit(1);
  }

  if (count > 0) {
    console.log(`Tabela já tem ${count} produto(s) — não semeei de novo.`);
    return;
  }

  const rows = PRODUCTS.map((p) => ({
    title: p.title,
    image: p.image || "",
    emoji: p.emoji || "🛍️",
    price: p.price,
    affiliate_link: p.affiliateLink,
  }));

  const { error } = await supabase.from("products").insert(rows);
  if (error) throw error;
  console.log(`Semeei ${PRODUCTS.length} produtos de exemplo.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
