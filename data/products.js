// ============================================================
// ACHADINHOS DE FALLBACK — usados só como catálogo offline/inicial.
// A fonte "de verdade" dos achadinhos agora é o banco de dados,
// cadastrado via bot do WhatsApp (veja api/whatsapp-webhook.js).
// Este arquivo serve pra: (1) semear o banco a primeira vez
// (scripts/seed.js), e (2) o site nunca aparecer vazio caso a
// API/banco estejam fora do ar (veja js/app.js).
//
// Vazio de propósito — os achadinhos fictícios de exemplo foram
// removidos. Se quiser um catálogo de reserva, copie um bloco
// { ... } pra dentro do array abaixo:
//
// Campos:
//   title          -> nome do produto (curto e chamativo)
//   image          -> URL da foto do produto (ou deixe "" para usar o emoji)
//   emoji          -> usado como imagem enquanto não tiver foto real
//   price          -> preço de venda (número, sem R$)
//   affiliateLink  -> SEU link de afiliado da Shopee para esse produto
// ============================================================
const PRODUCTS = [];

// Não-op no navegador — só existe pra scripts/seed.js reaproveitar esta lista.
if (typeof module !== "undefined") {
  module.exports = PRODUCTS;
}
