// ============================================================
// Webhook do Evolution API — recebe mensagens do WhatsApp, e se o
// dono mandar um link da Shopee, cadastra o produto no site.
//
// URL configurada no Evolution: https://SEU_DOMINIO/api/whatsapp-webhook?token=WEBHOOK_SHARED_SECRET
// ============================================================

const { sendWhatsAppMessage } = require("../lib/evolution");
const { curateFromUrl, CurateError, extractShopeeLink } = require("../lib/curate");

const CURATE_ERROR_MESSAGES = {
  PRODUCT_INFO_FAILED: "deu ruim pra buscar esse produto na Shopee 😭 tenta de novo em instantes?",
  AFFILIATE_LINK_FAILED: "deu ruim pra gerar o link de afiliado 😭 tenta de novo em instantes?",
  INCOMPLETE_INFO: "consegui achar o produto mas não peguei o preço direitinho 😅 tenta copiar o link direto da página do produto (não o link de compartilhar) e manda de novo.",
  DB_FAILED: "peguei os dados certinho mas deu erro pra salvar no banco 😬 já fui avisado, tenta de novo daqui a pouco.",
};

function formatBRL(value) {
  return "R$ " + Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// O número no remoteJid do WhatsApp às vezes vem com o "9" extra do
// celular brasileiro, às vezes não — comparamos as duas variantes pra
// não trancar o próprio dono fora do bot dele.
function phoneVariants(number) {
  const digits = String(number || "").replace(/\D/g, "");
  const variants = new Set([digits]);
  const match = digits.match(/^55(\d{2})(\d{8,9})$/);
  if (match) {
    const [, ddd, rest] = match;
    if (rest.length === 9 && rest.startsWith("9")) {
      variants.add(`55${ddd}${rest.slice(1)}`);
    } else if (rest.length === 8) {
      variants.add(`55${ddd}9${rest}`);
    }
  }
  return variants;
}

function isOwner(senderNumber) {
  const owner = process.env.OWNER_WHATSAPP_NUMBER;
  if (!owner) return false;
  const ownerVariants = phoneVariants(owner);
  const senderVariants = phoneVariants(senderNumber);
  for (const v of senderVariants) {
    if (ownerVariants.has(v)) return true;
  }
  return false;
}

// O WhatsApp às vezes endereça a conversa por "LID" (um pseudo-ID de
// privacidade, remoteJid tipo "123...@lid") em vez do número de telefone
// direto — nesse caso o número real vem à parte em `remoteJidAlt`. Sem
// isso, o bot nunca reconhece o dono (foi exatamente o bug: mensagens
// reais do WhatsApp chegavam como @lid e caíam silenciosamente aqui).
function resolvePhoneNumber(key) {
  const remoteJid = key?.remoteJid || "";
  if (remoteJid.endsWith("@lid") && key?.remoteJidAlt) {
    return key.remoteJidAlt.split("@")[0];
  }
  return remoteJid.split("@")[0];
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const expectedToken = process.env.WEBHOOK_SHARED_SECRET;
  if (!expectedToken || req.query.token !== expectedToken) {
    res.status(401).end();
    return;
  }

  // A partir daqui, sempre respondemos 200 — nunca queremos que o
  // Evolution reentregue a mesma mensagem por causa de um erro nosso.
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (body?.event !== "messages.upsert") {
      res.status(200).end();
      return;
    }

    const data = body.data;

    if (data?.key?.fromMe) {
      res.status(200).end();
      return;
    }

    const remoteJid = data?.key?.remoteJid || "";
    if (remoteJid.endsWith("@g.us")) {
      res.status(200).end();
      return;
    }

    const senderNumber = resolvePhoneNumber(data?.key);
    if (!isOwner(senderNumber)) {
      // Não responde nada pra quem não é o dono — nem confirma que é um bot.
      res.status(200).end();
      return;
    }

    const text = data?.message?.conversation || data?.message?.extendedTextMessage?.text || "";
    const shopeeUrl = extractShopeeLink(text);

    if (!shopeeUrl) {
      await sendWhatsAppMessage(senderNumber, "não encontrei um link da Shopee nessa mensagem 👀 manda o link do produto que eu cadastro!");
      res.status(200).end();
      return;
    }

    let saved;
    try {
      saved = await curateFromUrl(shopeeUrl);
    } catch (err) {
      console.error("whatsapp-webhook: falha na curadoria:", err);
      const friendly = err instanceof CurateError
        ? CURATE_ERROR_MESSAGES[err.code] || "deu erro aqui, tenta de novo 😬"
        : "deu erro aqui, tenta de novo 😬";
      await sendWhatsAppMessage(senderNumber, friendly);
      res.status(200).end();
      return;
    }

    const prefix = saved.duplicate ? "🔁 Esse já estava cadastrado" : "✅ Cadastrado";
    await sendWhatsAppMessage(senderNumber, `${prefix}: ${saved.title} — ${formatBRL(saved.price)}`);
    res.status(200).end();
  } catch (err) {
    console.error("whatsapp-webhook: erro inesperado:", err);
    res.status(200).end();
  }
};
