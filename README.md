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
| `ANTHROPIC_API_KEY` | nao | Questionario de compreensao e dicionario. Sem ela, as duas telas dizem que a funcionalidade nao esta configurada. |
| `NEXT_PUBLIC_VAPID_KEY` | nao | Chave publica do lembrete diario. |
| `VAPID_PRIVATE_KEY` | nao | Chave privada do lembrete diario. |
| `VAPID_SUBJECT` | nao | `mailto:` de contato exigido pelo protocolo de push. |
| `CRON_SECRET` | nao | Separa o agendador de quem descobrir as rotas do cron (lembrete e acompanhamento de series e feeds). |

### Lembrete diario

As tres variaveis do lembrete sao opcionais e andam juntas: sem elas, o cartao
some dos Ajustes e a rota do agendador responde 401. O resto da aplicacao nao
muda.

O par VAPID e gerado localmente, sem contratar nada:

```bash
node -e "const k=require('web-push').generateVAPIDKeys();console.log('NEXT_PUBLIC_VAPID_KEY='+k.publicKey);console.log('VAPID_PRIVATE_KEY='+k.privateKey)"
node -e "console.log('CRON_SECRET='+require('crypto').randomBytes(32).toString('base64url'))"
```

Na Vercel, `VAPID_PRIVATE_KEY` e `CRON_SECRET` entram como variaveis
*sensitive*; `NEXT_PUBLIC_VAPID_KEY` e publica por definicao, porque vai para o
navegador.

#### Quem chama a rota do cron

O plano Hobby da Vercel aceita **um disparo por dia** por cron - um
`vercel.json` com expressao mais frequente que isso faz a API recusar o deploy
inteiro com `cron_jobs_limits_reached`, e nao so ignorar o agendamento. Por
isso `vercel.json` marca `0 2 * * *` (02:00 UTC, 23:00 em Brasilia).

Um disparo por dia entrega o lembrete sempre no mesmo horario, nao no que a
pessoa escolheu. Quem cobre a diferenca e
`.github/workflows/lembretes.yml`: bate na mesma rota de hora em hora, sem
custo. Para ativar, cadastre `CRON_SECRET` em *Settings > Secrets and variables
> Actions* do repositorio, com o mesmo valor que esta na Vercel. Sem o segredo o
fluxo termina sem fazer nada; o cron diario da Vercel continua valendo como
rede de seguranca.

Os dois chamando a mesma rota nao duplicam nada. A regra de envio pergunta "ja
passou da hora escolhida, hoje, sem leitura?" e marca o dia ao enviar, entao o
lembrete sai uma vez so - e sai correto tanto de hora em hora quanto uma vez
por dia.

O mesmo fluxo chama, em um segundo passo, `/api/cron/acompanhamento`: a
verificacao das series acompanhadas e dos feeds assinados. Cada origem e
consultada no maximo a cada 6 horas, entao a frequencia horaria nao
sobrecarrega os sites. Essa rota nao esta no `vercel.json`, pelo mesmo limite
de um disparo por dia do plano Hobby; sem `CRON_SECRET` no GitHub, series e
feeds simplesmente nao sao verificados.

O agendamento do GitHub tem duas limitacoes conhecidas, ambas aceitaveis aqui:
execucao agendada pode atrasar alguns minutos quando a fila esta cheia, e o
GitHub desativa fluxos agendados em repositorio sem commit ha 60 dias.

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
| `npm test` / `npm run test:watch` | Testes das regras puras (Vitest). |
| `npm run test:e2e` | Testes no navegador (Playwright), contra a aplicacao com banco. |
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
docs/backlog.md     backlog de produto, com o status de cada story
tests/              testes das regras puras
e2e/                testes no navegador: fluxo principal e acessibilidade
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
- **Extracao do texto.** A ordem e: `articleBody` declarado em JSON-LD,
  depois o container marcado com `itemprop="articleBody"` (microdado
  schema.org), depois `<article>` e `main`, e so por ultimo o palpite pelo
  maior container. O microdado e o caminho usado no Literotica, e com ele o
  bloco de anuncios que vinha antes do conto some por completo. Quando o
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
- **Compartilhar do navegador.** O manifest declara um `share_target`, entao o
  app instalado aparece na folha de compartilhamento do sistema: tocar em
  Compartilhar no navegador manda o link para `/compartilhar`, que importa e
  abre o leitor. Um endereco que ja esta na biblioteca nao e buscado de novo -
  a leitura abre onde parou, e `lib/source-url.ts` cuida para que rastreamento,
  barra final e fragmento nao facam o mesmo conto virar duas entradas. Quando a
  origem manda uma selecao em vez de um link, o texto cai no formulario de
  texto colado.
- **Importacao disparada de fora.** O `share_target` usa GET, entao a navegacao
  em si nao grava nada: a importacao sai de `POST /api/share`. E ela so comeca
  sozinha quando o cabecalho `Sec-Fetch-Site` indica que a navegacao nao veio de
  outro site. O cookie de sessao e `SameSite=Lax` e acompanha navegacao de topo,
  entao sem essa checagem qualquer pagina poderia apontar para `/compartilhar` e
  fazer o servidor buscar um endereco escolhido por ela. Vindo de fora, a tela
  espera um toque.
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
- **Testes.** Cobrem as regras puras: extracao, classificacao de endereco
  publico ou interno, normalizacao de URL, continuacao e as contas de leitura.
  Nada que dependa de rede ou banco entra na suite, porque o valor esta em
  rodar em segundos a cada push. O recorte nao e arbitrario: e onde ja houve
  regressao - acento apagado na tokenizacao, duracao de bloco dividida em vez
  de multiplicada, filtro descartando falas curtas e forma IPv6 mapeada
  escapando da checagem de rede interna. Cada um desses tem um teste que falha
  se o defeito voltar.
- **Testes no navegador.** `e2e/` percorre o fluxo principal (cadastro, texto
  colado, leitura ate o fim, historico), o modo Paginas, a leitura guiada por
  tempo livre e a verificacao de acessibilidade com axe nos temas claro,
  escuro e de alto contraste. Roda na CI em um job proprio, com Postgres de
  servico. Localmente, `npm run test:e2e` reaproveita o servidor que estiver
  na porta 3200 (ou `E2E_PORT`); `PW_CHROMIUM_PATH` aponta um Chromium ja
  instalado. Cada teste se apresenta com um IP proprio em `x-forwarded-for`,
  para o limite de cadastros por IP nao barrar a suite.
- **Sessoes revogaveis.** O token carrega a versao da sessao da conta. Trocar
  a senha ou "sair de todos os aparelhos" incrementa a versao, e todo token
  anterior deixa de valer na proxima requisicao. O middleware roda no Edge e
  nao consulta banco, entao a conferencia fica em `requireSession` e no
  layout autenticado.
- **Erros rastreaveis.** Todo erro 500 grava uma linha JSON com um codigo de
  8 caracteres, que a mensagem ao leitor tambem mostra. Parametros de
  consulta, linha do Postgres e e-mails sao removidos antes da gravacao. A
  tela de erro do navegador relata em `POST /api/erros`.
- **Custo por conta.** Questionario e dicionario tem teto diario por conta
  (20 e 200), alem do limite por IP. So geracao nova conta.
- **Idioma do texto.** Lido do `lang` da pagina ou do `dc:language` do EPUB,
  portugues quando ausente. Decide a voz da narracao e o pedido ao modelo no
  dicionario e no questionario.
- **Voz baixavel.** Em Ajustes, o leitor pode baixar vozes Piper (portugues e
  ingles, ~63 MB cada) para a narracao. Modelo e motor ficam no Cache Storage
  `leitura-vozes`, que o service worker e a saida da conta preservam, e a
  sintese roda em um Web Worker (`public/piper-worker.js`). O motor (ONNX
  Runtime Web e o conversor de fonemas em wasm) e copiado de `node_modules`
  para `public/tts` no `postinstall`; a pasta nao e versionada.
- **Navegacao no texto.** A folha "Navegar no texto" (icone de lupa, ou "/")
  busca expressoes ignorando acento e caixa, lista os titulos de textos
  Markdown e guarda marcadores de posicao (tabela `bookmarks`). O teclado muda
  velocidade (setas), modo (1, 2, 3) e volta a frase (Shift + seta); "?" lista
  os atalhos. As regras ficam em `src/lib/navigation.ts`.
- **Seguranca sem e-mail.** Codigos de recuperacao (`recovery_codes`, so o
  hash) redefinem a senha em `/recuperar`. Cada login cria uma linha em
  `auth_sessions` e o token leva o id dela: Ajustes lista os aparelhos e
  desconecta um sem derrubar os outros.
- **Portabilidade.** A exportacao da biblioteca tem envelope com versao
  (`src/lib/backup.ts`) e volta pela restauracao em Ajustes, em lotes de ate
  3 MB com desfazer. Arquivos .docx sao convertidos em Markdown no navegador.
  A tela de destaques baixa o texto inteiro anotado.
- **Interface.** Mobile-first, com barra inferior ao alcance do polegar, areas
  de toque de no minimo 44px, respeito as areas seguras do Android/iOS e temas
  claro e escuro.
