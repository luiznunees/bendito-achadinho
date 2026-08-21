// ============================================================
// Lógica de curadoria compartilhada: dado um link da Shopee, busca
// os dados do produto, gera o link de afiliado, revisa o título com
// IA e salva no banco. Usado pelo webhook do WhatsApp e pelo painel
// de cadastro (api/admin/curate.js).
// ============================================================

const { getProductInfo, generateAffiliateLink } = require("./shopee");
const { rewriteTitle } = require("./gemini");
const { insertProduct, findActiveByImage } = require("./db");

class CurateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Aceita qualquer subdomínio antes de shopee.com.br ou shp.ee — a Shopee
// usa vários (s.shopee.com.br, br.shp.ee, etc.).
const SHOPEE_LINK_REGEX = /https?:\/\/(?:[a-z0-9-]+\.)*(?:shopee\.com\.br|shp\.ee)\/\S+/i;

// Puxa o link da Shopee de dentro de um texto qualquer — útil quando a
// origem (WhatsApp, compartilhamento do app da Shopee via Atalhos) manda
// uma frase inteira ("Olha que achado! https://...") em vez de só a URL.
function extractShopeeLink(text) {
  const match = String(text || "").match(SHOPEE_LINK_REGEX);
  return match ? match[0] : null;
}

async function curateFromUrl(shopeeUrl) {
  let info;
  try {
    info = await getProductInfo(shopeeUrl);
  } catch (err) {
    throw new CurateError("PRODUCT_INFO_FAILED", "Falha ao buscar dados do produto na Shopee: " + err.message);
  }

  // Compartilhamentos repetidos do mesmo produto geram URLs de origem
  // diferentes (cada uma com seus próprios parâmetros de rastreio), mas a
  // MESMA foto — usamos isso pra não duplicar o cadastro.
  if (info.image) {
    const existing = await findActiveByImage(info.image);
    if (existing) {
      return { ...existing, duplicate: true };
    }
  }

  // productOfferV2 (estratégia "keyword") já devolve um link de afiliado
  // pronto. Só quando cai no fallback de raspagem que precisamos gerar
  // um separado.
  let affiliateLink = info.offerLink;
  if (!affiliateLink) {
    try {
      affiliateLink = await generateAffiliateLink(shopeeUrl);
    } catch (err) {
      throw new CurateError("AFFILIATE_LINK_FAILED", "Falha ao gerar link de afiliado: " + err.message);
    }
  }

  if (!info.title || info.price == null) {
    throw new CurateError(
      "INCOMPLETE_INFO",
      "Não encontrei título e preço completos pra esse produto — tenta o link direto da página do produto."
    );
  }

  const finalTitle = await rewriteTitle(info.title);

  try {
    const saved = await insertProduct({
      title: finalTitle,
      image: info.image || "",
      emoji: "🛍️",
      price: info.price,
      affiliateLink,
      sourceUrl: info.sourceUrl,
      rawTitle: info.title,
    });
    return { ...saved, duplicate: false };
  } catch (err) {
    throw new CurateError("DB_FAILED", "Falha ao salvar no banco: " + err.message);
  }
}

module.exports = { curateFromUrl, CurateError, extractShopeeLink };
