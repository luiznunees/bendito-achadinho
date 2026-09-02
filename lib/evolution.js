// ============================================================
// Envio de mensagens de volta pro WhatsApp via Evolution API
// (a instância roda na VPS do usuário, isso aqui só chama a API dela).
// ============================================================

async function sendWhatsAppMessage(number, text) {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const instance = process.env.EVOLUTION_INSTANCE_NAME;
  const token = process.env.EVOLUTION_INSTANCE_TOKEN;

  if (!baseUrl || !instance || !token) {
    console.warn("evolution.sendWhatsAppMessage: variáveis de ambiente não configuradas, não enviei nada");
    return;
  }

  const url = `${baseUrl.replace(/\/$/, "")}/message/sendText/${instance}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: token,
    },
    body: JSON.stringify({ number, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("evolution.sendWhatsAppMessage: falha ao enviar", res.status, body);
  }
}

async function sendWhatsAppImage(number, imageUrl, caption) {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const instance = process.env.EVOLUTION_INSTANCE_NAME;
  const token = process.env.EVOLUTION_INSTANCE_TOKEN;

  if (!baseUrl || !instance || !token) {
    console.warn("evolution.sendWhatsAppImage: variáveis de ambiente não configuradas");
    return;
  }

  const url = `${baseUrl.replace(/\/$/, "")}/message/sendMedia/${instance}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: token,
    },
    body: JSON.stringify({ number, mediatype: "image", media: imageUrl, caption: caption || "" }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("evolution.sendWhatsAppImage: falha ao enviar", res.status, body);
  }
}

module.exports = { sendWhatsAppMessage, sendWhatsAppImage };
