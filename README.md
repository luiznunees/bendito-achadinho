# Bendito Achadinho

Site "link na bio": hero vermelho com o logo e o slogan, barra de redes sociais, lista de **achadinhos** (cada um com foto, preço e link de afiliado), CTA para o **Grupo de Ofertas** e uma seção de benefícios explicando por que entrar no grupo. Identidade visual: vermelho + rosa, tipografia sticker — o "católico de internet" descrito no guia de marca.

É um site 100% estático (HTML/CSS/JS puro, sem build, sem npm) — funciona até abrindo o `index.html` direto no navegador, e sobe na Vercel sem nenhuma configuração.

## Estrutura

```
index.html          → estrutura da página (hero, benefícios e rodapé estão escritos direto aqui)
css/style.css        → visual (cores, layout, cards)
js/app.js            → monta a lista de produtos e o CTA com os dados abaixo (não precisa mexer)
data/config.js        → link do grupo, redes sociais, aviso de afiliado
data/products.js       → lista de achadinhos (produtos)
assets/hero-logo.jpg    → logo usado no topo do site
```

## O que trocar antes de publicar

1. **Link do Grupo de Ofertas** (CTA principal) — em `data/config.js`, campo `groupCta.url`.
2. **Redes sociais** — em `data/config.js`, campo `socialLinks` (deixe `url: ""` para esconder algum ícone).
3. **Achadinhos** — em `data/products.js`, troque os produtos de exemplo pelos seus, com o link de afiliado real da Shopee em `affiliateLink`.
4. (Opcional) **Fotos reais dos produtos** — troque `image: ""` por uma URL de imagem (ex: a foto do produto na Shopee) em cada item de `data/products.js`. Enquanto `image` estiver vazio, aparece um emoji no lugar.

Para adicionar um novo achadinho, copie um bloco `{ ... }` dentro de `data/products.js`, cole antes do `];` e edite os campos:

```js
{
  title: "Pulseira de São Bento",
  image: "",
  emoji: "📿",
  price: 24.90,
  affiliateLink: "https://s.shopee.com.br/SEU_LINK_AQUI",
},
```

> Nota: a lista de produtos mostra só o preço final (sem preço "de/por" riscado). Se quiser voltar a mostrar desconto, é só pedir — dá pra adicionar de novo.

## Testar localmente

Basta abrir o arquivo `index.html` duas vezes (duplo clique) no navegador — não precisa instalar nada.

## Publicar na Vercel

**Opção A — sem GitHub, direto do computador:**

```bash
npx vercel
```

Siga as perguntas no terminal (crie uma conta Vercel gratuita se ainda não tiver). Isso já publica o site com um link `.vercel.app`. Para colocar em produção depois de qualquer alteração:

```bash
npx vercel --prod
```

**Opção B — via GitHub (recomendado se for atualizar os achadinhos com frequência):**

1. Suba esta pasta para um repositório no GitHub.
2. Em [vercel.com](https://vercel.com), clique em "Add New Project" e importe o repositório.
3. Não precisa mudar nenhuma configuração de build — a Vercel detecta que é um site estático.
4. Depois, para adicionar achadinhos novos: edite `data/products.js`, faça commit e push — a Vercel publica a nova versão automaticamente.

## Domínio próprio

Depois do primeiro deploy, em **Project Settings → Domains** na Vercel você pode apontar um domínio próprio (ex: `benditoachadinho.com.br`) para usar como link na bio.

## Aviso de afiliado

O rodapé já inclui um texto padrão avisando que o site usa links de afiliados (`data/config.js`, campo `disclaimer`) — isso é importante para transparência com quem clica. Ajuste o texto se quiser, mas não remova o aviso.

## Identidade visual

Cores e fontes ficam centralizadas no topo de `css/style.css` (bloco `:root`):

- `--red` (#E71942), `--pink` (#FA88AB) e `--sticker-pink` (#F8D2E1) — paleta oficial da marca.
- Fontes do Google Fonts carregadas no `index.html`: **Baloo 2** (títulos, preços, botões) e **Poppins** (textos gerais).
- O bloco `.hero` (fundo vermelho, logo, slogan) fica no topo do `index.html`; a seção de benefícios e o rodapé também estão escritos direto no HTML (não vêm de `config.js`) porque são fixos — para editar os textos deles, mexa direto no `index.html`.

Para trocar o slogan ("achadinhos que são uma bênção"), edite o `<p class="slogan">` no `index.html`. Para trocar a foto do topo, substitua `assets/hero-logo.jpg` por outra imagem quadrada (o site usa ela automaticamente).
