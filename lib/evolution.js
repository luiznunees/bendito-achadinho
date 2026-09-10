// ============================================================
// Envio de mensagens de volta pro WhatsApp via Evolution API
// (a instância roda na VPS do usuário, isso aqui só chama a API dela).
//
// Resiliência: cada envio tem timeout (TIME::) e 1 retry. Se a falha
// persistir, LANÇA erro (o pipeline registra no log e não "engole" a
// oferta como se tivesse enviado). Resposta não-2xx também vira erro
// com o corpo, pra dar visibilidade no status do painel.
// ============================================================

const TIMEOUT_MS = 45000;

async function fetchWithRetry(url, options, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (res.ok) return res;
      const body = await res.text().catch(() => "");
      lastError = new Error(`Evolution HTTP ${res.status}: ${String(body).slice(0, 200)}`);
    } catch (err) {
      lastError = err.name === "AbortError" ? new Error("Evolution timeout") : err;
      console.warn(`evolution: tentativa ${attempt + 1} falhou: ${lastError.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Evolution falhou sem causa informada");
}

async function sendWhatsAppMessage(number, text) {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const instance = process.env.EVOLUTION_INSTANCE_NAME;
  const token = process.env.EVOLUTION_INSTANCE_TOKEN;

  if (!baseUrl || !instance || !token) {
    console.warn("evolution.sendWhatsAppMessage: variáveis de ambiente não configuradas, não enviei nada");
    return;
  }

  const url = `${baseUrl.replace(/\/$/, "")}/message/sendText/${instance}`;
  await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: token },
    body: JSON.stringify({ number, text }),
  });
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
  await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: token },
    body: JSON.stringify({ number, mediatype: "image", media: imageUrl, caption: caption || "" }),
  });
}

module.exports = { sendWhatsAppMessage, sendWhatsAppImage };
