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

// Achadinhos idênticos compartilhados de novo (ex: pelo Atalho do iPhone)
// costumam ter URLs de origem diferentes (cada compartilhamento carrega
// parâmetros de rastreio próprios), mas a mesma foto do produto — é o
// jeito confiável de detectar duplicata.
async function findActiveByImage(image) {
  if (!image) return null;
  const supabase = getClient();
  const { data, error } = await supabase
    .from("products")
    .select(ADMIN_COLUMNS)
    .eq("active", true)
    .eq("image", image)
    .limit(1);

  if (error) throw error;
  return data && data[0] ? toProduct(data[0]) : null;
}

async function setProductActive(id, active) {
  const supabase = getClient();
  const { error } = await supabase.from("products").update({ active }).eq("id", id);
  if (error) throw error;
}

async function updateProduct(id, { title, price }) {
  const supabase = getClient();
  const fields = {};
  if (title !== undefined) fields.title = title;
  if (price !== undefined) fields.price = price;

  const { data, error } = await supabase
    .from("products")
    .update(fields)
    .eq("id", id)
    .select(ADMIN_COLUMNS)
    .single();

  if (error) throw error;
  return toProduct(data);
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

// ============================================================
// Caption templates (frases pré-definidas por horário/categoria)
// ============================================================

const TEMPLATE_COLUMNS = "id, time_slot, category, hook_type, template_text, is_active, created_at";

function toTemplate(row) {
  return {
    id: row.id,
    timeSlot: row.time_slot,
    category: row.category,
    hookType: row.hook_type,
    templateText: row.template_text,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

async function getAllTemplates() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("caption_templates")
    .select(TEMPLATE_COLUMNS)
    .order("time_slot", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data || []).map(toTemplate);
}

async function insertTemplate({ timeSlot, category, hookType, templateText }) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("caption_templates")
    .insert({
      time_slot: timeSlot,
      category,
      hook_type: hookType,
      template_text: templateText,
    })
    .select(TEMPLATE_COLUMNS)
    .single();

  if (error) throw error;
  return toTemplate(data);
}

async function updateTemplate(id, { templateText, isActive }) {
  const supabase = getClient();
  const fields = {};
  if (templateText !== undefined) fields.template_text = templateText;
  if (isActive !== undefined) fields.is_active = isActive;

  const { data, error } = await supabase
    .from("caption_templates")
    .update(fields)
    .eq("id", id)
    .select(TEMPLATE_COLUMNS)
    .single();

  if (error) throw error;
  return toTemplate(data);
}

async function deleteTemplate(id) {
  const supabase = getClient();
  const { error } = await supabase.from("caption_templates").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Daily posts (agenda diária)
// ============================================================

const POST_COLUMNS = "id, post_date, time_slot, product_id, caption, status, created_at";

function toPost(row) {
  return {
    id: row.id,
    postDate: row.post_date,
    timeSlot: row.time_slot,
    productId: row.product_id,
    caption: row.caption,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function getPostsForDate(dateStr) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("daily_posts")
    .select(POST_COLUMNS)
    .eq("post_date", dateStr)
    .order("time_slot", { ascending: true });

  if (error) throw error;
  return (data || []).map(toPost);
}

async function upsertDailyPost({ postDate, timeSlot, productId, caption, status }) {
  const supabase = getClient();
  const fields = { post_date: postDate, time_slot: timeSlot };
  if (productId !== undefined) fields.product_id = productId;
  if (caption !== undefined) fields.caption = caption;
  if (status !== undefined) fields.status = status;

  const { data, error } = await supabase
    .from("daily_posts")
    .upsert(fields, { onConflict: "post_date,time_slot" })
    .select(POST_COLUMNS)
    .single();

  if (error) throw error;
  return toPost(data);
}

module.exports = {
  getActiveProducts,
  getAllProducts,
  findActiveByImage,
  setProductActive,
  updateProduct,
  insertProduct,
  getAllTemplates,
  insertTemplate,
  updateTemplate,
  deleteTemplate,
  getPostsForDate,
  upsertDailyPost,
};
