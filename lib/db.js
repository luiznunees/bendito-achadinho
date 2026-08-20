const { neon } = require("@neondatabase/serverless");

let sql = null;
function getSql() {
  if (!sql) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL / POSTGRES_URL não configurado");
    }
    sql = neon(connectionString);
  }
  return sql;
}

// Nota: sql`...` do @neondatabase/serverless devolve o array de linhas
// direto (diferente do @vercel/postgres, que envolvia em { rows }).
async function getActiveProducts() {
  const db = getSql();
  return db`
    SELECT id, title, image, emoji, price, affiliate_link AS "affiliateLink"
    FROM products
    WHERE active = true
    ORDER BY created_at DESC
  `;
}

async function insertProduct({ title, image, emoji, price, affiliateLink, sourceUrl, rawTitle }) {
  const db = getSql();
  const rows = await db`
    INSERT INTO products (title, image, emoji, price, affiliate_link, source_url, raw_title)
    VALUES (${title}, ${image || ""}, ${emoji || "🛍️"}, ${price}, ${affiliateLink}, ${sourceUrl || null}, ${rawTitle || null})
    RETURNING id, title, image, emoji, price, affiliate_link AS "affiliateLink"
  `;
  return rows[0];
}

module.exports = { getActiveProducts, insertProduct };
