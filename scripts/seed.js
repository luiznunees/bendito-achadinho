// ============================================================
// Roda uma vez pra criar a tabela `products` e semear os produtos
// de exemplo, caso o banco esteja vazio.
//
// Uso (precisa de DATABASE_URL no ambiente):
//   node --env-file=.env.local scripts/seed.js
// ============================================================

const { neon } = require("@neondatabase/serverless");
const PRODUCTS = require("../data/products.js");

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("Defina DATABASE_URL (ou POSTGRES_URL) antes de rodar este script.");
  process.exit(1);
}

const sql = neon(connectionString);

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      image TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '🛍️',
      price NUMERIC(10,2) NOT NULL,
      affiliate_link TEXT NOT NULL,
      source_url TEXT,
      raw_title TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_products_active_created
    ON products (active, created_at DESC)
  `;

  const countRows = await sql`SELECT COUNT(*)::int AS count FROM products`;
  if (countRows[0].count > 0) {
    console.log(`Tabela já tem ${countRows[0].count} produto(s) — não semeei de novo.`);
    return;
  }

  for (const p of PRODUCTS) {
    await sql`
      INSERT INTO products (title, image, emoji, price, affiliate_link)
      VALUES (${p.title}, ${p.image || ""}, ${p.emoji || "🛍️"}, ${p.price}, ${p.affiliateLink})
    `;
  }
  console.log(`Semeei ${PRODUCTS.length} produtos de exemplo.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
