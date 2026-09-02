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
lib/db.js                → acesso ao banco (Supabase, via @supabase/supabase-js)
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

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — em Project Settings → API no painel do Supabase (veja abaixo). A service role key ignora Row Level Security — nunca vaza pro cliente, só é usada aqui nas funções serverless.
- `SHOPEE_APP_ID` / `SHOPEE_APP_SECRET` — do seu acesso ao Programa de Afiliados Shopee.
- `GEMINI_API_KEY` — chave gratuita em [aistudio.google.com](https://aistudio.google.com).
- `EVOLUTION_API_URL` / `EVOLUTION_INSTANCE_NAME` / `EVOLUTION_INSTANCE_TOKEN` — da sua instância na VPS.
- `WEBHOOK_SHARED_SECRET` — invente uma string aleatória qualquer, só você precisa saber.
- `OWNER_WHATSAPP_NUMBER` — seu número (só dígitos, com DDI+DDD, ex: `5511999999999`) — é o único autorizado a cadastrar produto pelo bot.

### Criar o projeto e a tabela no Supabase

1. Crie um projeto grátis em [supabase.com](https://supabase.com).
2. Em **SQL Editor → New query**, cole e rode:

```sql
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '🛍️',
  price NUMERIC(10,2) NOT NULL,
  affiliate_link TEXT NOT NULL,
  source_url TEXT,
  raw_title TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_active_created ON products (active, created_at DESC);
```

3. Em **Project Settings → API**, copie a **Project URL** (`SUPABASE_URL`) e a **service_role secret key** (`SUPABASE_SERVICE_ROLE_KEY`).

### Semear os produtos de exemplo

Depois de ter `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` em `.env.local`:

```bash
npm install
node --env-file=.env.local scripts/seed.js
```

Isso insere os 5 achadinhos de exemplo, caso a tabela esteja vazia.

### Tabelas do painel de Conteúdo (Agenda + Templates)

O painel `admin.html` tem uma aba **Conteúdo** (Agenda + Templates) que usa duas tabelas a mais. No **SQL Editor → New query**, rode o arquivo `scripts/schema-admin.sql` (ou o SQL abaixo) depois de criar a `products`:

```sql
CREATE TABLE caption_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  time_slot TEXT NOT NULL,
  category TEXT NOT NULL,
  hook_type TEXT NOT NULL,
  template_text TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_posts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  product_id BIGINT REFERENCES products (id) ON DELETE SET NULL,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_date, time_slot)
);
```

### Semear os templates do calendário (49 frases)

A planilha **Calendário 7 dias** tem 49 copies (7 dias × 7 horários) e fica em
`data/planilhas/calendario-7dias-ofertas-catolicas.xlsx`. Para carregá-las como
templates no painel:

```bash
npm i --no-save xlsx
node --env-file=.env.local scripts/seed-templates.js
```

Se a planilha estiver em outro caminho, passe como argumento:

```bash
node --env-file=.env.local scripts/seed-templates.js "caminho/arquivo.xlsx"
```

O script remove os templates antigos dos 7 horários e insere os novos, juntando **gancho + mini-CTA** no texto de cada template.

### Configurar o webhook no Evolution

Na configuração de webhooks da sua instância Evolution, aponte para:

```
https://SEU_DOMINIO.vercel.app/api/whatsapp-webhook?token=SEU_WEBHOOK_SHARED_SECRET
```

Habilite pelo menos o evento `MESSAGES_UPSERT`.

**A instância precisa estar conectada a um número de WhatsApp de verdade** (status `open`, não `close`) — confira em `GET /instance/fetchInstances` com o apikey. Se estiver `close`, conecte normalmente pela sua interface do Evolution (escaneando o QR code), senão o bot não consegue responder no WhatsApp.

### Rodar localmente

```bash
npx vercel dev
```

Isso sobe o site + as funções de `/api` localmente (lendo `.env.local` automaticamente), pra testar `/api/products` e simular chamadas ao webhook com `curl` antes de mexer na instância real do Evolution.

### Testado com credenciais reais em 2026-08-21

- **Shopee**: autenticação e `generateShortLink` funcionando. `productOfferV2` filtrado por palavra-chave (extraída do link) funciona muito bem e já devolve um link de afiliado pronto (`offerLink`) — vira a estratégia principal. Busca por `itemId`/`shopId` não foi validada (só testamos com IDs inventados, que deram erro — pode funcionar com um ID real, não checamos ainda).
- **Gemini**: o modelo usado é `gemini-flash-lite-latest` (configurável via `GEMINI_MODEL`). Modelos "thinking" tipo `gemini-3.6-flash` funcionam mas demoram ~30s pra uma tarefa simples de reescrever título — o `-lite` responde em ~1-2s, então é o padrão.
- **Supabase**: schema, insert e select confirmados funcionando de ponta a ponta.
- **Evolution**: envio de mensagem (`sendText`) só funciona com a instância conectada a um WhatsApp real — teste isso antes de considerar o bot pronto.

## Automação de publicação no grupo (auto-publish)

Além do bot de curadoria (que espera você mandar um link), o projeto agora tem uma
**automação que busca produtos sozinha** na Shopee, cadastra no site **e publica no
seu grupo de ofertas do WhatsApp**.

Fluxo (disparado por **Vercel Cron**, sem intervenção manual):

```
Vercel Cron --> /api/auto-publish --> busca na Shopee (productOfferV2 por keyword)
      --> filtra (desconto/preço/comissão) --> cadastra no site (Supabase)
      --> publica no grupo (Evolution API)
```

### Horários configurados

O `vercel.json` agenda duas execuções por dia (fuso UTC):
- `0 12 * * *` → 12:00 UTC (09:00 em Brasília)
- `0 20 * * *` → 20:00 UTC (17:00 em Brasília)

Para mudar os horários, ajuste os `schedule` em `vercel.json`.

### Variáveis de ambiente (adicione à Vercel e ao `.env.local`)

- `AUTOPUBLISH_TOKEN` — token que protege o endpoint por segurança em chamadas manuais.
- `AUTOPUBLISH_KEYWORDS` — palavras-chave de busca, separadas por vírgula (cada uma
  vira uma busca no `productOfferV2`).
- `AUTOPUBLISH_MIN_DISCOUNT` — desconto mínimo em % (padrão 20).
- `AUTOPUBLISH_MIN_PRICE` / `AUTOPUBLISH_MAX_PRICE` — faixa de preço (padrão 5–300).
- `AUTOPUBLISH_MIN_COMMISSION` — comissão mínima em % (padrão 0).
- `AUTOPUBLISH_MAX_OFFERS` — quantas ofertas publicar por execução (padrão 5).
- `AUTOPUBLISH_SORT_TYPE` — ordenação (5 = comissão, 2 = vendidos, padrão 5).
- `AUTOPUBLISH_SEND_IMAGE` — `true`/`false` para enviar imagem (padrão false).
- `AUTOPUBLISH_SEND_DELAY` — segundos entre mensagens no grupo (padrão 8).
- `AUTOPUBLISH_DRY_RUN` — `true` para NÃO publicar/salvar, só listar (teste).
- `AUTOPUBLISH_HEADLINE` — `true`/`false` para gerar headline + título curto com o Gemini
  (padrão true).
- `AUTOPUBLISH_GROUP_FOOTER` — rodapé de marca no fim de cada oferta.
- `GROUP_WHATSAPP_ID` — ID do grupo de ofertas (termina em `@g.us`, ex:
  `5511999999999-1234567890@g.us`). **Obrigatório** para publicar no grupo.

### Formato da oferta publicada no grupo

A mensagem é montada no estilo do grupo: **headline** chamativa (Gemini), nome curto
do produto, preço **De/Por**, link de afiliado curto e rodapé de marca. Usa a
formatação do WhatsApp (negrito `*...*`, sublinhado `_..._`, riscado `~...~`).

```
CONFORTO COM CARÁTER DE PRAIA! 🌴

🛍️ *Birkenstock Retrô Sola Grossa Confortável*

~De: R$ 256,06~
_Por:_ *R$ 40,97* ✅

🛒 https://s.shopee.com.br/1gIIrrnbSZ

_🛐  𝗕𝗘𝗡𝗗𝗜𝗧𝗢 𝗔𝗖𝗛𝗔𝗗𝗜𝗡𝗛𝗢  🛐_
```

> **Nota sobre o preço "De":** a API de afiliados Shopee não devolve o preço original;
> o "De:" é uma **estimativa** calculada a partir do preço atual e do % de desconto
> (`original = atual / (1 - desconto/100)`). Pode divergir um pouco do valor exibido
> no anúncio, pois a taxa de desconto vem arredondada.

### Testar localmente (dry run)

Sem publicar nada, apenas listando as ofertas que seriam encontradas:

```bash
AUTOPUBLISH_DRY_RUN=true AUTOPUBLISH_KEYWORDS="terco catolico" node --env-file=.env.local -e "require('./lib/auto_publish').runAutoPublish().then(r=>console.log(JSON.stringify(r)))"
```

### Disparo manual

Com o token configurado:

```bash
curl "https://SEU_DOMINIO/api/auto-publish?token=SEU_AUTOPUBLISH_TOKEN"
```

> Os disparos do Vercel Cron vêm com o header `x-vercel-cron: 1` e não exigem token;
> chamadas externas precisam do `AUTOPUBLISH_TOKEN`.

## Identidade visual

Cores e fontes ficam centralizadas no topo de `css/style.css` (bloco `:root`):

- `--red` (#E71942), `--pink` (#FA88AB) e `--sticker-pink` (#F8D2E1) — paleta oficial da marca.
- Fontes do Google Fonts carregadas no `index.html`: **Baloo 2** (títulos, preços, botões) e **Poppins** (textos gerais).
- O bloco `.hero` (fundo vermelho, logo, slogan) fica no topo do `index.html`; a seção de benefícios e o rodapé também estão escritos direto no HTML (não vêm de `config.js`) porque são fixos — para editar os textos deles, mexa direto no `index.html`.

Para trocar o slogan ("achadinhos que são uma bênção"), edite o `<p class="slogan">` no `index.html`. Para trocar a foto do topo, substitua `assets/hero-logo.jpg` por outra imagem quadrada (o site usa ela automaticamente).
