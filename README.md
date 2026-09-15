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

### Producao: Netlify DB (ja configurado)

O projeto usa **Netlify DB** — Postgres gerenciado por Neon, incluido no plano
gratuito da Netlify. Nao ha connection string para copiar: o pacote
`@netlify/database` provisiona o banco no primeiro deploy e injeta a conexao no
ambiente. `src/db/index.ts` resolve a origem nesta ordem:

1. `DATABASE_URL`, quando definida (desenvolvimento local e outros hosts);
2. Netlify DB, via `getConnectionString()`.

Cada deploy preview recebe um branch isolado do banco, criado a partir de uma
copia dos dados de producao. Somente os deploys de producao tocam o banco
principal.

As migrations sao aplicadas pelo Drizzle no inicio do build, conforme o
`netlify.toml`:

```toml
[build]
  command = "npm run db:migrate && next build"
```

### Outro provedor gratuito

O codigo nao depende da Netlify. Para rodar em Vercel, Railway ou Neon direto,
basta definir `DATABASE_URL` e aplicar as migrations:

1. Crie o projeto em <https://neon.tech> (plano gratuito, sem cartao) e escolha
   a regiao mais proxima (`sa-east-1` para o Brasil).
2. Copie a **Pooled connection** — o host termina em `-pooler`. Em ambiente
   serverless o endpoint direto esgota o limite de conexoes rapido.
3. Defina `DATABASE_URL` mantendo `?sslmode=require` e rode `npm run db:migrate`.

O TLS e resolvido automaticamente: a verificacao de certificado liga quando o
host nao e local, respeitando o `sslmode` da connection string.

> Um banco gratuito hiberna apos alguns minutos sem uso. A primeira requisicao
> depois disso leva alguns segundos, o que e esperado.

---

## Deploy

### Netlify (configuracao atual)

O projeto `rk-leitura` ja existe no time da Netlify, com a extensao Neon
instalada e `JWT_SECRET` definido. Ligue o repositorio do GitHub ao projeto em
**Project configuration > Build & deploy > Continuous deployment** para que cada
push na `main` gere um deploy.

O `netlify.toml` cuida do resto: aplica as migrations e compila.

### Vercel

1. Importe o repositorio em <https://vercel.com/new>.
2. Defina `DATABASE_URL` (connection string do Neon) e `JWT_SECRET`
   (saida de `npm run secret`).
3. Faca o deploy. O script `vercel-build` aplica as migrations antes de
   compilar.

Trocar o `JWT_SECRET` invalida todas as sessoes ativas.

---

## Variaveis de ambiente

| Variavel | Obrigatoria | Descricao |
| --- | --- | --- |
| `DATABASE_URL` | fora da Netlify | Connection string do Postgres. Na Netlify a conexao vem do Netlify DB. |
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
- **Importacao de URL.** Toda busca passa por `lib/safe-fetch.ts`, que resolve o
  DNS e recusa enderecos de rede interna, revalidando cada redirecionamento.
- **Interface.** Mobile-first, com barra inferior ao alcance do polegar, areas
  de toque de no minimo 44px, respeito as areas seguras do Android/iOS e temas
  claro e escuro.
