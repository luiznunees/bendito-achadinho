// ============================================================
// Automação de publicação automática de achadinhos.
//
// Diferente do bot de curadoria (que espera você mandar um link),
// esta automação BUSCA produtos por conta própria na API da Shopee
// (por palavras-chave), filtra por desconto/preço/comissão, cadastra
// no site E publica no grupo de ofertas do WhatsApp.
//
// Uso: chamado pela Vercel Function api/auto-publish.js (disparada
// por Vercel Cron). Também exporta as funções para scripts/tests.
// ============================================================

const { callShopeeApi, generateAffiliateLink } = require("./shopee");
const { sendWhatsAppMessage, sendWhatsAppImage } = require("./evolution");
const { insertProduct, findActiveByImage } = require("./db");
const { generateOfferTexts } = require("./gemini");
const { checkPublishReady } = require("./settings");

const PRODUCT_OFFER_BY_KEYWORD = `
  query ProductOffer($keyword: String, $sortType: Int, $page: Int, $limit: Int) {
    productOfferV2(keyword: $keyword, sortType: $sortType, page: $page, limit: $limit) {
      nodes {
        itemId
        productName
        imageUrl
        priceMin
        priceMax
        priceDiscountRate
        offerLink
        productLink
        commissionRate
        sales
        shopName
      }
    }
  }
`;

function cfg(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === "") return fallback;
  return v;
}

function getKeywords() {
  return cfg("AUTOPUBLISH_KEYWORDS", "terço,terço de madeira,rosário,medalha,escapulário,imagem de santo,camiseta católica,caneca católica,chaveiro católico,bíblia,bíblia de estudo,catecismo,camiseta gospel,caneca gospel,blusa evangélica,livro evangélico,adesivo gospel,chaveiro gospel,caneca cristã,camiseta cristã,adesivo cristão,pulseira cristã,livro de oração")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function numCfg(name, fallback) {
  const n = parseFloat(cfg(name, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

function formatBRL(value) {
  return "R$ " + Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Formato de preço SEM o símbolo (como no template do grupo: "36,61").
function formatPrice(value) {
  return Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Retorna true se o produto passa nos filtros de desconto/preço/comissão.
function passesFilters(p) {
  const minDiscount = numCfg("AUTOPUBLISH_MIN_DISCOUNT", 20);
  const minPrice = numCfg("AUTOPUBLISH_MIN_PRICE", 5);
  const maxPrice = numCfg("AUTOPUBLISH_MAX_PRICE", 300);
  const minCommission = numCfg("AUTOPUBLISH_MIN_COMMISSION", 0);

  const price = Number(p.priceMin ?? p.priceMax ?? NaN);
  const discount = Number(p.priceDiscountRate ?? 0);
  const commission = Number(p.commissionRate ?? 0); // fração (0.05 = 5%)

  if (!Number.isFinite(price) || price <= 0) return false;
  if (price < minPrice || price > maxPrice) return false;
  if (discount < minDiscount) return false;
  if (commission * 100 < minCommission) return false;
  return true;
}

// Lista de termos cristãos usada para garantir que a oferta realmente é do
// nicho (católico/evangélico), bloqueando ruído vindo de keywords genéricas
// (ex.: "medalha" pode trazer "Pingente Medusa"). Configurável via env.
const DEFAULT_NICHE_TERMS =
  "santo,santa,terço,terco,rosário,rosario,bíblia,biblia,cristão,crista," +
  "católico,catolica,católicos,evangélico,evangelica,gospel,jesus,cruz," +
  "crucifixo,medalha,escapulário,escapulario,oração,oracao,fé,fe," +
  "paroquial,catequese,batismo,comungante,devocional,santíssimo,santissimo," +
  "nossa senhora,aparecida,padre,frei,sagrado";

// Termos de EXCLUSÃO: se o título contiver qualquer um deles, o produto é
// descartado mesmo que tenha um termo cristão — evita ruído de outras
// religiões/ocultismo trazido por palavras-chave genéricas (ex.: "medalha"
// pode virar "Pingente da Medusa", "Olho de Hórus").
const DEFAULT_BLOCK_TERMS =
  "medusa,horus,ankh,olho de horus,buda,budismo,allah,islamica,islamico," +
  "islâmica,islâmico,maomé,maome,umbanda,espiritualismo,pachamama," +
  "satan,demonio,demônio,esqueleto,caveira,oculto,esoterico,esotérico," +
  "mágica,magica,energia,cristal";

function getTerms(name, fallback) {
  return cfg(name, fallback)
    .split(",")
    .map((t) => normalize(t))
    .filter(Boolean);
}

// Remove acentos/caracteres diacríticos ("terço" -> "terco", "Hórus" -> "horus",
// "bíblia" -> "biblia") para a comparação de termos do nicho ser robusta.
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Se REQUIRE_NICHE estiver "true", exige que o título do produto contenha ao
// menos um termo cristão da lista AUTOPUBLISH_NICHE_TERMS. Além disso, se o
// título contiver qualquer termo de AUTOPUBLISH_BLOCK_TERMS, descarta a oferta
// (guarda contra ruído fora do nicho). Tudo normalizado (sem acentos).
function passesNicheFilter(p) {
  const requireNiche = cfg("AUTOPUBLISH_REQUIRE_NICHE", "true").toLowerCase() === "true";
  const title = normalize(p.productName || p.title || "");
  if (!title) return true;

  const blockTerms = getTerms("AUTOPUBLISH_BLOCK_TERMS", DEFAULT_BLOCK_TERMS);
  if (blockTerms.some((t) => title.includes(t))) return false;

  if (!requireNiche) return true;

  const terms = getTerms("AUTOPUBLISH_NICHE_TERMS", DEFAULT_NICHE_TERMS);
  if (terms.length === 0) return true;

  return terms.some((t) => title.includes(t));
}

// Estima o preço "De" (original) a partir do preço atual e do %
// de desconto: original = atual / (1 - desconto/100).
// É uma estimativa — a taxa pode estar arredondada, então pode
// divergir um pouco do "De" exibido no anúncio.
function estimateOriginalPrice(price, discount) {
  if (!discount || discount >= 100 || !price) return null;
  return price / (1 - discount / 100);
}

// Monta a mensagem de oferta seguindo o template definido:
//   🛍️ *[NOME DO PRODUTO]*
//   De R$ ~[PREÇO ANTIGO]~ | Por R$ *[PREÇO]* 💰
//   `🏷️ Cupom: [CUPOM]`
//   👉 COMPRAR: [LINK]
function buildGroupMessage(p, shortTitle, headline, groupFooter) {
  const price = Number(p.priceMin ?? p.priceMax ?? 0);
  const discount = Number(p.priceDiscountRate ?? 0);
  const original = estimateOriginalPrice(price, discount);

  const title = (shortTitle || p.productName || "Achadinho").trim();
  const link = p.offerLink || p.productLink || "";
  const coupon = cfg("AUTOPUBLISH_COUPON", "");

  const lines = [];

  // Nome do produto (negrito)
  if (title) {
    lines.push(`🛍️ *${title}*`);
  }

  // Preço original (riscado) + preço atual (negrito)
  lines.push("");
  if (original) {
    lines.push(`De R$ ~${formatPrice(original)}~ | Por R$ *${formatPrice(price)}* 💰`);
  } else {
    lines.push(`Por R$ *${formatPrice(price)}* 💰`);
  }

  // Cupom (se configurado, em code)
  if (coupon) {
    lines.push("");
    lines.push(`\`🏷️ Cupom: ${coupon}\``);
  }

  // Link de afiliado
  if (link) {
    lines.push("");
    lines.push(`👉 COMPRAR: ${link}`);
  }

  return lines.join("\n");
}

async function searchKeyword(keyword) {
  const sortType = parseInt(cfg("AUTOPUBLISH_SORT_TYPE", "5"), 10); // 5 = comissão
  const limit = parseInt(cfg("AUTOPUBLISH_PAGE_SIZE", "30"), 10);
  const data = await callShopeeApi(PRODUCT_OFFER_BY_KEYWORD, {
    keyword,
    sortType,
    page: 1,
    limit,
  });
  return data?.productOfferV2?.nodes || [];
}

// Busca os produtos, filtra e deduplica por itemId (respeitando o que
// já está cadastrado no site). Retorna a lista de ofertas a publicar.
async function findOffersToPublish() {
  const keywords = getKeywords();
  const seen = new Set();
  const offers = [];

  for (const keyword of keywords) {
    let nodes;
    try {
      nodes = await searchKeyword(keyword);
    } catch (err) {
      console.warn(`auto_publish: falha na busca de "${keyword}":`, err.message);
      continue;
    }

    for (const p of nodes) {
      const itemId = String(p.itemId ?? "");
      if (!itemId || seen.has(itemId)) continue;
      seen.add(itemId);

      if (!passesFilters(p)) continue;
      if (!passesNicheFilter(p)) continue;

      // Não repetir produto já cadastrado no site (pela foto).
      if (p.imageUrl) {
        try {
          const existing = await findActiveByImage(p.imageUrl);
          if (existing) continue;
        } catch (err) {
          console.warn("auto_publish: falha ao checar duplicata por imagem:", err.message);
        }
      }

      offers.push({ ...p, itemId, keyword });
    }
  }

  // Ordena pelo maior desconto primeiro.
  offers.sort((a, b) => Number(b.priceDiscountRate ?? 0) - Number(a.priceDiscountRate ?? 0));

  const maxOffers = parseInt(cfg("AUTOPUBLISH_MAX_OFFERS", "5"), 10);
  return offers.slice(0, maxOffers);
}

async function ensureAffiliateLink(p, keyword) {
  if (p.offerLink) return p.offerLink;
  if (p.productLink) {
    try {
      return await generateAffiliateLink(p.productLink, ["autopublish", keyword]);
    } catch (err) {
      console.warn("auto_publish: falha ao gerar link de afiliado:", err.message);
    }
  }
  return p.productLink || "";
}

// Cadastra a oferta no site (Supabase), reutilizando a mesma lógica de
// insert do bot de curadoria (sem reescrever título via Gemini aqui).
async function saveToSite(p, affiliateLink) {
  const title = p.productName || p.title || "Achadinho";
  const emoji = "🛍️";
  const saved = await insertProduct({
    title: title,
    image: p.imageUrl || "",
    emoji,
    price: Number(p.priceMin ?? p.priceMax ?? 0),
    affiliateLink,
    sourceUrl: p.productLink || null,
    rawTitle: p.productName || title,
  });
  return saved;
}

// Executa a automação inteira: procura, cadastra no site e publica no grupo.
// Retorna um resumo { published, saved, skipped, errors }.
async function runAutoPublish() {
  const ready = await checkPublishReady();
  if (!ready.ok) {
    console.log(`auto_publish: automação desativada (${ready.reason})`);
    return { published: 0, saved: 0, skipped: 0, errors: [], disabled: true, reason: ready.reason };
  }

  const groupId = cfg("GROUP_WHATSAPP_ID", "");
  const sendImage = cfg("AUTOPUBLISH_SEND_IMAGE", "true").toLowerCase() === "true";
  const delayBetween = numCfg("AUTOPUBLISH_SEND_DELAY", 8);
  const dryRun = cfg("AUTOPUBLISH_DRY_RUN", "false").toLowerCase() === "true";
  const groupFooter = cfg("AUTOPUBLISH_GROUP_FOOTER", "");
  const useHeadline = cfg("AUTOPUBLISH_HEADLINE", "true").toLowerCase() === "true";

  if (!dryRun && !groupId) {
    throw new Error("GROUP_WHATSAPP_ID não configurado no .env (ID do grupo de ofertas).");
  }

  const offers = await findOffersToPublish();
  if (offers.length === 0) {
    console.log("auto_publish: nenhuma oferta nova encontrada.");
    return { published: 0, saved: 0, skipped: 0, errors: [] };
  }

  if (dryRun) {
    console.log(`auto_publish (DRY RUN): ${offers.length} ofertas candidatas.`);
    for (const offer of offers) {
      console.log("  -", offer.productName, "|", formatBRL(offer.priceMin ?? offer.priceMax),
        "| desconto", Number(offer.priceDiscountRate ?? 0).toFixed(0) + "%");
    }
    return { published: 0, saved: 0, skipped: 0, errors: [], candidateCount: offers.length };
  }

  const summary = { published: 0, saved: 0, skipped: 0, errors: [] };

  for (const offer of offers) {
    try {
      const affiliateLink = await ensureAffiliateLink(offer, offer.keyword);
      if (!affiliateLink) {
        summary.skipped += 1;
        continue;
      }
      offer.offerLink = affiliateLink;

      // 1) Cadastra no site (Supabase).
      try {
        await saveToSite(offer, affiliateLink);
        summary.saved += 1;
      } catch (err) {
        console.warn("auto_publish: falha ao salvar no site:", err.message);
        summary.skipped += 1;
      }

      // 2) Publica no grupo do WhatsApp.
      // Headline chamativa + título curto do produto, gerados em UMA
      // chamada ao Gemini (mais rápido/confiável). Se a IA falhar, usa
      // o nome cru do produto como título — nunca trava.
      let headline = "";
      let shortTitle = (offer.productName || "").trim();
      if (useHeadline && shortTitle) {
        const texts = await generateOfferTexts(shortTitle);
        headline = texts.headline || "";
        shortTitle = texts.title || shortTitle;
      }

      const message = buildGroupMessage(offer, shortTitle, headline, groupFooter);
      try {
        if (sendImage && offer.imageUrl) {
          await sendWhatsAppImage(groupId, offer.imageUrl, message);
        } else {
          await sendWhatsAppMessage(groupId, message);
        }
        summary.published += 1;
      } catch (err) {
        console.warn("auto_publish: falha ao publicar no grupo:", err.message);
        summary.errors.push(offer.itemId);
      }

      if (delayBetween > 0) {
        await new Promise((r) => setTimeout(r, delayBetween * 1000));
      }
    } catch (err) {
      console.warn("auto_publish: erro na oferta:", err.message);
      summary.errors.push(offer.itemId);
    }
  }

  console.log("auto_publish: resumo", JSON.stringify(summary));
  return summary;
}

// ============================================================
// Saudações (bom dia / boa noite)
// ============================================================

const GREETINGS_MORNING = [
  "*☀️ BOM DIA, BENDITOS! ✝️*\n\nComeçando oficialmente os achadinhos de hoje!",
];

const GREETINGS_NIGHT = [
  "*🌙 ENCERRAMOS POR HOJE! ✝️*\n\nAmanhã voltamos com mais ofertas e promoções. 🔥",
];

function getGreetingMessage(hour) {
  const arr = hour < 15 ? GREETINGS_MORNING : GREETINGS_NIGHT;
  return arr[0];
}

function getGreetingImageUrl(hour) {
  const baseUrl = process.env.SITE_URL || "";
  if (hour < 15) {
    return baseUrl ? `${baseUrl}/assets/bom-dia.jpg` : "/assets/bom-dia.jpg";
  }
  return baseUrl ? `${baseUrl}/assets/boa-noite.jpg` : "/assets/boa-noite.jpg";
}

async function runGreeting(hour) {
  const ready = await checkPublishReady();
  if (!ready.ok) {
    console.log(`auto_publish: saudação desativada (${ready.reason})`);
    return { sent: 0, disabled: true, reason: ready.reason };
  }

  const groupId = cfg("GROUP_WHATSAPP_ID", "");
  const dryRun = cfg("AUTOPUBLISH_DRY_RUN", "false").toLowerCase() === "true";

  if (!groupId && !dryRun) {
    throw new Error("GROUP_WHATSAPP_ID não configurado.");
  }

  const message = getGreetingMessage(hour);
  const imageUrl = getGreetingImageUrl(hour);

  if (dryRun) {
    console.log(`auto_publish (DRY RUN greeting): ${message}`);
    return { sent: 0 };
  }

  if (imageUrl) {
    await sendWhatsAppImage(groupId, imageUrl, message);
  } else {
    await sendWhatsAppMessage(groupId, message);
  }
  console.log("auto_publish: saudação enviada:", message.slice(0, 60) + "...");
  return { sent: 1 };
}

module.exports = { runAutoPublish, findOffersToPublish, buildGroupMessage, passesFilters, passesNicheFilter, runGreeting, getGreetingMessage, getGreetingImageUrl };
