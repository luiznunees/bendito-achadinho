// ============================================================
// Não precisa editar este arquivo para trocar textos, links ou
// produtos — isso é tudo feito em data/config.js e data/products.js.
// Este arquivo só lê aqueles dados e monta a página.
// ============================================================

const SOCIAL_ICONS = {
  instagram:
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>',
  tiktok:
    '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.6 5.82c-.9-.8-1.4-1.94-1.4-3.32h-3.1v12.4c0 1.4-1.15 2.5-2.6 2.5a2.55 2.55 0 0 1-2.6-2.55c0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.7 5.7 3.13 0 5.68-2.55 5.68-5.7V9.01a7.35 7.35 0 0 0 4.31 1.38V7.3c-1.44 0-2.5-.6-2.9-1.48z"/></svg>',
  youtube:
    '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="5.5" width="20" height="13" rx="4" stroke="currentColor" stroke-width="2"/><path d="M10 9l6 3-6 3z" fill="currentColor"/></svg>',
  email:
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  whatsapp:
    '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.48s1.07 2.87 1.22 3.07c.15.2 2.1 3.2 5.08 4.49.7.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.34z"/><path d="M12 2a10 10 0 0 0-8.5 15.25L2 22l4.9-1.44A10 10 0 1 0 12 2zm0 18.2a8.17 8.17 0 0 1-4.17-1.14l-.3-.18-3.1.91.92-3-.2-.32A8.2 8.2 0 1 1 12 20.2z"/></svg>',
};

function formatBRL(value) {
  return "R$ " + Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function renderSocialBar() {
  const container = document.getElementById("social-bar");
  const links = (CONFIG.socialLinks || []).filter((s) => s.url && s.url.trim() !== "");

  container.innerHTML = links
    .map((s) => {
      const icon = SOCIAL_ICONS[s.icon] || SOCIAL_ICONS.email;
      return `<a class="social-link" href="${s.url}" target="_blank" rel="noopener" aria-label="${s.label}">${icon}</a>`;
    })
    .join("");
}

function renderCta() {
  const { headline, description, buttonLabel, url } = CONFIG.groupCta;

  document.getElementById("cta-headline").textContent = headline;
  document.getElementById("cta-desc").textContent = description;
  document.getElementById("cta-button").textContent = buttonLabel;
  document.getElementById("cta-button").href = url;

  document.getElementById("cta-sticky").href = url;

  document.title = CONFIG.brandName + " — Ofertas e Achadinhos";
}

function renderFooter() {
  document.getElementById("disclaimer").textContent = CONFIG.disclaimer;
}

function renderProducts() {
  const list = document.getElementById("products-list");

  list.innerHTML = PRODUCTS.map((p) => {
    const imageHtml = p.image && p.image.trim() !== ""
      ? `<img src="${p.image}" alt="${p.title}" loading="lazy" />`
      : p.emoji || "🛍️";

    return `
      <a class="product-row" href="${p.affiliateLink}" target="_blank" rel="noopener sponsored">
        <div class="product-photo">${imageHtml}</div>
        <div class="product-info">
          <div class="product-name">${p.title}</div>
          <div class="product-price">${formatBRL(p.price)}</div>
          <div class="product-link">veja mais</div>
        </div>
        <div class="product-arrow">›</div>
      </a>
    `;
  }).join("");
}

function init() {
  renderSocialBar();
  renderCta();
  renderFooter();
  renderProducts();
}

init();
