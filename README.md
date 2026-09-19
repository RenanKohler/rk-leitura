# Leitura

Aplicacao de leitura dinamica: importa artigos de qualquer URL (ou aceita texto
colado) e apresenta o conteudo em ritmo controlado, com acompanhamento de
velocidade e progresso.

Next.js 16 (App Router) + React 19 + PostgreSQL via Drizzle ORM.

---

## Comecando

Requisitos: Node.js 20+ e um PostgreSQL (local ou gerenciado).

```bash
npm install
cp .env.example .env.local
npm run secret          # gera o JWT_SECRET; cole no .env.local
npm run db:migrate      # cria as tabelas
npm run db:seed         # opcional: dados de demonstracao
npm run dev
```

A aplicacao sobe em <http://localhost:3000>.

O seed cria a conta `leitor@exemplo.com` / `demo1234`. Para exibir essa dica na
tela de login durante testes, defina `NEXT_PUBLIC_DEMO_HINT=true` (o valor e
lido no momento do build).

---

## Banco de dados

### Producao: Neon

Postgres gerenciado, plano gratuito sem cartao. A conexao vem de
`DATABASE_URL`: em desenvolvimento pelo `.env.local`, em producao pela variavel
de ambiente do host.

Use a **Pooled connection** do Neon — o host termina em `-pooler`. Em ambiente
serverless cada requisicao pode abrir uma conexao nova, e o endpoint direto
esgota o limite rapido.

O TLS e resolvido automaticamente: a verificacao de certificado liga quando o
host nao e local, respeitando o `sslmode` da connection string.

As migrations sao aplicadas antes do build (`vercel-build`), entao o schema
acompanha o deploy sem passo manual.

> Um banco gratuito hiberna apos alguns minutos sem uso. A primeira requisicao
> depois disso leva alguns segundos, o que e esperado.

---

## Deploy

### Vercel

Em producao: <https://rk-leitura.vercel.app>.

O projeto `rk-leitura` esta ligado a este repositorio, com `DATABASE_URL` e
`JWT_SECRET` definidos como variaveis sensiveis e as funcoes na regiao `gru1`
(Sao Paulo) - perto de quem usa e do banco. Cada push na `main` gera um deploy.

O script `vercel-build` aplica as migrations antes de compilar, entao o schema
acompanha o deploy sem passo manual. Se as migrations falharem, o build para e
o deploy anterior continua no ar.

Para criar o banco: projeto novo em <https://neon.tech> (gratuito, sem cartao),
regiao `sa-east-1`, e copie a **Pooled connection**.

Dois detalhes que valem em qualquer host:

- **Variaveis de ambiente novas so valem no proximo deploy.** Defini-las nao
  afeta o deploy que ja esta publicado.
- **Deploy manual por upload envia o diretorio inteiro, inclusive arquivos
  ignorados pelo git.** Um `.env.local` presente vai junto e sobrescreve a
  conexao de producao com a do seu Postgres local. Se `GET /api/health`
  responder `pointsToLocalhost: true`, foi isso. O deploy ligado ao git nao tem
  esse problema, porque parte do que esta versionado.

Trocar o `JWT_SECRET` invalida todas as sessoes ativas.

---

## Variaveis de ambiente

| Variavel | Obrigatoria | Descricao |
| --- | --- | --- |
| `DATABASE_URL` | sim | Connection string do Postgres (no Neon, a *pooled connection*). |
| `JWT_SECRET` | sim | Chave de assinatura das sessoes, minimo 32 caracteres. |
| `DATABASE_POOL_MAX` | nao | Tamanho maximo do pool (padrao 5). |
| `NEXT_PUBLIC_DEMO_HINT` | nao | `true` mostra as credenciais de demo no login. |

### Sobre o antigo `NEXT_PUBLIC_BASE_URL`

A variavel foi **removida**. Ela existia porque a rota de cadastro checava se o
e-mail ja estava em uso fazendo uma requisicao HTTP para a propria aplicacao:

```ts
await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/auth/check`, ...)
```

Isso trazia tres problemas: dependia da variavel estar correta em producao (com
o padrao `localhost:3000`, o cadastro quebrava silenciosamente no deploy),
gastava uma ida e volta de rede para uma consulta que o processo ja podia fazer,
e expunha `/api/auth/check`, um endpoint publico que respondia se um e-mail
estava cadastrado — ou seja, permitia enumerar contas.

Hoje o cadastro consulta o banco diretamente e o endpoint `/api/auth/check` nao
existe mais. Nao ha nada a configurar no lugar.

---

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento. |
| `npm run build` / `npm start` | Build e execucao em producao. |
| `npm run lint` / `npm run typecheck` | ESLint e TypeScript. |
| `npm run db:generate` | Gera migration a partir do schema. |
| `npm run db:migrate` | Aplica as migrations pendentes. |
| `npm run db:push` | Sincroniza o schema sem migration (so em desenvolvimento). |
| `npm run db:seed` | Dados de demonstracao. |
| `npm run secret` | Gera um `JWT_SECRET`. |

---

## Estrutura

```
src/
  app/
    (app)/          telas autenticadas: dashboard, textos, leitor, historico, ajustes
    (auth)/         login e cadastro
    api/            rotas HTTP
  components/       navegacao, providers e primitivas de interface
  db/               schema, conexao, migrations e seed
  hooks/            useResource, useWakeLock
  lib/              auth, sessao, parser, leitura, rate limit, busca protegida
  middleware.ts     protecao de rotas no servidor
drizzle/            migrations SQL versionadas
```

### Decisoes que valem registro

- **Sessao.** JWT assinado com `JWT_SECRET` em cookie `httpOnly`. A aplicacao
  falha na inicializacao se a variavel nao existir — nao ha chave padrao.
- **Protecao de rotas.** Feita no middleware, antes de qualquer HTML sair, e nao
  em `useEffect` no cliente.
- **Palavras.** Derivadas de `texts.content` em tempo de execucao. Nao ha tabela
  com uma linha por palavra.
- **Modos de leitura.** *Foco* mostra uma palavra por vez com a letra de
  fixacao destacada; *Rolagem* mantem o texto corrido com o trecho atual em
  evidencia; *Paginas* apresenta uma tela cheia por vez, sem rolagem, com toque
  nas laterais ou arrasto para virar.
- **Extracao do texto.** O corpo sai do container marcado com
  `itemprop="articleBody"` (microdado schema.org) quando existe - e o caso do
  Literotica, e com ele o bloco de anuncios que vinha antes do conto some por
  completo. Sem esse marcador, tenta o `articleBody` de JSON-LD, depois
  `<article>`, e so por ultimo o palpite pelo maior container. Quando o
  container e exato, nenhum bloco e descartado por tamanho: em ficcao as falas
  de dialogo sao curtas e o filtro antigo apagava boa parte do texto.
- **Paragrafos.** Preservados da extracao ate a tela. O conteudo guarda uma
  linha em branco entre paragrafos, e o leitor renderiza um `<p>` para cada um
  nos modos Rolagem e Paginas. A regua de medicao monta os mesmos paragrafos,
  senao a quebra de pagina calcularia uma altura menor que a real.
- **Continuacao do conto.** Ao chegar no fim de um texto importado, "proxima
  pagina" busca a proxima parte na propria origem: a URL da importacao com
  `?page=` incrementado. A base e sempre a URL importada, que conta como pagina
  1, nunca a da ultima busca - assim o parametro nao se acumula a cada chamada.
  Nenhum desfecho esperado vira erro: "nao ha mais paginas", "a origem nao
  respondeu" e "veio a mesma pagina de novo" voltam com 200 e um `status`
  proprio, e a tela apenas informa. A mesma protecao anti-SSRF da importacao
  vale aqui, e paginas repetidas sao detectadas para nao duplicar o texto.
- **Paginacao do texto.** Medida por uma regua oculta com a mesma largura e
  tipografia da area de leitura, via busca binaria. Cada pagina comeca no inicio
  de uma linha, entao o que foi medido e exatamente o que aparece. Recalcula ao
  girar a tela e quando as fontes terminam de carregar.
- **Listas paginadas.** `/api/texts` e `/api/reading-sessions` aceitam `page` e
  `perPage` e devolvem o total. `/api/stats` calcula as somas do painel no
  banco, em vez de baixar o historico inteiro para somar no cliente.
- **Importacao de URL.** Toda busca passa por `lib/safe-fetch.ts`, que resolve o
  DNS e recusa enderecos de rede interna, revalidando cada redirecionamento.
- **Migrations.** `drizzle/` e a unica fonte, aplicada por `npm run db:migrate`
  — localmente a mao e, no deploy, pelo `vercel-build` antes do `next build`.
- **Carga de dados.** As telas autenticadas sao componentes de servidor: a
  consulta roda antes do HTML sair e o conteudo chega pronto. Sessao e
  preferencias saem do proprio cookie assinado e de uma consulta no layout, em
  vez de duas chamadas depois de hidratar. `lib/queries.ts` guarda essas
  consultas e serve tanto as telas quanto as rotas de API, para nao existirem
  duas versoes da mesma pergunta ao banco.
- **Limites de carregamento.** Cada rota tem um `loading.tsx`. Alem de responder
  ao toque na hora, ele permite que o servidor envie a estrutura da pagina antes
  de a consulta terminar - o que importa porque o banco do plano gratuito
  hiberna e a primeira consulta depois disso demora.
- **Diagnostico.** `GET /api/health` responde se o banco esta acessivel e
  quais variaveis estao presentes, sem expor nenhum valor.
- **Interface.** Mobile-first, com barra inferior ao alcance do polegar, areas
  de toque de no minimo 44px, respeito as areas seguras do Android/iOS e temas
  claro e escuro.
