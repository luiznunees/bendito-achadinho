# ICP — Bendito Achadinho

> Construído a partir de pesquisas de mercado 2024–2026 (Gospel Power/Zygon+Eixo, O Brasil Evangélico/Data-Makers+Dolores, O Poder Evangélico/Artplan+Kantar, Locomotiva, estudos acadêmicos sobre consumo de artigos religiosos católicos, Censo IBGE 2022).

## Quem é (primário)

**Mulher cristã, 26–45 anos** (núcleo 29–44). Convergência em 4 pesquisas independentes:

- Consumo de artigos religiosos: **73% feminino**, faixa **26–45 = 55%** dos compradores (Pesquisa católica, Arinos/MG).
- Outra amostra: **74,4% feminino**, picos 20–29 e 30–39 (RN).
- Público evangélico: **55,4% mulheres** (Gospel Power).
- Potencial de conversão: **mulheres 29–44 = 54%** dos compradores em potencial (Revista E&S).

## Quem é (secundário — não ignorar)

- **Homens cristãos** "Ascensão cristã" e "Fé com flow" (54–57% masculinos, classes ABC) — compram moda/acessórios masculinos, chaveiros, joias.
- **A família inteira**: presentear é a 2ª maior motivação de compra (75–93% já presentearam com item religioso: bíblia, imagem, devocional).

## Idade

- **Núcleo: 26–45 anos** (55–65% dos compradores) — jovem-adulto, economicamente ativo, decide a compra da casa.
- **Ascendente: Geração Z** (evangélicos 15–19 anos = 28–32% da comunidade; 47% da juventude evangélica). Compram online/WhatsApp, moda modesta streetwear.

## Renda e classe

- **Classe C, renda familiar R$ 2.000–5.000** (2 a 5 salários mínimos). Perfil Locomotiva: CLT, ensino médio/técnico, casa própria (Minha Casa Minha Vida), moto/carro.
- Ponto-chave: **sobra renda** — não gasta com cerveja/balada, então **gasta com casa, família e fé**, e **aceita pagar mais** (58% pagam mais por item alinhado aos valores).

## O que compra (pilares do Bendito)

1. **Devocional / acessórios de fé** (uso diário): terço, medalha, escapulário, crucifixo, pulseira de versículo, **Bíblia & livros de oração** — maior demanda e recorrência.
2. **Moda cristã / moda comportada**: camiseta gospel/católica, blusas modestas, streetwear cristão — maior item de entrada e o que mais cresce em jovens/mulheres.
3. **Decoração & lar**: quadro com versículo/Leão de Judá, imagem de santo, oratório/crucifixo de parede — para presentear e para a casa.
4. **Utilitários com fé**: caneca, chaveiro, marcador de Bíblia, caderno de estudo.

## Comportamento de compra

- **Compra por emoção e pertencimento, não por preço.** 58% dizem que a fé influencia a compra; 58–78% valorizam marca que respeita os valores; querem produto **bonito, de qualidade e autêntico** — rejeitam item genérico com termo religioso de enfeite.
- **WhatsApp é o canal principal** (grupos, compra direta) + Instagram/YouTube; 50%+ do consumo online via celular.
- **Paga mais por identidade** (Gospel Premium, moda modesta premium), mas espera **cupom/desconto de achado** — daí o "achadinho".
- Fiel e emotivo: sensível a marca que desrespeita a fé (boicote é real).

## Sazonalidade (picos planejáveis)

- **Outubro**: Nossa Senhora Aparecida → terço, medalha, imagem (50% das vendas da categoria no mês).
- **Páscoa**: Bíblia, quadros, crucifixo (e-commerce religioso cresce 10–20%; Páscoa movimenta R$ 6,5 bi).
- **Dia das Mães**: joia/imagem mariana.
- **Dia dos Pais / Dias das Crianças**: chaveiro, acessório masculino, caneca.

---

# Estratégia de curadoria

## 1. Nicho = "Cristão em geral" com camadas de prioridade

O ranking prioriza, nesta ordem de valor para o ICP:

1. Devocional + Bíblia/livro (maior recorrência, mais queridas)
2. Moda cristã comportada (camiseta, blusa modesta — maior volume de jovem/mulher)
3. Decoração/quadro/verso (presente + casa)
4. Utilitários com fé (caneca, marcador, chaveiro) — só para variar/encher

## 2. Pesos do ranking (ajustados ao ICP)

Rebalanço aplicado no código — o que era "barato com muito desconto" passa a ser
"categoria certa + qualidade + preço justo + prova social":

- `niche` → **0.30** (relevância)
- `preco` → **0.25** (sobe: público paga justo, mas rejeita zum e item caro demais; faixa ideal 20–120)
- `sales` → **0.25** (prova social)
- `discount` → **0.15** (reduz: desconto perde para relevância/qualidade)
- `commission` → **0.05** (só desempate)

## 3. Faixas de preço por categoria

- Devocional/livro: R$ 15–150
- Moda cristã: R$ 20–120 (camiseta) até 180
- Decoração/quadro: R$ 25–250
- Descarta < R$ 8 (zum/lixo) e genérico caro sem identidade.

## 4. Diversificação (sorteio no top-N)

Manter `pickCandidate` — renova entre devocional/moda/decoração e não satura o grupo com o mesmo item.

## 5. Mix ideal por dia

- 60% devocional/livro/moda
- 30% decoração/presente
- 10% utilitário/variedade
