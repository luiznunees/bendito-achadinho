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
    active: row.active,
    sourceUrl: row.source_url,
    createdAt: row.created_at,
  };
}

const PUBLIC_COLUMNS = "id, title, image, emoji, price, affiliate_link";
const ADMIN_COLUMNS = "id, title, image, emoji, price, affiliate_link, active, source_url, created_at";

async function getActiveProducts() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("products")
    .select(PUBLIC_COLUMNS)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(toProduct);
}

async function getAllProducts() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("products")
    .select(ADMIN_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(toProduct);
}

async function setProductActive(id, active) {
  const supabase = getClient();
  const { error } = await supabase.from("products").update({ active }).eq("id", id);
  if (error) throw error;
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
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) throw error;
  return toProduct(data);
}

module.exports = { getActiveProducts, getAllProducts, setProductActive, insertProduct };
