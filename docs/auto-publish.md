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

O cron do GitHub (evento `schedule`) **descarta/atrasa disparos sob fila** — na prática não respeita "a cada 5 min". Por isso o workflow usa **jobs de janela**: cada job fica de pé por até 6h (`scripts/run-window.js`) e executa cada horário espaçado **na hora certa**, sem depender do cron:

```
06:00–12:00 BRT (job manhã)  → run-window.js 06:00 12:00
12:00–18:00 BRT (job tarde)  → run-window.js 12:00 18:00
18:00–24:00 BRT (job noite)  → run-window.js 18:00 24:00
```

Dentro da janela o script relê a config do painel a cada 30s (mudança vale no próximo minuto), dispara **1 oferta** por horário espaçado e as saudações fixas de 08h/23h. Um **cron a cada 5 min** roda `scripts/run-auto-publish.js auto` como **rede de segurança** com trava anti-duplicado (não reenvia o que a janela já enviou).

> ⚠️ O repositório precisa ser **PÚBLICO** (o GitHub dá minutos de Actions ilimitados para repos públicos; repós privados têm só 2000 min/mês, incompatível com jobs de 18h/dia).

## Seleção da oferta (ranking + sorteio)

Cada disparo espaçado envia **1 oferta**. Primeiro, a lista completa de candidatas recebe uma **nota ponderada** (`rankOfferScore`):

```
nota = W_nicho    × força do nicho (termos religiosos no título, 2+ → 1.0)
      + W_sales   × log10 das vendas (10=0.3, 100=0.7, 1000=1.0)
      + W_desconto× % desconto (60% → 1.0)
      + W_comissao× % comissão (15% → 1.0)
      + W_preco   × faixa de achado (15–150 = 1.0; barato/caro caem)
```

Depois, a oferta do disparo é **sorteada dentro do top-N** (`pickCandidate`, padrão top **10**, configurável `AUTOPUBLISH_RANK_POOL`), ponderada pela nota elevada a 1.5. Assim o grupo **não fica repetido e mistura itens bons, caros e baratos** — os melhores saem com mais frequência, mas qualquer um do top pode aparecer.

- Pesos padrão: 0.35 / 0.25 / 0.15 / 0.15 / 0.10 (`AUTOPUBLISH_RANK_W_NICHE/_SALES/_DISCOUNT/_COMMISSION/_PRICE`).
- Se forem pedidas várias ofertas na mesma execução (teste/manual, `maxOffers>1`), usa a ordem por ranking.
- O dry-run (`AUTOPUBLISH_DRY_RUN=true`) mostra a nota e a oferta sorteada.

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
