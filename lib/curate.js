// ============================================================
// Lógica de curadoria compartilhada: dado um link da Shopee, busca
// os dados do produto, gera o link de afiliado, revisa o título com
// IA e salva no banco. Usado pelo webhook do WhatsApp e pelo painel
// de cadastro (api/admin/curate.js).
// ============================================================

const { getProductInfo, generateAffiliateLink } = require("./shopee");
const { rewriteTitle } = require("./gemini");
const { insertProduct } = require("./db");

class CurateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function curateFromUrl(shopeeUrl) {
  let info;
  try {
    info = await getProductInfo(shopeeUrl);
  } catch (err) {
    throw new CurateError("PRODUCT_INFO_FAILED", "Falha ao buscar dados do produto na Shopee: " + err.message);
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
    return await insertProduct({
      title: finalTitle,
      image: info.image || "",
      emoji: "🛍️",
      price: info.price,
      affiliateLink,
      sourceUrl: info.sourceUrl,
      rawTitle: info.title,
    });
  } catch (err) {
    throw new CurateError("DB_FAILED", "Falha ao salvar no banco: " + err.message);
  }
}

module.exports = { curateFromUrl, CurateError };
