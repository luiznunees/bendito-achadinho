# Template de Postagem de Ofertas

## ✅ TEMPLATE FINAL (implementado no `lib/auto_publish.js`)

```
🛍️ *[NOME DO PRODUTO]*

De R$ ~[PREÇO ANTIGO]~ | Por R$ *[PREÇO]* 💰

`🏷️ Cupom: [CUPOM]`

👉 COMPRAR: [LINK]
```

Exemplo real:

```
🛍️ *Bíblia de Estudo Reformadores BKJ Fiel 1611*

De R$ ~159,80~ | Por R$ *79,90* 💰

`🏷️ Cupom: BENDITO10`

👉 COMPRAR: https://s.shopee.com.br/abc123
```

### Detalhes
- **Imagem:** foto do produto enviada como preview (via `sendWhatsAppImage`)
- **Título:** `🛍️ *...*` (negrito)
- **Preço original:** `De R$ ~...~` (riscado + "R$")
- **Preço atual:** `Por R$ *...* 💰` (negrito + "R$")
- **Cupom:** `` `🏷️ Cupom: ...` `` (code; se `AUTOPUBLISH_COUPON` vazio, linha não aparece)
- **Link:** `👉 COMPRAR: https://...`

### Configuração do cupom
- `AUTOPUBLISH_COUPON=BENDITO10` no `.env.local` / Vercel
- Se vazio ou não configurado, a linha do cupom **não aparece**

### Tags WhatsApp
- Negrito: `*texto*`
- Riscado: `~texto~`
- Code: `` `texto` ``
