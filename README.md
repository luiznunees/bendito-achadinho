# Bendito Achadinho

Site "link na bio": hero vermelho com o logo e o slogan, barra de redes sociais, lista de **achadinhos** (cada um com foto, preço e link de afiliado), CTA para o **Grupo de Ofertas** e uma seção de benefícios explicando por que entrar no grupo. Identidade visual: vermelho + rosa, tipografia sticker — o "católico de internet" descrito no guia de marca.

O site em si é estático (HTML/CSS/JS puro). Os achadinhos, porém, agora vêm de um banco de dados — cadastrados automaticamente por um **bot de curadoria no WhatsApp** (veja a seção própria abaixo) — com `data/products.js` servindo só de catálogo de reserva (fallback) caso o banco/API estejam fora do ar.

## Estrutura

```
index.html              → estrutura da página (hero, benefícios e rodapé estão escritos direto aqui)
css/style.css            → visual (cores, layout, cards)
js/app.js                → monta a página; busca achadinhos em /api/products, com data/products.js como fallback
data/config.js            → link do grupo, redes sociais, aviso de afiliado
data/products.js           → achadinhos de fallback/seed (não é mais a fonte "de verdade")
assets/hero-logo.jpg        → logo usado no topo do site

api/products.js          → Vercel Function: GET, lista achadinhos ativos do banco
api/whatsapp-webhook.js  → Vercel Function: recebe o webhook do Evolution API e cadastra produtos
lib/db.js                → acesso ao banco Postgres (Neon, via @neondatabase/serverless)
lib/shopee.js            → integração com a API de Afiliados da Shopee
lib/gemini.js            → revisão do título do produto com o Google Gemini
lib/evolution.js         → envio de mensagens de confirmação de volta pro WhatsApp
scripts/seed.js          → cria a tabela e semeia os produtos de exemplo no banco (rodar 1x)
```

## O que trocar antes de publicar (site)

1. **Link do Grupo de Ofertas** (CTA principal) — em `data/config.js`, campo `groupCta.url`.
2. **Redes sociais** — em `data/config.js`, campo `socialLinks` (deixe `url: ""` para esconder algum ícone).
3. (Opcional) **Achadinhos de fallback** — em `data/products.js`, mesmo formato de sempre; só é usado se o bot/banco ainda não tiverem nenhum produto cadastrado, ou se `/api/products` falhar.

> Nota: a lista de produtos mostra só o preço final (sem preço "de/por" riscado). Se quiser voltar a mostrar desconto, é só pedir — dá pra adicionar de novo.

## Testar o site localmente

Sem o backend (`/api`), basta abrir `index.html` direto no navegador — o site cai automaticamente no catálogo de fallback. Pra testar com o backend, veja "Rodar localmente" na seção do bot, abaixo.

## Publicar na Vercel

**Opção A — sem GitHub, direto do computador:**

```bash
npx vercel
```

Siga as perguntas no terminal (crie uma conta Vercel gratuita se ainda não tiver). Isso já publica o site com um link `.vercel.app`. Para colocar em produção depois de qualquer alteração:

```bash
npx vercel --prod
```

**Opção B — via GitHub (recomendado):**

1. Suba esta pasta para um repositório no GitHub.
2. Em [vercel.com](https://vercel.com), clique em "Add New Project" e importe o repositório.
3. A Vercel detecta o `package.json` e roda `npm install` sozinha (só afeta as funções em `/api` — o site continua estático). Não precisa configurar build command.
4. Configure as variáveis de ambiente do projeto (Settings → Environment Variables) — veja a lista completa na seção "Bot de curadoria" abaixo.

> Nota: como o projeto agora tem `package.json` (por causa do bot), o primeiro deploy depois dessa mudança vale a pena revisar como "Preview" antes de promover pra produção, só pra confirmar que o build passou limpo.

## Domínio próprio

Depois do primeiro deploy, em **Project Settings → Domains** na Vercel você pode apontar um domínio próprio (ex: `benditoachadinho.com.br`) para usar como link na bio.

## Aviso de afiliado

O rodapé já inclui um texto padrão avisando que o site usa links de afiliados (`data/config.js`, campo `disclaimer`) — isso é importante para transparência com quem clica. Ajuste o texto se quiser, mas não remova o aviso.

## Bot de curadoria (WhatsApp)

Você manda um link de produto da Shopee pro seu próprio número do bot no WhatsApp, e ele: busca os dados na API de Afiliados da Shopee, gera o link de afiliado, manda o título pro Gemini deixar bonitinho, salva no banco e confirma de volta ("✅ Cadastrado: ..."). O Evolution API (o WhatsApp em si) continua rodando na sua VPS — só o "cérebro" do bot roda aqui na Vercel, como funções serverless.

### Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha (veja comentários no próprio arquivo pra saber de onde tirar cada uma). As mesmas variáveis precisam ser configuradas em **Project Settings → Environment Variables** na Vercel pra funcionar em produção:

- `DATABASE_URL` — preenchida sozinha ao conectar um banco (veja abaixo).
- `SHOPEE_APP_ID` / `SHOPEE_APP_SECRET` — do seu acesso ao Programa de Afiliados Shopee.
- `GEMINI_API_KEY` — chave gratuita em [aistudio.google.com](https://aistudio.google.com).
- `EVOLUTION_API_URL` / `EVOLUTION_INSTANCE_NAME` / `EVOLUTION_INSTANCE_TOKEN` — da sua instância na VPS.
- `WEBHOOK_SHARED_SECRET` — invente uma string aleatória qualquer, só você precisa saber.
- `OWNER_WHATSAPP_NUMBER` — seu número (só dígitos, com DDI+DDD, ex: `5511999999999`) — é o único autorizado a cadastrar produto pelo bot.

### Conectar o banco (Neon, via Vercel Marketplace)

No painel do projeto na Vercel: **Storage → Create Database → Neon** (tem plano gratuito). Ao conectar, a Vercel já preenche `DATABASE_URL` sozinha nas variáveis de ambiente.

> Nota: `@vercel/postgres` foi descontinuado pela própria Vercel em favor da integração nativa com a Neon — por isso o projeto usa `@neondatabase/serverless` diretamente.

### Criar a tabela e semear os produtos de exemplo

Depois de ter `DATABASE_URL` disponível localmente (em `.env.local`):

```bash
npm install
node --env-file=.env.local scripts/seed.js
```

Isso cria a tabela `products` (se ainda não existir) e insere os 5 achadinhos de exemplo, caso o banco esteja vazio.

### Configurar o webhook no Evolution

Na configuração de webhooks da sua instância Evolution, aponte para:

```
https://SEU_DOMINIO.vercel.app/api/whatsapp-webhook?token=SEU_WEBHOOK_SHARED_SECRET
```

Habilite pelo menos o evento `MESSAGES_UPSERT`.

### Rodar localmente

```bash
npx vercel dev
```

Isso sobe o site + as funções de `/api` localmente (lendo `.env.local` automaticamente), pra testar `/api/products` e simular chamadas ao webhook com `curl` antes de mexer na instância real do Evolution.

### O que ainda está marcado como "ajustar quando testarmos de verdade"

A busca de um produto específico na API da Shopee (`productOfferV2`) e o formato exato do payload do Evolution têm alguns detalhes que só confirmamos com credenciais reais — os comentários em `lib/shopee.js` e `api/whatsapp-webhook.js` marcam exatamente onde. Não é motivo pra travar o primeiro teste real, só significa que pode precisar de um ajuste fino depois de ver a primeira resposta de verdade.

## Identidade visual

Cores e fontes ficam centralizadas no topo de `css/style.css` (bloco `:root`):

- `--red` (#E71942), `--pink` (#FA88AB) e `--sticker-pink` (#F8D2E1) — paleta oficial da marca.
- Fontes do Google Fonts carregadas no `index.html`: **Baloo 2** (títulos, preços, botões) e **Poppins** (textos gerais).
- O bloco `.hero` (fundo vermelho, logo, slogan) fica no topo do `index.html`; a seção de benefícios e o rodapé também estão escritos direto no HTML (não vêm de `config.js`) porque são fixos — para editar os textos deles, mexa direto no `index.html`.

Para trocar o slogan ("achadinhos que são uma bênção"), edite o `<p class="slogan">` no `index.html`. Para trocar a foto do topo, substitua `assets/hero-logo.jpg` por outra imagem quadrada (o site usa ela automaticamente).
