# Automação de Publicação Automática

## Cronograma (horário de Brasília)

Os horários são **espaçados e configuráveis no painel** (aba Config → "Horários e envio"). Não existe mais slot fixo em horário fechado:

| Configuração | Como funciona |
|--------------|---------------|
| 🍃 Modo "A cada X minutos" | Dispara **1 oferta** a cada `AUTOPUBLISH_INTERVAL_MINUTES`, entre `AUTOPUBLISH_START_TIME` e `AUTOPUBLISH_END_TIME`. Ex.: a cada 15 min das 08:00 às 11:00 → 13 ofertas/dia. |
| 🎯 Modo "Meta de N produtos/dia" | Você define `AUTOPUBLISH_DAILY_TARGET` (ex.: 20) e o sistema **calcula o intervalo** que distribui essa quantidade dentro da janela (arredondado para múltiplo de 5 min). |
| ☀️ 08:00 (fixo) | Saudação "Bom dia" (imagem + texto) |
| 🌙 23:00 (fixo) | Saudação "Boa noite" (imagem + texto) |

**Regras:**
- Cada disparo de oferta envia **1 produto** (com foto, se ativado no painel).
- No modo meta diária, a automação para de enviar quando a meta do dia é atingida.
- Intervalo mínimo suportado: **5 minutos** (limite do cron do GitHub Actions).

## Template de produto

```
🛍️ *[NOME DO PRODUTO]*

De R$ ~[PREÇO ANTIGO]~ | Por R$ *[PREÇO]* 💰

👉 COMPRAR: [LINK]
```

## Template de saudação

**Bom dia (8h):**
- ☀️ Bom dia, família! Que a graça de Deus ilumine seu dia. Hoje tem achadinho novo pra você! 🕊️
- 🌅 Bom dia! Começando o dia com fé e achadinhos bons. Bora conferir? 🛍️

**Boa noite (23h):**
- 🌙 Boa noite, família! Encerrando o dia com uma última oferta. Dorme com Deus! 🕊️
- 🌙 Boa noite! Antes de dormir, confere se ficou algum achadinho bom. Dorme com Deus! 🙏

## Como o gatilho funciona (IMPORTANTE)

O **agendamento roda no GitHub Actions**, não na Vercel, por dois limites do plano Free:

1. **Cron da Vercel**: no plano Free só dispara **1x/dia**.
2. **Duração da função**: função serverless na Free morre aos **10s** — o pipeline (busca ~30 keywords + Gemini ~25s + envio) estoura.

O workflow em `.github/workflows/auto-publish.yml` roda um cron **a cada 5 minutos** chamando `scripts/run-auto-publish.js auto`. O script "auto" decide o que fazer neste minuto com base nas configurações do painel (tabela `settings`, que também alimenta o dashboard):

- `08:00` BRT → saudação bom dia
- `23:00` BRT → saudação boa noite
- algum horário de disparo espaçado → publica 1 oferta
- qualquer outro minuto → não faz nada (retorno rápido)

Como o cron roda a cada 5 min, horários configuráveis como "a cada 1 hora", "a cada 37 min" etc. funcionam sem depender de cron exato — o script compara o minuto atual (BRT) com a grade calculada por `lib/schedule.js`.

## Variáveis de ambiente — GitHub Actions (1x manual)

Em **Settings → Secrets and variables → Actions**, criar as secrets abaixo com os MESMOS valores do `.env.local`:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SHOPEE_APP_ID
SHOPEE_APP_SECRET
GEMINI_API_KEY
EVOLUTION_API_URL
EVOLUTION_INSTANCE_NAME
EVOLUTION_INSTANCE_TOKEN
GROUP_WHATSAPP_ID
SITE_URL
```

> ⚠️ A instância do Evolution usada nos secrets (`EVOLUTION_INSTANCE_NAME`) precisa estar **conectada** (estado `open` na Evolution API), senão o envio falha silenciosamente. Verificação: `GET /instance/connectionState/<nome>` com header `apikey`.

> Os ajustes de espaçamento/horários/foto são feitos **no painel** (aba Config). Eles ficam na tabela `settings` do Supabase, que o runner lê a cada execução.

## Deploy/atualização

```bash
git add .
git commit -m "feat: automação de publicação com saudações"
git push
```

Push em `master` dispara o workflow na hora certa (e também via `gh workflow run auto-publish.yml` para teste manual).
