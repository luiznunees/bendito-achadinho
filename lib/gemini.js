// ============================================================
// Textos com o Google Gemini (tier gratuito) e com fallback seguro.
// Nunca deve travar o fluxo por causa da IA: se a chave não está
// configurada, ou a chamada falhar/demorar, devolve o texto original.
// ============================================================

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const TIMEOUT_MS = 45000;
const MAX_RETRIES = 1;

const PROMPT_TEMPLATE = (rawTitle) => `Você escreve títulos de produto para o "Bendito Achadinho", um perfil de achadinhos (achados baratos) para público cristão jovem (católico e evangélico) no Instagram/WhatsApp. O tom é casual, animado, nunca formal ou corporativo.

Reescreva o título de produto abaixo: curto (até 45 caracteres), chamativo, em português, mantendo o produto reconhecível. Não invente características que não estão no título original. Devolva SOMENTE o título reescrito, sem aspas, sem explicação, sem markdown.

Título original: "${rawTitle}"`;

const HEADLINE_TEMPLATE = (rawTitle) => `Você escreve manchetes (headlines) de oferta para um grupo de achadinhos no WhatsApp, com tom casual, animado e de gente nova — nunca formal/corporativo.

Crie UMA manchete curta (máx 8-10 palavras) em MAIÚSCULAS, chamativa e empolgante, sobre o produto abaixo, destacando o apelo (estilo, benefício, ocasião de uso). Termine com um emoji de clima/estilo (ex: 🌴 ☀️ 🔥 🍃). Não cite preço. Devolva SOMENTE a manchete, sem aspas, sem explicação.

Produto: "${rawTitle}"`;

const OFFER_TEXTS_TEMPLATE = (rawTitle) => `Você escreve textos de oferta para o "Bendito Achadinho", um perfil de achadinhos (achados baratos) para público cristão jovem (católico e evangélico) no WhatsApp. Tom casual, animado, nunca formal.

Sobre o produto abaixo, gere DOIS textos:
- HEADLINE: manchete curta (máx 8-10 palavras) em MAIÚSCULAS, chamativa e empolgante, destacando o apelo (estilo/conforto/ocasião de uso), terminando com um emoji de clima (ex: 🌴 ☀️ 🔥 🍃). Não cite preço.
- TITULO: nome curto e reconhecível do produto (até 45 caracteres), sem emoji.

Responda em exatamente 2 linhas:
Linha 1: HEADLINE
Linha 2: TITULO

Sem mais texto, sem numeração, sem aspas.

Produto: "${rawTitle}"`;

async function callGemini(prompt, apiKey) {
  if (!apiKey || !prompt) return null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );

      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) return text;
      if (attempt < MAX_RETRIES) {
        console.warn(`gemini.callGemini: resposta vazia, tentativa ${attempt + 1}`);
      }
    } catch (err) {
      console.warn(
        `gemini.callGemini: falhou na tentativa ${attempt + 1}: ${err.message}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

// Título curto e chamativo do produto (fallback: título original).
async function rewriteTitle(rawTitle) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !rawTitle) return rawTitle;
  const text = await callGemini(PROMPT_TEMPLATE(rawTitle), apiKey);
  return text || rawTitle;
}

// Manchete (headline) de marketing em MAIÚSCULAS (fallback: null).
async function generateHeadline(rawTitle) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !rawTitle) return null;
  return callGemini(HEADLINE_TEMPLATE(rawTitle), apiKey);
}

// Gera headline + título curto em UMA única chamada (mais rápido e
// confiável que 2 chamadas seguidas). Retorna { headline, title }.
// Fallback: { headline: "", title: rawTitle } se algo falhar.
async function generateOfferTexts(rawTitle) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !rawTitle) {
    return { headline: "", title: rawTitle };
  }

  const text = await callGemini(OFFER_TEXTS_TEMPLATE(rawTitle), apiKey);
  if (!text) return { headline: "", title: rawTitle };

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(String);

  // Aceita tanto "HEADLINE\ntitulo" quanto só "headline\ntitulo".
  let headline = lines[0] || "";
  let title = lines[1] || "";
  if (headline.toUpperCase().startsWith("HEADLINE")) {
    headline = title;
    title = lines[2] || "";
  }
  if (title.toUpperCase().startsWith("TITULO")) {
    title = lines[2] || "";
  }
  headline = headline.replace(/^(EDLINE|HEADLINE|TITULO):?\s*/i, "").trim();
  title = title.replace(/^(TITULO):?\s*/i, "").trim();

  // Se algo deu muito estranho, usa o fallback do nome do produto.
  if (!title) title = rawTitle;
  return { headline, title };
}

module.exports = { rewriteTitle, generateHeadline, generateOfferTexts };
