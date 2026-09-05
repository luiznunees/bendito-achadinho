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
const { generateOfferTexts, verifyNiche } = require("./gemini");
const { checkPublishReady, getAllSettings } = require("./settings");
const { insertLog, acquireSlot, finishSlot } = require("./publish_log");
const { nowBRTMinutes } = require("./schedule");

// Horário do slot em BRT (Brasília). Usado para registrar no log do dia
// a que horário local essa execução corresponde.
function slotHourBRT(date = new Date()) {
  return new Date(date.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).getHours();
}

// Data local (BRT) em YYYY-MM-DD, usada como chave do dia no log.
function todayBRT(date = new Date()) {
  return new Date(date.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).toISOString().slice(0, 10);
}

function fireAndForgetLog(entry) {
  insertLog(entry).catch(() => {});
}

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

// Caching das configurações vindas do Supabase (tabela settings) + env.
// O painel admin é a fonte de verdade: o que salvar lá vale para o
// pipeline. Carregado no início de cada execução (runAutoPublish/runGreeting).
let _settings = null;
async function loadPipelineSettings() {
  try {
    _settings = await getAllSettings();
  } catch {
    _settings = {};
  }
}

function cfg(name, fallback) {
  if (_settings && name in _settings) {
    const v = _settings[name];
    if (v === undefined || v === null || String(v).trim() === "") return fallback;
    return v;
  }
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
// opts: { maxOffers } limita quantas ofertas esta execução publica.
//
// TRAVA DE SLOT: antes do trabalho pesado, o slot do minuto atual é
// reservado no banco (slot_key). Se outro processo (job de janela + cron
// de segurança) já reservou, esta execução para imediatamente — sem
// duplicar o envio do mesmo minuto.
async function runAutoPublish(opts = {}) {
  await loadPipelineSettings();

  const ready = await checkPublishReady();
  const runDate = todayBRT();
  const slotMinute = nowBRTMinutes();
  const slotKey = `products|${runDate}|${slotMinute}`;

  if (!ready.ok) {
    console.log(`auto_publish: automação desativada (${ready.reason})`);
    const claim = await acquireSlot(slotKey, "products", slotHourBRT());
    if (claim === "claimed") {
      await finishSlot(slotKey, {
        status: "disabled",
        detail: `automação ${ready.reason}`,
      });
    } else {
      fireAndForgetLog({
        runDate,
        slotHour: slotHourBRT(),
        type: "products",
        status: "disabled",
        detail: `automação ${ready.reason}`,
      });
    }
    return { published: 0, saved: 0, skipped: 0, errors: [], disabled: true, reason: ready.reason };
  }

  const groupId = cfg("GROUP_WHATSAPP_ID", "");
  const sendImage = cfg("AUTOPUBLISH_SEND_IMAGE", "true").toLowerCase() === "true";
  const dryRun = cfg("AUTOPUBLISH_DRY_RUN", "false").toLowerCase() === "true";
  const groupFooter = cfg("AUTOPUBLISH_GROUP_FOOTER", "");
  const useHeadline = cfg("AUTOPUBLISH_HEADLINE", "true").toLowerCase() === "true";

  if (!dryRun && !groupId) {
    throw new Error("GROUP_WHATSAPP_ID não configurado no .env (ID do grupo de ofertas).");
  }

  // Reserva o slot do minuto. Se outro processo já reservou, não faz nada.
  const claim = await acquireSlot(slotKey, "products", slotHourBRT());
  if (claim === "skipped") {
    console.log("auto_publish: slot já processado por outro processo neste minuto.");
    return { published: 0, saved: 0, skipped: 0, errors: [], action: "slot_taken" };
  }
  const claimMode = claim; // "claimed" (atualiza a linha) | "fallback" (escreve log novo)

  // Escreve o resultado final na linha reservada (ou log novo no fallback).
  function finalize(entry) {
    if (claimMode === "claimed") return finishSlot(slotKey, entry);
    return fireAndForgetLog({ ...entry, runDate, slotHour: slotHourBRT(), type: "products" });
  }

  const offers = await findOffersToPublish();
  const limit = opts.maxOffers > 0 ? Math.min(opts.maxOffers, offers.length) : offers.length;
  const selected = offers.slice(0, limit);
  if (selected.length === 0) {
    console.log("auto_publish: nenhuma oferta nova encontrada.");
    finalize({
      status: "no_offers",
      detail: "nenhuma oferta nova encontrada na Shopee",
    });
    return { published: 0, saved: 0, skipped: 0, errors: [] };
  }

  if (dryRun) {
    console.log(`auto_publish (DRY RUN): ${offers.length} ofertas candidatas.`);
    for (const offer of offers) {
      console.log("  -", offer.productName, "|", formatBRL(offer.priceMin ?? offer.priceMax),
        "| desconto", Number(offer.priceDiscountRate ?? 0).toFixed(0) + "%");
    }
    finalize({
      status: "dry_run",
      detail: `${offers.length} ofertas candidatas (simulação)`,
      publishedCount: 0,
      savedCount: 0,
    });
    return { published: 0, saved: 0, skipped: 0, errors: [], candidateCount: offers.length };
  }

  const summary = { published: 0, saved: 0, skipped: 0, errors: [] };

  for (let i = 0; i < selected.length; i++) {
    const offer = selected[i];
    try {
      const affiliateLink = await ensureAffiliateLink(offer, offer.keyword);
      if (!affiliateLink) {
        summary.skipped += 1;
        continue;
      }
      offer.offerLink = affiliateLink;

      // Juiz de nicho (Gemini): barra produto genérico com palavra
      // religiosa de enfeite no título (ex.: "blusa academia moda
      // evangélica"). Fail-open: se a IA falhar, aceita.
      const nicheOk = await verifyNiche(String(offer.productName || offer.title || ""));
      if (!nicheOk) {
        console.log("auto_publish: fora do nicho, pulado:", (offer.productName || "").slice(0, 80));
        summary.skipped += 1;
        continue;
      }

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
    } catch (err) {
      console.warn("auto_publish: erro na oferta:", err.message);
      summary.errors.push(offer.itemId);
    }
  }

  console.log("auto_publish: resumo", JSON.stringify(summary));
  finalize({
    status: summary.published > 0 ? "sent" : summary.errors.length > 0 ? "error" : "skipped",
    detail:
      summary.published > 0
        ? `${summary.published} oferta(s) enviada(s) com foto`
        : summary.errors.length > 0
          ? `${summary.errors.length} falha(s) no envio`
          : "nada enviado",
    publishedCount: summary.published,
    savedCount: summary.saved,
    skippedCount: summary.skipped,
    errorCount: summary.errors.length,
    shopeeItemIds: selected.filter((o) => !summary.errors.includes(String(o.itemId))).map((o) => Number(o.itemId) || null).filter((x) => x !== null),
  });
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
  await loadPipelineSettings();

  const runDate = todayBRT();
  const slotKey = `greeting|${runDate}|${Number(hour) * 60}`;

  const ready = await checkPublishReady();
  if (!ready.ok) {
    console.log(`auto_publish: saudação desativada (${ready.reason})`);
    const claim = await acquireSlot(slotKey, "greeting", hour);
    if (claim === "claimed") {
      await finishSlot(slotKey, { status: "disabled", detail: `automação ${ready.reason}` });
    } else {
      fireAndForgetLog({
        runDate,
        slotHour: hour,
        type: "greeting",
        status: "disabled",
        detail: `automação ${ready.reason}`,
      });
    }
    return { sent: 0, disabled: true, reason: ready.reason };
  }

  const groupId = cfg("GROUP_WHATSAPP_ID", "");
  const dryRun = cfg("AUTOPUBLISH_DRY_RUN", "false").toLowerCase() === "true";

  if (!groupId && !dryRun) {
    throw new Error("GROUP_WHATSAPP_ID não configurado.");
  }

  // Trava do slot da saudação (8h ou 23h): um processo só.
  const claim = await acquireSlot(slotKey, "greeting", hour);
  if (claim === "skipped") {
    console.log(`auto_publish: saudação ${hour}h já processada por outro processo.`);
    return { sent: 0, action: "slot_taken" };
  }
  const claimMode = claim;

  const message = getGreetingMessage(hour);
  const imageUrl = getGreetingImageUrl(hour);

  if (dryRun) {
    console.log(`auto_publish (DRY RUN greeting): ${message}`);
    if (claimMode === "claimed") await finishSlot(slotKey, { status: "dry_run", detail: "teste" });
    return { sent: 0 };
  }

  if (imageUrl) {
    await sendWhatsAppImage(groupId, imageUrl, message);
  } else {
    await sendWhatsAppMessage(groupId, message);
  }
  console.log("auto_publish: saudação enviada:", message.slice(0, 60) + "...");
  if (claimMode === "claimed") {
    await finishSlot(slotKey, {
      status: "sent",
      detail: hour < 15 ? "bom dia" : "boa noite",
      publishedCount: 1,
    });
  } else {
    fireAndForgetLog({
      runDate,
      slotHour: hour,
      type: "greeting",
      status: "sent",
      detail: hour < 15 ? "bom dia" : "boa noite",
      publishedCount: 1,
    });
  }
  return { sent: 1 };
}

module.exports = { runAutoPublish, findOffersToPublish, buildGroupMessage, passesFilters, passesNicheFilter, runGreeting, getGreetingMessage, getGreetingImageUrl, loadPipelineSettings, cfg };
