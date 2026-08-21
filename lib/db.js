const { createClient } = require("@supabase/supabase-js");

let client = null;
function getClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados");
    }
    client = createClient(url, key);
  }
  return client;
}

function toProduct(row) {
  return {
    id: row.id,
    title: row.title,
    image: row.image,
    emoji: row.emoji,
    price: Number(row.price),
    affiliateLink: row.affiliate_link,
  };
}

async function getActiveProducts() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, title, image, emoji, price, affiliate_link")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(toProduct);
}

async function insertProduct({ title, image, emoji, price, affiliateLink, sourceUrl, rawTitle }) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      title,
      image: image || "",
      emoji: emoji || "🛍️",
      price,
      affiliate_link: affiliateLink,
      source_url: sourceUrl || null,
      raw_title: rawTitle || null,
    })
    .select("id, title, image, emoji, price, affiliate_link")
    .single();

  if (error) throw error;
  return toProduct(data);
}

module.exports = { getActiveProducts, insertProduct };
