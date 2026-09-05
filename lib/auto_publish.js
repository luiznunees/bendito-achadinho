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
const { insertLog, acquireSlot, finishSlot, getSentShopeeItemIds } = require("./publish_log");
const { nowBRTMinutes, computeDispatchTimes } = require("./schedule");
const { getDayPlan, replaceDayPlan } = require("./plan");

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
  return cfg("AUTOPUBLISH_KEYWORDS", "terço,terço de madeira,rosário,medalha,escapulário,imagem de santo,camiseta católica,caneca católica,chaveiro católico,bíblia,bíblia de estudo,catecismo,camiseta gospel,caneca gospel,blusa evangélica,livro evangélico,chaveiro gospel,caneca cristã,camiseta cristã,pulseira cristã,livro de oração")
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
  "mágica,magica,energia,cristal,adesivo,tapa bumbum,tapa-bumbum,bumbum," +
  "legging,lingerie,moda íntima";

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

// ============================================================
// RANKING DE QUALIDADE DA OFERTA
//
// Antes, a seleção ordenava só por % de desconto — o primeiro da
// lista (o único enviado no disparo espaçado) acabava sendo sempre
// item barato/zum, e produtos bons e relevantes não subiam.
//
// Agora cada oferta recebe uma nota ponderada (0..1):
//   nicho forte  → termos religiosos explícitos no título (2+ = 1.0)
//   popularidade → log10 das vendas (10=0.3, 100=0.7, 1000=1.0)
//   desconto     → % de desconto normalizado (60%+ = 1.0)
//   comissão     → % de comissão normalizado (15%+ = 1.0)
//   preço        → faixa "achadinho de verdade" (15–150 = 1.0; barato
//                  demais e caro demais caem a nota)
//
// Pesos configuráveis (settings/env): AUTOPUBLISH_RANK_W_* (somam ~1).
// ============================================================
function nicheStrength(p) {
  const title = normalize(p.productName || p.title || "");
  if (!title) return 0;
  const terms = getTerms("AUTOPUBLISH_NICHE_TERMS", DEFAULT_NICHE_TERMS);
  if (terms.length === 0) return 0.5;
  const hits = terms.filter((t) => title.includes(t)).length;
  return Math.min(1, hits / 2);
}

function salesScore(p) {
  const sales = Number(p.sales ?? 0);
  if (sales <= 0) return 0;
  return Math.min(1, Math.log10(sales + 1) / 3);
}

function discountScore(p) {
  const d = Number(p.priceDiscountRate ?? 0);
  return Math.min(1, d / 60);
}

function commissionScore(p) {
  const c = Number(p.commissionRate ?? 0) * 100;
  return Math.min(1, c / 15);
}

function priceScore(p) {
  const price = Number(p.priceMin ?? p.priceMax ?? 0);
  if (price <= 0) return 0;
  if (price <= 8) return 0.1; // zum/lixo barato demais
  if (price < 20) return 0.35 + ((price - 8) / 12) * 0.65;
  if (price <= 120) return 1; // faixa ideal "achado de verdade"
  if (price <= 180) return 0.7;
  if (price <= 250) return 0.45;
  if (price <= 300) return 0.3;
  return 0.15;
}

function rankOfferScore(p) {
  return (
    numCfg("AUTOPUBLISH_RANK_W_NICHE", 0.3) * nicheStrength(p) +
    numCfg("AUTOPUBLISH_RANK_W_SALES", 0.25) * salesScore(p) +
    numCfg("AUTOPUBLISH_RANK_W_DISCOUNT", 0.15) * discountScore(p) +
    numCfg("AUTOPUBLISH_RANK_W_COMMISSION", 0.05) * commissionScore(p) +
    numCfg("AUTOPUBLISH_RANK_W_PRICE", 0.25) * priceScore(p)
  );
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
// já está cadastrado no site e o que foi enviado nos últimos dias).
// Retorna até `limit` ofertas ranqueadas.
async function collectOffers(limit) {
  const keywords = getKeywords();
  const seen = new Set();

  // Não repetir oferta já enviada dentro das últimas N dias
  // (AUTOPUBLISH_NO_REPEAT_DAYS, padrão 3). 0 desliga o filtro.
  const noRepeatDays = Math.max(0, parseInt(cfg("AUTOPUBLISH_NO_REPEAT_DAYS", "3"), 10) || 3);
  const recentlySent = noRepeatDays > 0 ? await getSentShopeeItemIds(noRepeatDays) : new Set();

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

      if (recentlySent.has(itemId)) continue;

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

  // Ordena pela nota de qualidade (nicho forte + popular + preço justo).
  offers.sort((a, b) => rankOfferScore(b) - rankOfferScore(a));

  return offers.slice(0, limit);
}

// Seleção normal (por execução): top AUTOPUBLISH_MAX_OFFERS por ranking.
async function findOffersToPublish() {
  const maxOffers = Math.max(1, parseInt(cfg("AUTOPUBLISH_MAX_OFFERS", "5"), 10) || 5);
  return collectOffers(maxOffers);
}

// ============================================================
// PLANO DO DIA
//
// No começo do dia, todas as ofertas do dia inteiro são selecionadas
// de uma vez (auto_publish_plan) e cada disparo espaçado envia a
// oferta da sua posição — o grupo não re-busca a Shopee a cada 15 min
// nem varia entre um run e outro. O plano respeita os mesmos filtros
// do pipeline (nicho, preço, sem repetir enviados nos últimos dias).
//
// Retorno:
//   array -> ofertas na ordem do dia (plano existente ou recém-montado)
//   null  -> falha/tabela ausente (segue com a seleção normal)
// ============================================================
async function ensureDayPlan(runDate) {
  try {
    const plan = await getDayPlan(runDate);
    if (plan === null) return null; // erro/tabela ausente → seleção normal
    if (plan.length > 0) return plan; // já montado hoje

    const dispatch = computeDispatchTimes(cfg);
    const size = Math.min(Math.max(dispatch.numDispatches || 1, 1), 90);

    // Pool grande + mix por categoria/loja (em vez do top cru, que virava
    // só caneca/camiseta do mesmo vendedor).
    const maxPerSeller = Math.max(1, parseInt(cfg("AUTOPUBLISH_PLAN_MAX_PER_SELLER", "3"), 10) || 3);
    const pool = await collectOffers(Math.min(Math.max(size * 4, 40), 200));
    const planDraft = buildDiversePlan(pool, size, maxPerSeller);
    if (planDraft.length === 0) return [];

    await replaceDayPlan(runDate, planDraft);
    const byCat = planDraft.reduce((acc, o) => {
      acc[o.category] = (acc[o.category] || 0) + 1;
      return acc;
    }, {});
    console.log(`auto_publish: plano do dia ${runDate} montado com ${planDraft.length} ofertas; mix`, JSON.stringify(byCat));
    return planDraft;
  } catch (err) {
    console.warn("auto_publish: sem plano do dia (usando seleção normal):", err.message);
    return null;
  }
}

// ============================================================
// DIVERSIFICAÇÃO DO PLANO DO DIA
//
// Pegar o top-N por nota pura faz o grupo encher de repetição
// (muitas canecas/camisetas do mesmo vendedor e falta de decoração
// e utilidades). Aqui o plano é montado com MIX por categoria e
// limite por loja, em vez do top cru.
//
// Categorias (detectadas pelo título):
//   caneca | camiseta | decoracao | devocional | livro | util | outro
//
// Mix alvo do dia (ajustável nas constantes CATEGORY_MIX):
//   devocional 30% | camiseta 18% | decoracao 18% | util 12% |
//   livro 12% | caneca 10% | resto preenche com o melhor que sobrar.
// ============================================================
const CATEGORY_MIX = {
  devocional: 0.3,
  camiseta: 0.18,
  decoracao: 0.18,
  util: 0.12,
  livro: 0.12,
  caneca: 0.1,
};

const CATEGORY_ORDER = ["devocional", "livro", "decoracao", "camiseta", "util", "caneca", "outro"];

function offerCategory(p) {
  const t = normalize(p.productName || p.title || "");
  if (!t) return "outro";
  if (/\b(caneca|canecas|x[íi]cara|xicara|copo|copos|garrafa)\b/.test(t)) return "caneca";
  if (/\b(camiseta|camisetas|camisa|camisas|blusa|streetwear|polo)\b/.test(t)) return "camiseta";
  if (/\b(quadro|quadros|p[oó]ster|poster|plaquinha|plaqueta|placa|lumin[áa]ria|bandeira|tapete|almofada|decora[cç][ãa]o|enfeite|rel[oó]gio|est[áa]tua|estatueta|imagem de gesso|ornament)\b/.test(t)) return "decoracao";
  if (/\b(ter[cç]o|terco|ros[áa]rio|rosario|medalha|esca[pb]ul[áa]rio|escapulario|crucifixo|pulseira|chaveiro|pingente|corrente|brinco|anel|j[oó]ias|j[oó]ia|cord[ãa]o)\b/.test(t)) return "devocional";
  if (/\b(b[ií]blia|biblia|livro|livros|catecismo|evangelho|devocion[áa]rio|devocionario|oracion[áa]rio)\b/.test(t)) return "livro";
  if (/\b(marcador|marcadores|aba|abas|caderno|cadernos|agenda|caneta|estojo|organizador|capa de b[ií]blia|kit marcador)\b/.test(t)) return "util";
  return "outro";
}

// Título igual/similar = mesmo produto em variação (cor, "vários modelos"),
// que virava uma caneca repetida 3x no dia. Jaccard de bigramas de tokens:
// >= SIM_TITLE_THRESHOLD é tratado como repetição e descartado do plano.
const SIM_TITLE_THRESHOLD = 0.6;
const SIM_TITLE_STOP = new Set(["com", "para", "centimetros", "novo", "pro", "kit", "feito", "enviado", "lindo", "linda", "pode", "brasil", "promocao", "original", "variedades", "aderir", "avaliacos"]);
function titleTokens(t) {
  return normalize(t)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !SIM_TITLE_STOP.has(w));
}
function titleSimilar(a, b) {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.length < 3 || tb.length < 3) return ta.join(" ") === tb.join(" ");
  const bigrams = (t) => {
    const s = new Set();
    for (let i = 0; i + 1 < Math.min(t.length, 14); i++) s.add(t[i] + " " + t[i + 1]);
    return s;
  };
  const sa = bigrams(ta);
  const sb = bigrams(tb);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union > 0 && inter / union >= SIM_TITLE_THRESHOLD;
}

// Monta o plano do dia com mix por categoria e no máx. N itens por loja.
// pool vem JÁ ranqueado (melhor → pior). Retorna lista intercalada.
function buildDiversePlan(pool, size, maxPerSeller) {
  const items = pool.map((p) => ({ ...p, category: offerCategory(p) }));
  const byCat = {};
  for (const c of CATEGORY_ORDER) byCat[c] = [];
  for (const it of items) byCat[it.category].push(it);

  const sellerCount = new Map();
  const catShopSeen = new Set(); // (categoria+loja) → evita 2 canecas do mesmo vendedor
  const chosenTitles = [];
  const isSimilarToChosen = (it) => {
    const t = it.productName || it.title || "";
    if (!t) return false;
    return chosenTitles.some((c) => titleSimilar(t, c));
  };
  const canUse = (it) => {
    if (isSimilarToChosen(it)) return false;
    // Máx. 1 item por loja DENTRO da mesma categoria (evita 3 canecas
    // iguais do mesmo vendedor — variação de cor = mesmo produto).
    const cat = it.category || "outro";
    const shop = it.shopName || it.shopId || "";
    if (shop && catShopSeen.has(`${cat}::${shop}`)) return false;
    if (!maxPerSeller) return true; // 0 = sem limite de loja
    if (!shop) return true;
    return (sellerCount.get(shop) || 0) < maxPerSeller;
  };
  const use = (it) => {
    const s = it.shopName || it.shopId || "";
    if (s) sellerCount.set(s, (sellerCount.get(s) || 0) + 1);
    const cat = it.category || "outro";
    if (s) catShopSeen.add(`${cat}::${s}`);
    chosenTitles.push(it.productName || it.title || "");
  };

  // 1) Cotas por categoria (do melhor de cada uma).
  const chosen = [];
  const quota = {};
  for (const c of CATEGORY_ORDER) {
    if (CATEGORY_MIX[c]) quota[c] = Math.floor(size * CATEGORY_MIX[c]);
    else quota[c] = 0;
  }
  let remaining = size;
  const pickFrom = (cat, howMany, { alsoAny = false } = {}) => {
    const collect = (cat2, howMany2, alsoAny2) => {
      const got = [];
      const cursors = byCat[cat2] || [];
      let i = 0;
      while (got.length < howMany2 && i < items.length) {
        const cand = alsoAny2 ? items[i] : cursors[i];
        if (cand && canUse(cand) && !chosen.includes(cand) && !got.includes(cand)) {
          got.push(cand);
          use(cand);
        }
        i += 1;
      }
      if (got.length < howMany2 && !alsoAny2) {
        // categoria não tem o suficiente → completa do pool geral.
        const extra = collect(cat2, howMany2 - got.length, true);
        got.push(...extra);
      }
      return got;
    };
    const got = collect(cat, howMany, alsoAny);
    // Commit único em `chosen` — a chamada recursiva NÃO empurra de novo,
    // senão itens do pool reaproveitados viravam duplicatas no plano.
    if (!alsoAny) {
      for (const g of got) chosen.push(g);
      remaining = size - chosen.length;
    }
    return got;
  };

  for (const c of CATEGORY_ORDER) {
    if (remaining <= 0) break;
    pickFrom(c, Math.min(quota[c] || 0, remaining));
  }
  // 2) Sobras do dia: preenche do melhor restante (qualquer categoria).
  const leftover = [];
  for (const it of items) {
    if (leftover.length >= remaining) break;
    if (!chosen.includes(it) && canUse(it)) {
      leftover.push(it);
      use(it);
    }
  }
  chosen.push(...leftover);

  // 3) Intercala as categorias (round-robin) pra não empilhar 5 canecas
  //    seguidas — cada hora alterna devocional/livro/deco/camiseta/util.
  const final = [];
  const ptr = {};
  for (const c of CATEGORY_ORDER) ptr[c] = 0;
  const split = {};
  for (const c of CATEGORY_ORDER) split[c] = [];
  for (const it of chosen) split[it.category].push(it);

  while (final.length < chosen.length) {
    let added = false;
    for (const c of CATEGORY_ORDER) {
      const arr = split[c];
      if (ptr[c] < arr.length) {
        final.push(arr[ptr[c]]);
        ptr[c] += 1;
        added = true;
      }
    }
    if (!added) break;
  }

  return final.slice(0, size);
}

// ============================================================
// SELEÇÃO DO DISPARO (aleatória dentro do top-N)
//
// Enviar sempre a oferta de maior nota faz o grupo ficar repetido e
// nunca variar entre itens bons/caros/baratos. Aqui o candidato do
// disparo é SORTEADO dentro do top-N por ranking (AUTOPUBLISH_RANK_POOL),
// ponderado pela nota: os melhores têm a maior chance, mas qualquer
// um do top pode sair — renova a escala de ofertas a cada disparo.
//
// Retorna a oferta selecionada, ou null se a lista estiver vazia.
// ============================================================
function pickCandidate(offers) {
  if (!offers || offers.length === 0) return null;

  const poolSize = Math.max(1, parseInt(cfg("AUTOPUBLISH_RANK_POOL", "10"), 10) || 10);
  const pool = offers.slice(0, poolSize);

  // Peso suavizado (ranking + aleatoriedade): nota elevada a 1.5 amplia a
  // chance dos melhores, mas sem viciar sempre no topo — qualquer um do
  // pool pode sair, renova o grupo entre bons/caros/baratos.
  const weights = pool.map((o) => Math.max(0.1, Math.pow(rankOfferScore(o), 1.5) + 0.1));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
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

  // ---- PLANO DO DIA (disparos espaçados) ----
  // No começo do dia o plano é montado de uma vez; cada disparo envia a
  // oferta da sua posição na ordem do dia (determinístico e sem depender
  // de re-buscar a Shopee). Se o plano falhar/tabela ausente, cai para a
  // seleção normal por ranking. Testes/manuais com maxOffers>1 seguem
  // a seleção normal sempre.
  let selected = null;
  let planMeta = null;
  if (!opts.maxOffers || opts.maxOffers <= 1) {
    const plan = await ensureDayPlan(runDate);
    if (plan) {
      const times = computeDispatchTimes(cfg).times;
      const idx = times.findIndex((t) => Math.abs(t - slotMinute) <= 3);
      planMeta = { total: plan.length, idx };
      if (idx >= 0 && plan[idx]) selected = [plan[idx]];
      if (idx >= 0 && !selected) {
        console.log("auto_publish: plano do dia esgotado nesta rodada.");
        finalize({
          status: "no_offers",
          detail: `plano do dia esgotado (${plan.length} ofertas planejadas)`,
        });
        return { published: 0, saved: 0, skipped: 0, errors: [] };
      }
    }
  }

  if (!selected) {
    const offers = await findOffersToPublish();
    const limit = opts.maxOffers > 0 ? Math.min(opts.maxOffers, offers.length) : offers.length;

    // No disparo espaçado (1 oferta), o candidato é SORTEADO dentro do
    // top-N por ranking (diversifica entre bom/caro/barato). Se for pedido
    // mais de 1 (teste/manual), usa a ordem por ranking.
    if (limit <= 1) {
      const chosen = pickCandidate(offers);
      selected = chosen ? [chosen] : [];
    } else {
      selected = offers.slice(0, limit);
    }
  }

  if (selected.length === 0) {
    console.log("auto_publish: nenhuma oferta nova encontrada.");
    finalize({
      status: "no_offers",
      detail: "nenhuma oferta nova encontrada na Shopee",
    });
    return { published: 0, saved: 0, skipped: 0, errors: [] };
  }

  if (dryRun) {
    const ctx = planMeta
      ? `plano do dia (${planMeta.total} ofertas; disparo #${planMeta.idx + 1})`
      : `seleção normal (top ${Math.max(1, parseInt(cfg("AUTOPUBLISH_RANK_POOL", "8"), 10) || 8)})`;
    console.log(`auto_publish (DRY RUN): ${ctx}:`);
    for (const offer of selected) {
      console.log("  -", offer.productName, "|", formatBRL(offer.priceMin ?? offer.priceMax),
        "| desconto", Number(offer.priceDiscountRate ?? 0).toFixed(0) + "%",
        "| vendas", Number(offer.sales ?? 0),
        "| nota", rankOfferScore(offer).toFixed(2));
    }
    finalize({
      status: "dry_run",
      detail: planMeta
        ? `plano do dia: ${planMeta.total} ofertas, disparo #${planMeta.idx + 1} (simulação)`
        : `${selected.length} ofertas candidatas (simulação)`,
      publishedCount: 0,
      savedCount: 0,
    });
    return { published: 0, saved: 0, skipped: 0, errors: [], candidateCount: planMeta ? planMeta.total : selected.length };
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

module.exports = { runAutoPublish, findOffersToPublish, buildGroupMessage, passesFilters, passesNicheFilter, runGreeting, getGreetingMessage, getGreetingImageUrl, loadPipelineSettings, cfg, rankOfferScore, pickCandidate, ensureDayPlan };
