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

## Variáveis de ambiente (Vercel)

Adicionar em **Settings → Environment Variables**:

```
# Evolution API
EVOLUTION_API_URL=https://zapbroker-evolution-api.mnfvp3.easypanel.host
EVOLUTION_INSTANCE_NAME=teste-ca59
EVOLUTION_INSTANCE_TOKEN=teste-ca59

# Grupo de ofertas
GROUP_WHATSAPP_ID=120363411641913555@g.us

# Token de segurança
AUTOPUBLISH_TOKEN=<gerar aleatório>

# Imagem
AUTOPUBLISH_SEND_IMAGE=true

# Dry run (false em produção)
AUTOPUBLISH_DRY_RUN=false
```

## Deploy

```bash
git add .
git commit -m "feat: automação de publicação com saudações"
git push
```

A Vercel detecta o `vercel.json` e configura os crons automaticamente.
