// ============================================================
// Integração com a API de Afiliados da Shopee (Open API, GraphQL).
//
// Testado com credenciais reais em 2026-08-21:
// - Autenticação (assinatura SHA256) confirmada funcionando.
// - `productOfferV2` filtrado por `itemId`/`shopId` (Int64) retorna
//   "wrong type" mesmo com o formato certo E com números reais tirados
//   de uma URL de verdade (testado). Provavelmente esse filtro não
//   serve pra "buscar 1 produto exato" de jeito nenhum — não usamos.
// - `productOfferV2` filtrado por `keyword` funciona muito bem e já
//   devolve título, imagem, preço E um `offerLink` (link de afiliado
//   pronto) — é a estratégia principal, o problema é só CONSEGUIR uma
//   boa keyword (ver abaixo).
// - Link direto (shopee.com.br/Produto-i.shopId.itemId) e br.shp.ee
//   resolvem bem: o slug da URL já vira uma keyword decente.
// - Link curto s.shopee.com.br (o que o botão "Compartilhar" do APP da
//   Shopee gera) NÃO tem slug útil — redireciona pra uma página que é
//   só um shell React (SPA), sem og:tags nem dado nenhum no HTML cru.
//   Descoberta: com um User-Agent de bot de preview (tipo WhatsApp), a
//   Shopee serve uma versão com og:title/og:image reais (pensada pra
//   preview de link em chat) — vira uma keyword ótima pra busca. Ainda
//   não tem preço nessa página, mas o preço vem de graça ao rodar essa
//   keyword no productOfferV2.
// - `generateShortLink` funciona (o subId não pode ter hífen — "wrong
//   sub id" se tiver). Usado só quando nenhuma keyword deu match (aí
//   caímos na raspagem pura, sem offerLink).
// ============================================================

const crypto = require("crypto");

const GRAPHQL_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const BOT_USER_AGENT = "WhatsApp/2.23.20.0";

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

async function fetchPage(url, extraHeaders = {}) {
  const res = await fetch(url, { method: "GET", redirect: "follow", headers: extraHeaders });
  const html = await res.text();
  return { finalUrl: res.url || url, html };
}

function scrapeOgTags(html) {
  const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const image = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  // A Shopee às vezes trunca o og:title com "..." — tira isso antes de
  // usar como keyword de busca (senão a busca não bate com nada).
  const cleanTitle = title ? title.replace(/\.{3}$/, "").trim() : null;
  return { title: cleanTitle || null, image: image || null };
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

async function tryKeywordSearch(keyword) {
  if (!keyword) return null;
  try {
    const data = await callShopeeApi(PRODUCT_OFFER_BY_KEYWORD, { keyword });
    const node = data?.productOfferV2?.nodes?.[0];
    if (!node) return null;
    return {
      title: node.productName,
      image: node.imageUrl,
      price: Number(node.priceMin ?? node.priceMax),
      offerLink: node.offerLink || null,
    };
  } catch (err) {
    console.warn("shopee: busca por keyword falhou:", err.message);
    return null;
  }
}

// Retorna { title, image, price, offerLink, sourceUrl, strategy }.
// `offerLink` só vem preenchido quando alguma busca por keyword
// funciona — se cair no fallback final de raspagem, quem chamar
// precisa gerar o link de afiliado separadamente com generateAffiliateLink().
async function getProductInfo(rawUrl) {
  const { finalUrl, html } = await fetchPage(rawUrl);

  // 1ª tentativa: link direto/br.shp.ee — o slug da URL já é uma keyword boa.
  const slugKeyword = extractKeywordFromSlug(finalUrl);
  let result = await tryKeywordSearch(slugKeyword);
  if (result) {
    console.log("shopee.getProductInfo: resolvido via keyword do slug");
    return { ...result, sourceUrl: finalUrl, strategy: "keyword_slug" };
  }

  // 2ª tentativa: link curto s.shopee.com.br redireciona pra um shell React
  // sem slug útil. Um User-Agent de bot de preview (WhatsApp) faz a Shopee
  // devolver og:title/og:image reais — vira uma keyword bem melhor.
  const { html: botHtml } = await fetchPage(rawUrl, { "User-Agent": BOT_USER_AGENT });
  const scraped = scrapeOgTags(botHtml);
  result = await tryKeywordSearch(scraped.title);
  if (result) {
    console.log("shopee.getProductInfo: resolvido via keyword do og:title (user-agent de bot)");
    return { ...result, sourceUrl: finalUrl, strategy: "keyword_bot_title" };
  }

  // Último recurso: fica só com o que a raspagem achou (sem preço).
  console.log("shopee.getProductInfo: caiu no fallback final (sem preço)");
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
  callShopeeApi,
  buildAuthHeader,
  extractKeywordFromSlug,
};
