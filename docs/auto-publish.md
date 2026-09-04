# Automação de Publicação Automática

## Cronograma (horário de Brasília)

| Horário (BRT) | Tipo | Descrição |
|---------------|------|-----------|
| 08:00 | ☀️ Saudação | Bom dia + varies |
| 10:00 | 🛍️ Produtos | 5 ofertas cristãs |
| 12:00 | 🛍️ Produtos | 5 ofertas cristãs |
| 14:00 | 🛍️ Produtos | 5 ofertas cristãs |
| 16:00 | 🛍️ Produtos | 5 ofertas cristãs |
| 18:00 | 🛍️ Produtos | 5 ofertas cristãs |
| 20:00 | 🛍️ Produtos | 5 ofertas cristãs |
| 22:00 | 🛍️ Produtos | 5 ofertas cristãs |
| 23:00 | 🌙 Saudação | Boa noite + encerramento |

**Total:** ~40 produtos/dia + 2 saudações

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

1. **Cron da Vercel**: no plano Free só dispara **1x/dia** (o `vercel.json` tem os 9 crons, mas eles ficam inativos até um plano pago).
2. **Duração da função**: função serverless na Free morre aos **10s** — o pipeline (busca ~30 keywords + Gemini ~25s + envio com delay) estoura.

O workflow em `.github/workflows/auto-publish.yml` dispara nos horários acima, roda `scripts/run-auto-publish.js` e decidE o tipo (saudação/produtos) pela hora UTC em tempo real. O endpoint `/api/auto-publish` da Vercel **não é usado** para a automação (serve só como fallback/override manual).

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

> Os demais ajustes (`AUTOPUBLISH_*`) não são necessários: os valores padrão já vêm corretos no `lib/settings.js`.

## Deploy/atualização

```bash
git add .
git commit -m "feat: automação de publicação com saudações"
git push
```

Push em `master` dispara o workflow na hora certa (e também via `gh workflow run auto-publish.yml` para teste manual).
