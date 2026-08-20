// ============================================================
// ACHADINHOS DE FALLBACK — usados só como catálogo offline/inicial.
// A fonte "de verdade" dos achadinhos agora é o banco de dados,
// cadastrado via bot do WhatsApp (veja api/whatsapp-webhook.js).
// Este arquivo serve pra: (1) semear o banco a primeira vez
// (scripts/seed.js), e (2) o site nunca aparecer vazio caso a
// API/banco estejam fora do ar (veja js/app.js).
//
// Para adicionar um achadinho manualmente aqui, copie um bloco
// { ... }, cole antes do "];" final e edite os campos.
//
// Campos:
//   title          -> nome do produto (curto e chamativo)
//   image          -> URL da foto do produto (ou deixe "" para usar o emoji)
//   emoji          -> usado como imagem enquanto não tiver foto real
//   price          -> preço de venda (número, sem R$)
//   affiliateLink  -> SEU link de afiliado da Shopee para esse produto
// ============================================================
const PRODUCTS = [
  {
    title: "Terço de São Bento",
    image: "",
    emoji: "📿",
    price: 19.9,
    affiliateLink: "https://s.shopee.com.br/SEU_LINK_AQUI",
  },
  {
    title: "Bíblia Católica de Bolso",
    image: "",
    emoji: "📖",
    price: 39.9,
    affiliateLink: "https://s.shopee.com.br/SEU_LINK_AQUI",
  },
  {
    title: "Caneca Católica Deus Proverá",
    image: "",
    emoji: "☕",
    price: 29.9,
    affiliateLink: "https://s.shopee.com.br/SEU_LINK_AQUI",
  },
  {
    title: "Imagem de São Bento",
    image: "",
    emoji: "🙏",
    price: 34.9,
    affiliateLink: "https://s.shopee.com.br/SEU_LINK_AQUI",
  },
  {
    title: "Ecobag Católica Nossa Senhora",
    image: "",
    emoji: "👜",
    price: 24.9,
    affiliateLink: "https://s.shopee.com.br/SEU_LINK_AQUI",
  },
];

// Não-op no navegador — só existe pra scripts/seed.js reaproveitar esta lista.
if (typeof module !== "undefined") {
  module.exports = PRODUCTS;
}
