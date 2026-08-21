// ============================================================
// Integração com a API de Afiliados da Shopee (Open API, GraphQL).
//
// Testado com credenciais reais em 2026-08-21:
// - Autenticação (assinatura SHA256) confirmada funcionando.
// - `productOfferV2` filtrado por `itemId`/`shopId` (Int64) retorna
//   "wrong type" mesmo com o formato certo — provavelmente porque
//   precisa ser um ID que realmente existe (testamos só com IDs
//   inventados). Não usamos essa estratégia por não termos como
//   validar com um produto real ainda.
// - `productOfferV2` filtrado por `keyword` (extraído do slug da URL)
//   funciona muito bem e já devolve título, imagem, preço E um
//   `offerLink` (link de afiliado pronto) — vira a estratégia principal.
// - `generateShortLink` funciona (o subId não pode ter hífen — "wrong
//   sub id" se tiver). Usado só quando a busca por keyword não achou
//   nada (aí caímos na raspagem da página, que não retorna offerLink).
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

function extractKeywordFromSlug(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
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

const PRODUCT_OFFER_BY_KEYWORD = `
  query ProductOffer($keyword: String) {
    productOfferV2(keyword: $keyword, page: 1, limit: 1) {
      nodes {
        productName
        imageUrl
        priceMin
        priceMax
        offerLink
      }
    }
  }
`;

// Retorna { title, image, price, offerLink, sourceUrl, strategy }.
// `offerLink` só vem preenchido quando a estratégia "keyword" funciona —
// se cair no fallback de raspagem, quem chamar precisa gerar o link de
// afiliado separadamente com generateAffiliateLink().
async function getProductInfo(rawUrl) {
  const { finalUrl, html } = await fetchPage(rawUrl);

  const keyword = extractKeywordFromSlug(finalUrl);
  if (keyword) {
    try {
      const data = await callShopeeApi(PRODUCT_OFFER_BY_KEYWORD, { keyword });
      const node = data?.productOfferV2?.nodes?.[0];
      if (node) {
        console.log("shopee.getProductInfo: resolvido via keyword");
        return {
          title: node.productName,
          image: node.imageUrl,
          price: Number(node.priceMin ?? node.priceMax),
          offerLink: node.offerLink || null,
          sourceUrl: finalUrl,
          strategy: "keyword",
        };
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
  mutation GenerateShortLink($originUrl: String!, $subIds: [String!]) {
    generateShortLink(input: { originUrl: $originUrl, subIds: $subIds }) {
      shortLink
    }
  }
`;

async function generateAffiliateLink(originUrl, subIds = ["benditoachadinhobot"]) {
  const data = await callShopeeApi(SHORT_LINK_MUTATION, { originUrl, subIds });
  const shortLink = data?.generateShortLink?.shortLink;
  if (!shortLink) throw new Error("Shopee generateShortLink não retornou link");
  return shortLink;
}

module.exports = {
  getProductInfo,
  generateAffiliateLink,
};
