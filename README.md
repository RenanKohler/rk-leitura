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

## Banco de dados em servidor gratuito

A recomendacao e **Neon**: Postgres gerenciado, plano gratuito sem cartao de
credito, 0,5 GB de armazenamento e integracao direta com a Vercel.

1. Crie a conta em <https://neon.tech> e um projeto novo.
2. Escolha a regiao mais proxima (`sa-east-1`, Sao Paulo, para o Brasil).
3. Em **Connection string**, copie a opcao **Pooled connection** — o host
   termina em `-pooler`. Em ambiente serverless cada requisicao pode abrir uma
   conexao nova, e o endpoint direto esgota o limite rapido.
4. Cole em `DATABASE_URL`, mantendo `?sslmode=require`:

   ```
   DATABASE_URL="postgresql://USUARIO:SENHA@ep-xxxx-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require"
   ```

5. Aplique o schema:

   ```bash
   npm run db:migrate
   ```

O TLS e resolvido automaticamente: `src/db/index.ts` liga a verificacao de
certificado quando o host nao e local e respeita o `sslmode` da connection
string.

**Alternativas equivalentes:** Supabase (500 MB), Railway (creditos mensais) e
Aiven (plano gratuito). Qualquer uma funciona sem mudar o codigo — basta
trocar `DATABASE_URL`.

> Um banco gratuito hiberna apos alguns minutos sem uso. A primeira requisicao
> depois disso leva alguns segundos para responder, o que e esperado.

---

## Deploy na Vercel

1. Importe o repositorio em <https://vercel.com/new>.
2. Defina as variaveis de ambiente do projeto:

   | Variavel | Valor |
   | --- | --- |
   | `DATABASE_URL` | connection string pooled do Neon |
   | `JWT_SECRET` | saida de `npm run secret` |

3. Faca o deploy. O script `vercel-build` aplica as migrations antes de
   compilar, entao nao ha passo manual.

Trocar o `JWT_SECRET` invalida todas as sessoes ativas.

---

## Variaveis de ambiente

| Variavel | Obrigatoria | Descricao |
| --- | --- | --- |
| `DATABASE_URL` | sim | Connection string do Postgres. |
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
