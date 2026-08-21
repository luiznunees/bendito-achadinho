// ============================================================
// Revisão do título do produto com o Google Gemini (tier gratuito).
// Se a chave não estiver configurada, ou a chamada falhar/demorar,
// devolve o título original — nunca deve travar o cadastro por
// causa da IA.
// ============================================================

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const TIMEOUT_MS = 10000;

const PROMPT_TEMPLATE = (rawTitle) => `Você escreve títulos de produto para o "Bendito Achadinho", um perfil de achadinhos (achados baratos) para público católico jovem no Instagram/WhatsApp. O tom é casual, animado, nunca formal ou corporativo.

Reescreva o título de produto abaixo: curto (até 45 caracteres), chamativo, em português, mantendo o produto reconhecível. Não invente características que não estão no título original. Devolva SOMENTE o título reescrito, sem aspas, sem explicação, sem markdown.

Título original: "${rawTitle}"`;

async function rewriteTitle(rawTitle) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !rawTitle) return rawTitle;

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
          contents: [{ parts: [{ text: PROMPT_TEMPLATE(rawTitle) }] }],
        }),
      }
    );

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || rawTitle;
  } catch (err) {
    console.warn("gemini.rewriteTitle: falhou, usando título original:", err.message);
    return rawTitle;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { rewriteTitle };
