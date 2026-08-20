// ============================================================
// Integração com a API de Afiliados da Shopee (Open API, GraphQL).
//
// ATENÇÃO: os nomes de campos/argumentos de `productOfferV2` abaixo são
// a melhor tentativa com base na documentação pública — a Shopee não
// deixa claro se dá pra buscar UM produto exato por URL/itemId, ou só
// buscar/listar por palavra-chave. Por isso getProductInfo() tenta em
// cadeia (itemId/shopId -> palavra-chave -> raspagem da página pública)
// e loga qual estratégia funcionou, pra ajustarmos com uma resposta real
// assim que tivermos as credenciais.
// ============================================================

const crypto = require("crypto");

const GRAPHQL_URL = "https://open-api.affiliate.shopee.com.br/graphql";

function buildAuthHeader(appId, secret, payloadString) {
  const timestamp = Math.floor(Date.now() / 1000);
  const base = `${appId}${timestamp}${payloadString}${secret}`;
  const signature = crypto.createHash("sha256").update(base).digest("hex");
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

async function callShopeeApi(query, variables) {
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_APP_SECRET;
  if (!appId || !secret) {
    throw new Error("SHOPEE_APP_ID / SHOPEE_APP_SECRET não configurados");
  }

  const body = { query, variables };
  const payloadString = JSON.stringify(body);
  const authHeader = buildAuthHeader(appId, secret, payloadString);

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: payloadString,
  });

  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error("Shopee API error: " + JSON.stringify(json.errors));
  }
  return json.data;
}

function extractShopIdItemId(url) {
  const match = url.match(/-i\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { shopId: Number(match[1]), itemId: Number(match[2]) };
}

function extractKeywordFromSlug(url) {
  try {
    const path = new URL(url).pathname;
    const slug = path.split("/").filter(Boolean)[0] || "";
    const withoutIds = slug.replace(/-i\.\d+\.\d+$/, "");
    return withoutIds.replace(/-/g, " ").trim();
  } catch {
    return "";
  }
}

// Segue redirects (útil pra links curtos shp.ee / s.shopee.com.br) e
// devolve a URL final + o HTML, pra reaproveitar no fallback de raspagem.
async function fetchPage(url) {
  const res = await fetch(url, { method: "GET", redirect: "follow" });
  const html = await res.text();
  return { finalUrl: res.url || url, html };
}

function scrapeOgTags(html) {
  const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const image = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  return { title: title || null, image: image || null };
}

const PRODUCT_OFFER_QUERY = `
  query ProductOffer($itemId: Int64, $shopId: Int64, $keyword: String) {
    productOfferV2(itemId: $itemId, shopId: $shopId, keyword: $keyword, page: 1, limit: 1) {
      nodes {
        productName
        imageUrl
        priceMin
        priceMax
        offerLink
        productLink
      }
    }
  }
`;

async function tryProductOfferV2(variables) {
  const data = await callShopeeApi(PRODUCT_OFFER_QUERY, variables);
  const node = data?.productOfferV2?.nodes?.[0];
  if (!node) return null;
  return {
    title: node.productName,
    image: node.imageUrl,
    price: Number(node.priceMin ?? node.priceMax),
    offerLink: node.offerLink || null,
  };
}

// Retorna { title, image, price, offerLink, sourceUrl, strategy }
// `price` e/ou `image` podem vir null se só a raspagem funcionar — quem
// chama decide o que fazer (ex: pedir preço no texto da mensagem).
async function getProductInfo(rawUrl) {
  const { finalUrl, html } = await fetchPage(rawUrl);
  const ids = extractShopIdItemId(finalUrl);

  if (ids) {
    try {
      const info = await tryProductOfferV2({ itemId: ids.itemId, shopId: ids.shopId });
      if (info) {
        console.log("shopee.getProductInfo: resolvido via itemId/shopId");
        return { ...info, sourceUrl: finalUrl, strategy: "itemId_shopId" };
      }
    } catch (err) {
      console.warn("shopee.getProductInfo: falha na busca por itemId/shopId:", err.message);
    }
  }

  const keyword = extractKeywordFromSlug(finalUrl);
  if (keyword) {
    try {
      const info = await tryProductOfferV2({ keyword });
      if (info) {
        console.log("shopee.getProductInfo: resolvido via keyword");
        return { ...info, sourceUrl: finalUrl, strategy: "keyword" };
      }
    } catch (err) {
      console.warn("shopee.getProductInfo: falha na busca por keyword:", err.message);
    }
  }

  console.log("shopee.getProductInfo: caiu no fallback de raspagem (og:tags)");
  const scraped = scrapeOgTags(html);
  return {
    title: scraped.title,
    image: scraped.image,
    price: null,
    offerLink: null,
    sourceUrl: finalUrl,
    strategy: "scrape",
  };
}

const SHORT_LINK_MUTATION = `
  mutation GenerateShortLink($originUrl: String!, $subIds: [String]) {
    generateShortLink(input: { originUrl: $originUrl, subIds: $subIds }) {
      shortLink
    }
  }
`;

async function generateAffiliateLink(originUrl, subIds = ["bendito-achadinho-bot"]) {
  const data = await callShopeeApi(SHORT_LINK_MUTATION, { originUrl, subIds });
  const shortLink = data?.generateShortLink?.shortLink;
  if (!shortLink) throw new Error("Shopee generateShortLink não retornou link");
  return shortLink;
}

module.exports = {
  getProductInfo,
  generateAffiliateLink,
  extractShopIdItemId,
};
