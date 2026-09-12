// ============================================================
// Marca d'água nas fotos de produto antes de mandar pro grupo.
//
// Baixa a foto original (Shopee), sobrepõe uma faixa com o nome da
// marca (SVG renderizado pelo sharp) e devolve o resultado em base64
// -- a Evolution aceita mídia em base64 direto, sem precisar subir em
// lugar nenhum (testado com a instância real).
//
// Nunca deve travar o envio: qualquer falha (download, sharp, etc.)
// devolve null e quem chamou cai de volta pra foto original sem marca.
// ============================================================

const sharp = require("sharp");

// Cores da marca (css/style.css): --red e --sticker-pink.
const BAR_COLOR = "rgba(231,25,66,0.82)";
const TEXT_COLOR = "#F8D2E1";
const BRAND_TEXT = "BENDITO ACHADINHO";

function escapeXml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function buildOverlaySvg(width, barHeight) {
  const fontSize = Math.round(barHeight * 0.4);
  return `
    <svg width="${width}" height="${barHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${barHeight}" fill="${BAR_COLOR}" />
      <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="700"
        font-size="${fontSize}" fill="${TEXT_COLOR}" letter-spacing="2">${escapeXml(BRAND_TEXT)}</text>
    </svg>
  `;
}

async function fetchImageBuffer(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`download da imagem falhou: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Retorna a foto (JPEG) com a faixa de marca aplicada, em base64 --
// ou null se algo falhar (fallback: usar a imagem original).
async function watermarkImage(imageUrl) {
  if (!imageUrl) return null;
  try {
    const original = await fetchImageBuffer(imageUrl);
    const image = sharp(original).rotate(); // normaliza orientação EXIF antes de medir
    const meta = await image.metadata();
    const width = meta.width || 800;
    const barHeight = Math.max(36, Math.round(width * 0.11));

    const overlay = Buffer.from(buildOverlaySvg(width, barHeight));
    const output = await image
      .composite([{ input: overlay, gravity: "south" }])
      .jpeg({ quality: 88 })
      .toBuffer();

    return output.toString("base64");
  } catch (err) {
    console.warn("watermark.watermarkImage: falhou, usando imagem original:", err.message);
    return null;
  }
}

module.exports = { watermarkImage };
