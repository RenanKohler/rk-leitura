# Backlog: Leitura (rk-leitura)

## Visão geral

Leitura é uma aplicação web mobile-first de leitura dinâmica. O usuário importa
artigos por URL, compartilha links do navegador ou cola textos próprios, lê em
três modos (Foco, Rolagem e Páginas) com velocidade controlada e acompanha
progresso, sessões e ritmo. Stack: Next.js 16 (App Router), React 19, PostgreSQL
via Drizzle ORM, hospedagem na Vercel com banco Neon.

Fonte analisada: repositório `RenanKohler/rk-leitura`, branch `main`, commit
`5ed7dd7`.

## Premissas

- A análise foi feita sobre o código e sobre a aplicação publicada em
  `rk-leitura.vercel.app`.
- Os critérios das stories implementadas foram derivados das validações,
  mensagens e constantes do código, e servem de base para testes de regressão.
- Mensagens de interface citadas nos critérios estão como no código (sem
  acentuação).
- Os identificadores US-NN são estáveis. O épico de compartilhamento foi
  acrescentado depois, então sua numeração (US-33 a US-36) não segue a ordem de
  leitura do documento.
- Os épicos US-01 a US-36 descrevem o que o código faz ou o que falta nele. O
  épico final (US-37 a US-40) é de produto: funcionalidades que ainda não
  existem em lugar nenhum e cujas estimativas são previsões, não leitura.
- Velocidade de referência para planejamento: 20 a 25 pontos por sprint de 2
  semanas.

## Papéis

- **Visitante:** pessoa sem sessão, com acesso apenas a login e cadastro.
- **Leitor:** usuário autenticado que mantém sua biblioteca e lê os textos.
- **Mantenedor:** responsável pelo deploy e pela operação da aplicação.

## Status possíveis

| Status | Significado |
| --- | --- |
| Implementada | Existe no código e o comportamento está descrito nos critérios. |
| Parcial | Parte da story existe; o que falta está no corpo da story. |
| Proposta | Lacuna identificada, pronta para entrar em uma sprint. |
| Aguardando pendência | Lacuna identificada que **não pode começar** antes de uma decisão ou contratação externa. A pendência está nomeada na story. |

## Resumo

| Épico | Stories | Pontos | Must | Should | Could |
| --- | --- | --- | --- | --- | --- |
| Autenticação e conta | 7 | 21 | 4 | 2 | 1 |
| Biblioteca de textos | 7 | 20 | 4 | 2 | 1 |
| Compartilhamento | 4 | 13 | 1 | 2 | 1 |
| Leitor | 8 | 36 | 5 | 2 | 1 |
| Continuação de textos em partes | 1 | 8 | 0 | 1 | 0 |
| Preferências | 3 | 7 | 1 | 1 | 1 |
| Painel e histórico | 3 | 8 | 0 | 2 | 1 |
| Plataforma e operação | 3 | 15 | 0 | 3 | 0 |
| Produto: novas funcionalidades | 4 | 37 | 0 | 1 | 3 |
| **Total** | **40** | **165** | **15 (38%)** | **16 (40%)** | **9 (22%)** |

Status: 30 Implementadas, 1 Parcial, 7 Propostas, 2 Aguardando pendência.

O épico "Produto: novas funcionalidades" reúne o que ainda não existe no código
e não foi extraído dele: são propostas de produto, levantadas em conversa e
dimensionadas contra a base atual. Vêm depois das demais stories.

---

## Épico: Autenticação e conta

### US-01: Criar conta

**Épico:** Autenticação e conta
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/api/auth/register/route.ts`, `src/app/(auth)/cadastro/page.tsx`

Como visitante, eu quero criar uma conta com nome, e-mail e senha, para que minha biblioteca e meu histórico fiquem salvos entre dispositivos.

**Critérios de aceitação**
1. Dado que informo nome, e-mail válido e senha com 8 ou mais caracteres, quando envio o cadastro, então a conta é criada, a sessão é iniciada e sou levado ao painel.
2. Dado que o e-mail já existe, inclusive com outra combinação de maiúsculas e minúsculas, quando envio o cadastro, então recebo "Esse e-mail ja esta cadastrado." (HTTP 409).
3. Dado que o e-mail não tem formato válido ou a senha tem menos de 8 caracteres, quando envio o cadastro, então recebo a mensagem de validação correspondente (HTTP 400).
4. Dado que o nome tem mais de 80 caracteres, quando envio o cadastro, então recebo "Nome muito longo.".
5. Dado que o mesmo IP fez 5 tentativas de cadastro na última hora, quando tento de novo, então recebo HTTP 429 com o tempo de espera.

**Notas técnicas:** a unicidade é garantida por índice em `lower(email)`, o que também resolve cadastros simultâneos com o mesmo e-mail.

### US-02: Entrar na conta

**Épico:** Autenticação e conta
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/api/auth/login/route.ts`, `src/app/(auth)/login/page.tsx`, `src/middleware.ts`

Como visitante, eu quero entrar com e-mail e senha, para que eu acesse meus textos e continue minhas leituras.

**Critérios de aceitação**
1. Dado que informo credenciais válidas, quando entro, então a sessão é gravada em cookie `httpOnly` com validade de 7 dias.
2. Dado que cheguei ao login redirecionado de uma tela protegida, quando entro, então volto para essa tela **com a query string original preservada** — `?next=%2Fcompartilhar%3Furl%3D...` devolve o compartilhamento intacto.
3. Dado que `next` não começa com "/" **ou começa com "//"**, quando entro, então vou para o painel. A segunda regra existe porque "//outro-site" começa com barra e ainda assim sai da aplicação.
4. Dado que o e-mail não existe ou a senha está errada, quando entro, então recebo a mesma mensagem "E-mail ou senha incorretos." nos dois casos.
5. Dado que o mesmo IP fez 10 tentativas nos últimos 15 minutos, quando tento de novo, então recebo "Muitas tentativas de login. Aguarde alguns minutos." (HTTP 429).

### US-03: Proteger telas e dados do leitor

**Épico:** Autenticação e conta
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/middleware.ts`, `src/app/api/texts/[id]/route.ts` (`ownedText`)

Como leitor, eu quero que minhas telas e dados só sejam acessíveis com a minha sessão, para que meus textos e meu histórico fiquem privados.

**Critérios de aceitação**
1. Dado que não tenho sessão, quando acesso `/dashboard`, `/textos`, `/leitor`, `/historico`, `/ajustes` ou `/compartilhar`, então sou redirecionado ao login antes de qualquer conteúdo ser renderizado.
2. Dado que tenho sessão, quando acesso `/`, `/login` ou `/cadastro`, então sou redirecionado ao painel.
3. Dado que conheço o id de um texto de outra conta, quando tento abrir, editar, remover ou registrar sessão nele, então recebo "Texto nao encontrado." (HTTP 404).
4. Dado que o id informado não é um UUID válido, quando faço a requisição, então recebo 404 sem consulta ao banco.

### US-04: Sair da conta

**Épico:** Autenticação e conta
**Prioridade:** Must
**Story points:** 1
**Status:** Implementada
**Evidência:** `src/app/api/auth/logout/route.ts`, `src/app/(app)/ajustes/page.tsx`, `src/components/app-shell.tsx`

Como leitor, eu quero encerrar minha sessão, para que outra pessoa no mesmo dispositivo não acesse minha conta.

**Critérios de aceitação**
1. Dado que estou autenticado, quando aciono "Sair da conta" em Ajustes ou "Sair" na navegação, então o cookie de sessão é removido e sou levado ao login.
2. Dado que saí, quando tento acessar uma tela protegida pelo histórico do navegador, então sou redirecionado ao login.

### US-05: Recuperar senha

**Épico:** Autenticação e conta
**Prioridade:** Should
**Story points:** 5
**Status:** Aguardando pendência
**Pendência:** não há provedor de e-mail transacional na stack. Enquanto um não for escolhido e as credenciais não estiverem no ambiente, a story não pode começar.
**Evidência:** ausência de rota ou tela de recuperação em `src/app/api/auth/` e `src/app/(auth)/`

Como leitor, eu quero redefinir minha senha pelo e-mail, para que eu não perca minha biblioteca ao esquecer a senha.

**Critérios de aceitação**
1. Dado que informo um e-mail na tela "Esqueci a senha", quando envio, então vejo a mesma mensagem de confirmação exista ou não uma conta com esse e-mail.
2. Dado que recebi o link, quando o abro em até 1 hora e defino uma senha com 8 ou mais caracteres, então a senha é alterada e as demais sessões deixam de valer.
3. Dado que o link expirou ou já foi usado, quando o abro, então vejo mensagem de link inválido e a opção de solicitar outro.
4. Dado que o mesmo IP solicitou recuperação repetidas vezes, quando excede o limite, então recebo HTTP 429.

**Notas técnicas:** o critério 1 mantém a proteção contra enumeração de contas registrada no README. Invalidar sessões existentes exige uma versão de credencial no token, já que a sessão é um JWT sem estado. Candidatos com plano gratuito: Resend, Postmark, SendGrid.

### US-06: Alterar nome e senha

**Épico:** Autenticação e conta
**Prioridade:** Could
**Story points:** 3
**Status:** Proposta
**Evidência:** seção "Conta" de `src/app/(app)/ajustes/page.tsx` exibe apenas o nome e o botão de sair

Como leitor, eu quero alterar meu nome de exibição e minha senha, para que eu mantenha meus dados atualizados sem criar outra conta.

**Critérios de aceitação**
1. Dado que altero o nome para um valor de 1 a 80 caracteres, quando salvo, então o novo nome aparece na navegação e em Ajustes.
2. Dado que informo a senha atual correta e uma nova senha com 8 ou mais caracteres, quando salvo, então a senha é alterada.
3. Dado que a senha atual está errada, quando salvo, então recebo mensagem de erro e nada é alterado.

**Notas técnicas:** o nome também vive no JWT; a sessão precisa ser reemitida após a alteração.

### US-07: Excluir conta

**Épico:** Autenticação e conta
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** não há rota de exclusão; o schema já usa `onDelete: "cascade"` em `src/db/schema.ts`

Como leitor, eu quero excluir minha conta e todos os meus dados, para que eu exerça meu direito de eliminação de dados pessoais.

**Critérios de aceitação**
1. Dado que confirmo a exclusão informando minha senha, quando concluo, então usuário, textos, sessões e preferências são removidos e a sessão é encerrada.
2. Dado que a senha informada está errada, quando confirmo, então nada é removido.
3. Dado que a conta foi excluída, quando o token antigo é usado, então `/api/auth/me` retorna `user: null` e as telas redirecionam ao login.

**Notas técnicas:** atende ao direito de eliminação previsto na LGPD. O middleware valida apenas a assinatura do JWT; as rotas de API precisam tratar usuário inexistente sem erro 500.

---

## Épico: Biblioteca de textos

### US-08: Importar artigo por URL com prévia

**Épico:** Biblioteca de textos
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/app/api/import-url/route.ts`, `src/lib/import-text.ts`, `src/lib/safe-fetch.ts`, `src/lib/parser.ts`, `src/app/(app)/textos/novo/page.tsx`

Como leitor, eu quero importar um artigo informando o endereço, para que eu leia apenas o texto principal, sem menus e anúncios.

**Critérios de aceitação**
1. Dado que informo a URL de uma página pública com texto, quando importo, então vejo título e prévia do conteúdo com parágrafos preservados e posso conferir antes de salvar.
2. Dado que a página tem menos de 10 palavras extraíveis, quando importo, então recebo "Nao encontrei texto suficiente nessa pagina." (HTTP 422).
3. Dado que a URL não usa http ou https, ou resolve para um endereço de rede interna, inclusive após redirecionamento, quando importo, então a busca é recusada com mensagem específica.
4. Dado que a página excede 3 MB, demora mais de 15 segundos ou faz mais de 3 redirecionamentos, quando importo, então recebo a mensagem correspondente e nada é salvo.
5. Dado que fiz 20 importações nos últimos 10 minutos, quando importo de novo, então recebo "Muitas importacoes seguidas. Aguarde um pouco." (HTTP 429).
6. Dado que o endereço traz parâmetros de rastreamento, fragmento ou barra final, quando importo, então a URL é normalizada antes da busca e é a forma normalizada que fica salva em `sourceUrl`.

**Notas técnicas:** a extração tenta, nesta ordem, `articleBody` declarado em JSON-LD, o microdado `itemprop="articleBody"`, `<article>` e `main` e, por último, o maior container de texto. O microdado é o caminho usado no Literotica. A busca e a extração vivem em `lib/import-text.ts`, compartilhadas com `POST /api/share` (US-33).

### US-09: Importar pelo painel sem prévia

**Épico:** Biblioteca de textos
**Prioridade:** Should
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/components/import-card.tsx`, `src/app/(app)/dashboard/dashboard-client.tsx`

Como leitor, eu quero colar um link direto no painel, para que eu adicione um artigo à biblioteca em um passo.

**Critérios de aceitação**
1. Dado que colo uma URL válida no cartão de importação do painel, quando confirmo, então o texto é importado e salvo, e vejo o aviso "\"<título>\" adicionado a biblioteca.".
2. Dado que a importação falha, quando confirmo, então vejo a mensagem de erro retornada pela importação e nada é salvo.

**Notas técnicas:** reutiliza as regras de segurança e limites da US-08.

### US-10: Adicionar texto colado

**Épico:** Biblioteca de textos
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/api/texts/route.ts` (POST), `src/components/paste-form.tsx`, `src/app/(app)/textos/novo/page.tsx`

Como leitor, eu quero colar um texto meu, para que eu leia conteúdos que não estão publicados em uma URL.

**Critérios de aceitação**
1. Dado que colo o conteúdo e deixo o título vazio, quando salvo, então o título é formado pelas 6 primeiras palavras do texto.
2. Dado que salvo o texto, quando ele aparece na biblioteca, então a contagem de palavras foi calculada no servidor.
3. Dado que o conteúdo tem mais de 400.000 caracteres, quando salvo, então recebo "O texto e grande demais." (HTTP 413).
4. Dado que o título tem mais de 200 caracteres, quando salvo, então ele é truncado em 200.
5. Dado que o conteúdo tem menos de 10 palavras, quando salvo pelo formulário, então vejo "Cole um texto com pelo menos 10 palavras." e nada é enviado.

**Notas técnicas:** o formulário vive em `components/paste-form.tsx` e serve a duas telas: "Novo texto" e o compartilhamento de uma seleção (US-35).

### US-11: Listar textos da biblioteca

**Épico:** Biblioteca de textos
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/(app)/textos/texts-client.tsx`, `src/lib/queries.ts` (`loadTexts`), `src/lib/api.ts` (`readPageParams`)

Como leitor, eu quero ver meus textos com o progresso de cada um, para que eu escolha o que ler a seguir.

**Critérios de aceitação**
1. Dado que tenho textos salvos, quando abro "Meus textos", então vejo a lista paginada, do mais recente para o mais antigo, com título, número de palavras e progresso.
2. Dado que há mais textos que o tamanho da página, quando navego pela paginação, então vejo a página seguinte e o total de páginas.
3. Dado que não tenho textos, quando abro a biblioteca, então vejo "Nada por aqui ainda" com orientação para importar ou colar um texto.
4. Dado que a requisição informa `perPage` acima do máximo permitido, quando a lista é carregada, então o valor é limitado ao máximo (100; padrão 20).

### US-12: Editar texto

**Épico:** Biblioteca de textos
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/api/texts/[id]/route.ts` (PUT), `src/app/(app)/textos/texts-client.tsx`

Como leitor, eu quero corrigir título, conteúdo e link de origem de um texto, para que eu remova trechos mal extraídos.

**Critérios de aceitação**
1. Dado que altero título ou conteúdo, quando salvo, então vejo "Texto atualizado." e a contagem de palavras é recalculada.
2. Dado que salvei a edição, quando abro o texto no leitor, então a leitura começa do início, pois o progresso é zerado.
3. Dado que deixo título ou conteúdo vazio, quando salvo, então recebo "Titulo e conteudo sao obrigatorios.".

**Notas técnicas:** zerar o progresso evita posição além do novo fim. Uma alternativa futura é preservar a posição quando ela ainda for válida.

### US-13: Remover texto

**Épico:** Biblioteca de textos
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/api/texts/[id]/route.ts` (DELETE), `src/app/(app)/textos/texts-client.tsx`

Como leitor, eu quero remover textos que não vou mais ler, para que minha biblioteca fique organizada.

**Critérios de aceitação**
1. Dado que aciono "Remover", quando a confirmação aparece, então ela informa que o texto e todo o seu histórico de leitura serão apagados.
2. Dado que confirmo, quando a remoção termina, então vejo "Texto removido." e o texto e suas sessões deixam de existir.
3. Dado que a remoção falha, quando confirmo, então vejo "Falha ao remover." e o texto permanece na lista.

### US-14: Buscar textos na biblioteca

**Épico:** Biblioteca de textos
**Prioridade:** Could
**Story points:** 3
**Status:** Proposta
**Evidência:** `GET /api/texts` aceita apenas `page` e `perPage`

Como leitor, eu quero buscar textos pelo título e filtrar por status de leitura, para que eu encontre um texto sem percorrer todas as páginas.

**Critérios de aceitação**
1. Dado que digito parte de um título, quando a busca é aplicada, então vejo apenas textos cujo título contém o termo, sem diferenciar maiúsculas, minúsculas e acentos.
2. Dado que filtro por "Não iniciados", "Em andamento" ou "Concluídos", quando o filtro é aplicado, então a lista e a paginação refletem apenas esse grupo.
3. Dado que nenhum texto corresponde, quando a busca termina, então vejo estado vazio específico com opção de limpar o filtro.

---

## Épico: Compartilhamento

### US-33: Compartilhar um link do navegador para a biblioteca

**Épico:** Compartilhamento
**Prioridade:** Should
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/app/manifest.ts` (`share_target`), `src/app/(app)/compartilhar/page.tsx`, `src/app/(app)/compartilhar/share-import.tsx`, `src/app/api/share/route.ts`

Como leitor no celular, eu quero mandar um link direto do navegador para o app, para que eu não precise copiar o endereço, abrir a aplicação e colar.

**Critérios de aceitação**
1. Dado que o app está instalado na tela inicial, quando abro a folha de compartilhamento do navegador, então Leitura aparece na lista.
2. Dado que escolho Leitura, quando a tela abre, então vejo a origem e o progresso da importação enquanto a página é buscada.
3. Dado que a importação termina, quando o texto é salvo, então o leitor abre nele sem nenhum toque adicional.
4. Dado que a importação falha, quando o erro chega, então vejo a mensagem da origem, um botão de nova tentativa e um atalho para o importador manual.
5. Dado que o endereço chega no campo `text` em vez de `url`, quando a tela processa o compartilhamento, então a URL é encontrada mesmo cercada de outro texto.
6. Dado que não tenho sessão, quando o compartilhamento chega, então sou levado ao login e, ao entrar, a importação continua de onde parou (ver US-02, critério 2).

**Notas técnicas:** o `share_target` usa método GET porque POST exigiria um service worker. Como GET não pode ter efeito colateral, a navegação apenas decide o que fazer; a importação sai de `POST /api/share`, que importa e salva em uma chamada só para não somar duas idas e voltas de rede no celular.

### US-34: Reconhecer um texto já importado

**Épico:** Compartilhamento
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/lib/source-url.ts` (`normalizeSourceUrl`), `src/lib/queries.ts` (`findTextBySourceUrl`), `src/app/api/share/route.ts`

Como leitor, eu quero que compartilhar de novo um texto já salvo abra a leitura onde parei, para que a biblioteca não encha de cópias com o progresso zerado.

**Critérios de aceitação**
1. Dado que o endereço compartilhado já está na biblioteca, quando a tela abre, então o leitor abre no texto existente sem buscar a página de novo.
2. Dado que o endereço difere apenas por parâmetro de rastreamento (`utm_*`, `fbclid`), fragmento, barra final ou maiúsculas no host, quando comparo, então é reconhecido como o mesmo texto.
3. Dado que a origem redireciona para um endereço que já está na biblioteca, quando a busca termina, então nada é criado e o texto existente é aberto.
4. Dado que o texto é novo, quando é salvo, então `POST /api/share` responde `status: "created"` (HTTP 201); quando já existia, responde `status: "existing"` (HTTP 200).

**Notas técnicas:** a verificação acontece duas vezes — com o endereço recebido, antes de buscar, e com o endereço final, depois do redirecionamento.

### US-35: Compartilhar uma seleção de texto

**Épico:** Compartilhamento
**Prioridade:** Could
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/(app)/compartilhar/page.tsx`, `src/components/paste-form.tsx`

Como leitor, eu quero compartilhar um trecho selecionado de qualquer app, para que eu leia no meu ritmo conteúdos que não vêm de uma URL.

**Critérios de aceitação**
1. Dado que o compartilhamento traz texto e nenhum link, quando o trecho tem 10 palavras ou mais, então o formulário de texto colado abre preenchido com o conteúdo e o título recebidos.
2. Dado que o compartilhamento chega sem link e com menos de 10 palavras, quando a tela abre, então vejo "Nada para importar" com atalho para adicionar texto.
3. Dado que confirmo o formulário, quando o texto é salvo, então o leitor abre nele.

### US-36: Exigir confirmação em importação vinda de outro site

**Épico:** Compartilhamento
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/(app)/compartilhar/page.tsx` (`isTrusted`), `src/lib/auth.ts` (`sameSite: "lax"`)

Como leitor, eu quero que uma importação disparada por outro site exija meu toque, para que nenhuma página consiga usar minha sessão para fazer o servidor buscar um endereço escolhido por ela.

**Critérios de aceitação**
1. Dado que a navegação chega com `Sec-Fetch-Site: cross-site`, quando a tela abre, então nada é importado e vejo "Link compartilhado" com o botão "Importar e ler".
2. Dado que toco no botão, quando a importação termina, então o leitor abre normalmente.
3. Dado que a navegação vem da folha de compartilhamento do sistema ou da própria aplicação, quando a tela abre, então a importação começa sozinha.
4. Dado que a navegação é GET, quando a tela é renderizada, então nada é gravado no banco antes de `POST /api/share`.

**Notas técnicas:** o cookie de sessão é `SameSite=Lax` e acompanha navegação de topo, então a checagem de `Sec-Fetch-Site` é o que separa o compartilhamento legítimo de um link hostil. A falha é segura: qualquer valor inesperado do cabeçalho leva à tela de confirmação, nunca à importação automática.

---

## Épico: Leitor

### US-15: Ler no modo Foco

**Épico:** Leitor
**Prioridade:** Must
**Story points:** 8
**Status:** Implementada
**Evidência:** `src/app/(app)/leitor/[id]/reader-client.tsx` (`pauseFactor`, `orpIndex`), `src/lib/reading.ts`

Como leitor, eu quero ver o texto em blocos de palavras no centro da tela, com a letra de fixação destacada, para que eu leia mais rápido sem mover os olhos.

**Critérios de aceitação**
1. Dado que inicio a leitura no modo Foco, quando o texto avança, então cada bloco fica na tela pelo tempo calculado a partir da velocidade e do número de palavras por bloco.
2. Dado que o bloco termina em ponto final, interrogação ou exclamação, quando é exibido, então o tempo de exibição aumenta 60%; em vírgula, ponto e vírgula ou dois-pontos, aumenta 30%.
3. Dado que o bloco contém palavra com mais de 12 caracteres, quando é exibido, então o tempo aumenta mais 25%.
4. Dado que chego à última palavra, quando o bloco termina, então vejo a tela "Leitura concluida" com ppm e tempo da sessão.
5. Dado que o texto não tem palavras, quando abro o leitor, então vejo "Texto vazio".

### US-16: Ler no modo Rolagem

**Épico:** Leitor
**Prioridade:** Should
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/app/(app)/leitor/[id]/reader-client.tsx` (`SCREENFUL_WORDS`), `src/lib/reading.ts` (`sliceParagraphs`)

Como leitor, eu quero ver o texto corrido com o trecho atual destacado, para que eu mantenha o contexto dos parágrafos enquanto sigo o ritmo.

**Critérios de aceitação**
1. Dado que escolho o modo Rolagem, quando a leitura avança, então o trecho atual é destacado e a tela acompanha a posição.
2. Dado que o texto tem parágrafos, quando é exibido, então cada parágrafo é renderizado separadamente.
3. Dado que aciono "Proxima pagina" nesse modo, quando a ação é aplicada, então a posição avança 110 palavras.

### US-17: Ler no modo Páginas

**Épico:** Leitor
**Prioridade:** Should
**Story points:** 8
**Status:** Implementada
**Evidência:** `src/hooks/use-paged-text.ts`, `src/app/(app)/leitor/[id]/reader-client.tsx`

Como leitor, eu quero ler uma tela cheia por vez, sem rolagem, para que a experiência seja parecida com a de um leitor de livros digitais.

**Critérios de aceitação**
1. Dado que escolho o modo Páginas, quando o texto é exibido, então cada página começa no início de uma linha e nenhuma linha fica cortada.
2. Dado que toco na metade direita da tela ou arrasto para a esquerda, quando o gesto termina, então avanço uma página; na metade esquerda ou arrastando para a direita, volto uma página.
3. Dado que giro o dispositivo ou as fontes terminam de carregar, quando a área muda, então as páginas são recalculadas mantendo a palavra atual na página exibida.
4. Dado que a leitura automática está ativa, quando uma página é exibida, então ela permanece pelo tempo correspondente às palavras restantes nela na velocidade configurada.

### US-18: Controlar a reprodução

**Épico:** Leitor
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/(app)/leitor/[id]/reader-client.tsx` (`togglePlay`, `jump`, `turnPage`, atalhos de teclado)

Como leitor, eu quero pausar, voltar e avançar durante a leitura, para que eu releia trechos ou pule partes sem perder o ritmo.

**Critérios de aceitação**
1. Dado que estou lendo, quando aciono pausar, então o avanço e o cronômetro param e a posição é salva.
2. Dado que aciono "Voltar 10 palavras" ou "Avancar 10 palavras", quando a ação é aplicada, então a posição muda 10 palavras, sem ultrapassar o início nem o fim.
3. Dado que uso teclado no desktop, quando pressiono Espaço, então a leitura alterna entre iniciar e pausar; setas e PageUp/PageDown mudam de página.
4. Dado que o foco está em um campo de texto, quando pressiono essas teclas, então os atalhos não são acionados.
5. Dado que estou na tela de conclusão, quando aciono reiniciar, então a leitura volta à primeira palavra e o progresso salvo é zerado.

### US-19: Ajustar a leitura sem sair do texto

**Épico:** Leitor
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/(app)/leitor/[id]/reader-client.tsx` (painel "Ajustes de leitura")

Como leitor, eu quero mudar velocidade, modo e palavras por bloco durante a leitura, para que eu adapte o ritmo ao texto atual.

**Critérios de aceitação**
1. Dado que abro "Ajustes de leitura" no leitor, quando altero a velocidade, então posso escolher valores entre 100 e 1.200 ppm.
2. Dado que altero palavras por bloco, quando salvo, então posso escolher de 1 a 6 palavras.
3. Dado que troco o modo entre Foco, Rolagem e Páginas, quando fecho o painel, então a leitura continua na mesma palavra no novo modo.
4. Dado que salvei os ajustes, quando abro outro texto, então as mesmas preferências são aplicadas.

### US-20: Retomar a leitura de onde parei

**Épico:** Leitor
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/app/(app)/leitor/[id]/reader-client.tsx` (`saveProgress`), `src/app/api/texts/[id]/route.ts` (PATCH), `src/lib/queries.ts` (`loadOverview`)

Como leitor, eu quero que minha posição seja salva automaticamente, para que eu continue a leitura depois, inclusive em outro dispositivo.

**Critérios de aceitação**
1. Dado que estou lendo, quando se passam 5 segundos, então a posição atual é salva.
2. Dado que pauso, troco de aba, minimizo o navegador ou fecho a tela, quando isso ocorre, então a posição é salva, mesmo com a página sendo descarregada.
3. Dado que reabro o texto, quando o leitor carrega, então ele começa na palavra salva.
4. Dado que tenho textos iniciados e não concluídos, quando abro o painel, então vejo em "Continuar" o que foi lido mais recentemente.
5. Dado que o cliente envia posição maior que o total de palavras, quando a posição é salva, então ela é limitada ao total.

### US-21: Registrar sessões de leitura

**Épico:** Leitor
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/(app)/leitor/[id]/reader-client.tsx` (`flushSession`), `src/app/api/reading-sessions/route.ts`

Como leitor, eu quero que cada leitura gere um registro com ritmo, palavras e tempo, para que eu acompanhe minha evolução.

**Critérios de aceitação (cliente)**
1. Dado que li pelo menos 10 palavras por pelo menos 1 segundo, quando concluo o texto ou saio do leitor, então o leitor envia a sessão, marcada como concluída apenas se cheguei ao fim.
2. Dado que li menos que isso, quando saio, então o leitor não envia nada.

**Critérios de aceitação (servidor)**
3. Dado que a requisição traz `wordsRead` ou `durationMs` igual ou menor que zero, quando é processada, então recebo "Sessao sem leitura registrada." (HTTP 400).
4. Dado que a sessão é aceita, quando é gravada, então o ppm é recalculado no servidor a partir de palavras e duração, limitado a 1.200, e as palavras lidas não passam do total do texto.
5. Dado que o texto não pertence à minha conta, quando a sessão é enviada, então recebo "Texto nao encontrado." (HTTP 404).

**Notas técnicas:** o limiar de 10 palavras e 1 segundo é **do cliente** (`reader-client.tsx`, `MIN_WORDS_TO_RECORD`). O servidor aceita qualquer valor positivo, então uma requisição direta de 1 palavra em 1 ms é gravada e entra nas estatísticas. Se o limiar precisar valer para qualquer origem, é uma story nova de 1 ponto: mover a regra para a rota.

### US-22: Manter a tela ligada durante a leitura

**Épico:** Leitor
**Prioridade:** Could
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/hooks/use-wake-lock.ts`

Como leitor no celular, eu quero que a tela não apague enquanto a leitura avança, para que eu não precise tocar na tela durante o modo automático.

**Critérios de aceitação**
1. Dado que a leitura está em andamento, quando o navegador suporta a Wake Lock API, então a tela permanece ligada.
2. Dado que pauso a leitura, quando o avanço para, então o bloqueio é liberado.
3. Dado que o navegador não suporta a API, quando inicio a leitura, então o leitor funciona normalmente, sem mensagens de erro.

---

## Épico: Continuação de textos em partes

### US-23: Carregar a próxima parte do texto na origem

**Épico:** Continuação de textos em partes
**Prioridade:** Should
**Story points:** 8
**Status:** Implementada
**Evidência:** `src/app/api/texts/[id]/continuar/route.ts`, `src/lib/source-url.ts` (`pageFromUrl`), `src/app/(app)/leitor/[id]/reader-client.tsx` (`continueFromSource`)

Como leitor de contos publicados em várias páginas, eu quero que a próxima parte seja buscada quando chego ao fim, para que eu leia a história completa sem importar cada página.

**Critérios de aceitação**
1. Dado que cheguei ao fim de um texto importado, quando aciono a próxima página ou a opção de continuar na tela de conclusão, então a aplicação busca a URL original com `?page=` igual à última parte trazida mais 1, anexa o conteúdo e exibe "Parte N carregada: mais X palavras.".
2. Dado que a origem responde 404 ou 410, ou a página tem menos de 10 palavras, quando a busca termina, então vejo "Nao ha mais partes neste texto." e a leitura não é interrompida.
3. Dado que a origem ignora o parâmetro e devolve conteúdo já presente, quando a busca termina, então nada é anexado e sou informado de que não há mais páginas.
4. Dado que o texto foi colado manualmente, quando tento continuar, então vejo "Este texto foi colado manualmente, nao ha origem para buscar.".
5. Dado que importei uma URL que já aponta para `?page=3`, quando busco a continuação, então a próxima parte buscada é a 4.

**Notas técnicas:** limites de 200 partes e 400.000 caracteres por texto, e 30 buscas a cada 10 minutos por IP. Desfechos esperados retornam HTTP 200 com `status` próprio (`appended`, `end`, `unavailable`, `no-source`, `limit`, `full`). A detecção de página repetida compara parágrafos com limiar de 90%.

---

## Épico: Preferências

### US-24: Configurar preferências de leitura padrão

**Épico:** Preferências
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/(app)/ajustes/page.tsx`, `src/app/api/settings/route.ts`

Como leitor, eu quero definir modo, velocidade e palavras por bloco padrão com uma prévia, para que todos os textos abram no meu ritmo preferido.

**Critérios de aceitação**
1. Dado que altero modo, velocidade ou palavras por bloco em Ajustes, quando as alterações são salvas, então vejo "Preferencias salvas na sua conta." e a prévia reflete a configuração.
2. Dado que nunca salvei preferências, quando abro o leitor, então os padrões são modo Foco, 300 ppm e 1 palavra por bloco.
3. Dado que a requisição envia velocidade ou bloco fora da faixa, quando é processada, então os valores são ajustados ao limite mais próximo; modo ou tema inválidos voltam ao padrão.
4. Dado que o salvamento falha, quando altero uma opção, então vejo "Nao foi possivel salvar. Tente de novo.".

### US-25: Escolher o tema da interface

**Épico:** Preferências
**Prioridade:** Should
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/(app)/ajustes/page.tsx`, `src/components/providers.tsx`

Como leitor, eu quero escolher entre tema do sistema, claro ou escuro, para que a leitura seja confortável em qualquer ambiente de luz.

**Critérios de aceitação**
1. Dado que escolho "Sistema", quando o sistema operacional muda de tema, então a interface acompanha.
2. Dado que escolho claro ou escuro, quando navego ou abro outro dispositivo com a mesma conta, então o tema escolhido é mantido.

### US-26: Ajustar a intensidade do destaque

**Épico:** Preferências
**Prioridade:** Could
**Story points:** 2
**Status:** Parcial
**Evidência:** `highlightOpacity` existe em `src/db/schema.ts`, é validado em `src/app/api/settings/route.ts` (0,1 a 0,8) e chega ao cliente em `src/components/providers.tsx`, mas não há controle em `ajustes/page.tsx` nem uso no leitor

Como leitor, eu quero ajustar a intensidade do destaque do trecho atual, para que o realce não canse a vista nem fique imperceptível.

**Critérios de aceitação**
1. Dado que abro Ajustes, quando altero a intensidade do destaque, então posso escolher valores entre 10% e 80% e a prévia é atualizada.
2. Dado que salvei a intensidade, quando leio no modo Rolagem, então o trecho atual usa a opacidade configurada.
3. Dado que nunca alterei a opção, quando leio, então a intensidade padrão é 35%.

**Notas técnicas:** persistência, validação e transporte até o cliente já existem; falta o controle na tela e a aplicação no estilo do leitor. Alternativa: remover o campo, caso a opção tenha sido descartada.

---

## Épico: Painel e histórico

### US-27: Acompanhar indicadores no painel

**Épico:** Painel e histórico
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/(app)/dashboard/dashboard-client.tsx`, `src/lib/queries.ts` (`loadOverview`), `src/app/api/stats/route.ts`

Como leitor, eu quero ver totais de textos, sessões, palavras lidas e ppm médio e máximo, para que eu perceba minha evolução.

**Critérios de aceitação**
1. Dado que tenho sessões registradas, quando abro o painel, então vejo número de textos, sessões, palavras lidas, média de ppm e melhor ppm.
2. Dado que não tenho textos, quando abro o painel, então vejo "Biblioteca vazia" com o cartão de importação.
3. Dado que o banco está hibernado, quando abro o painel, então a estrutura da tela aparece de imediato com indicador de carregamento até os dados chegarem.

### US-28: Consultar o histórico de sessões

**Épico:** Painel e histórico
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/(app)/historico/history-client.tsx`, `src/app/api/reading-sessions/route.ts` (GET)

Como leitor, eu quero ver a lista das minhas leituras, para que eu compare ritmo e tempo entre sessões.

**Critérios de aceitação**
1. Dado que tenho sessões, quando abro "Historico", então vejo a lista paginada, da mais recente para a mais antiga, com título do texto, ppm, palavras, tempo e marca de concluída.
2. Dado que não tenho sessões, quando abro o histórico, então vejo "Sem historico ainda" e o botão "Ir para a biblioteca".

### US-29: Instalar como aplicativo

**Épico:** Painel e histórico
**Prioridade:** Could
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/manifest.ts`, `public/icon-*.png`

Como leitor no celular, eu quero instalar o Leitura na tela inicial, para que eu abra direto no painel, em tela cheia, e o app apareça na folha de compartilhamento.

**Critérios de aceitação**
1. Dado que o navegador oferece instalação, quando instalo, então o app aparece com nome "Leitura" e ícone adaptável.
2. Dado que abro o app instalado, quando ele inicia, então abre em `/dashboard`, sem barra do navegador e em orientação retrato.
3. Dado que o manifest é servido, quando é lido, então declara `scope: "/"` e um `share_target` apontando para `/compartilhar` (ver US-33).

---

## Épico: Plataforma e operação

### US-30: Verificar a saúde da aplicação

**Épico:** Plataforma e operação
**Prioridade:** Should
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/api/health/route.ts`, README (seção Deploy)

Como mantenedor, eu quero consultar um endpoint de diagnóstico, para que eu identifique problemas de banco ou configuração após um deploy.

**Critérios de aceitação**
1. Dado que chamo `GET /api/health`, quando a aplicação responde, então informa se o banco está acessível e se `DATABASE_URL` e `JWT_SECRET` estão presentes, sem expor valores.
2. Dado que a conexão de produção aponta para localhost, quando consulto o endpoint, então a resposta indica `pointsToLocalhost: true`.

### US-31: Limite de requisições compartilhado entre instâncias

**Épico:** Plataforma e operação
**Prioridade:** Should
**Story points:** 5
**Status:** Aguardando pendência
**Pendência:** exige um armazenamento externo com baixa latência a partir da Vercel (Upstash Redis ou equivalente). Sem a conta criada e as credenciais no ambiente, a story não pode começar.
**Evidência:** `src/lib/rate-limit.ts` (contagem em memória por processo)

Como mantenedor, eu quero que os limites de login, cadastro, importação e continuação valham para todas as instâncias, para que a proteção contra força bruta e uso como proxy seja efetiva na Vercel.

**Critérios de aceitação**
1. Dado que 10 tentativas de login do mesmo IP chegam a instâncias diferentes em 15 minutos, quando chega a 11ª, então ela é recusada com HTTP 429.
2. Dado que o armazenamento do limitador está indisponível, quando uma requisição chega, então o comportamento segue a política definida (bloquear ou liberar) e a falha é registrada em log.
3. Dado que a troca foi feita, quando as rotas chamam `rateLimit`, então a assinatura da função permanece a mesma.

**Notas técnicas:** em funções serverless cada instância mantém sua própria contagem, o que multiplica o limite efetivo. O próprio código já indica Redis ou Upstash como caminho. Observação, não defeito atual: `clientIp` lê `x-forwarded-for` e cai para `x-real-ip`; na Vercel o primeiro é reescrito pela plataforma, então o valor é confiável enquanto a aplicação estiver atrás desse proxy.

### US-32: Testes automatizados das regras críticas

**Épico:** Plataforma e operação
**Prioridade:** Should
**Story points:** 8
**Status:** Implementada
**Evidência:** `tests/` (67 testes em 5 arquivos), `vitest.config.mts`, `.github/workflows/ci.yml`, script `test` em `package.json`

Como mantenedor, eu quero testes automatizados para extração, segurança de importação, normalização de endereço, continuação e cálculo de sessões, para que alterações não reintroduzam defeitos já corrigidos.

**Critérios de aceitação**
1. Dado que executo `npm test`, quando os testes rodam, então cobrem `parser.ts` com HTML de `articleBody`, JSON-LD, `<article>` e fallback, incluindo diálogos curtos.
2. Dado que os testes de `safe-fetch.ts` rodam, quando recebem IPs privados, redirecionamento para rede interna e respostas acima de 3 MB, então todas as buscas são recusadas.
3. Dado que os testes de `source-url.ts` rodam, quando recebem rastreamento, fragmento, barra final, host em maiúsculas e URL dentro de uma frase, então a normalização e a extração devolvem o resultado esperado.
4. Dado que os testes da continuação rodam, quando simulam 404, página repetida e `?page=` já presente na URL importada, então os status retornados correspondem à US-23.
5. Dado que abro um pull request, quando o pipeline executa, então lint, typecheck e testes precisam passar para o merge.

**Notas técnicas:** a suíte cobre só regras puras, sem rede nem banco, para rodar em segundos a cada push. As funções de continuação saíram da rota para `lib/continuation.ts` — lógica pura dentro de um route handler não é verificável. A suíte foi conferida por mutação: inverter a conta de duração, comparar IPv6 por prefixo de texto e devolver o filtro de tamanho no container exato fazem 2, 1 e 1 teste falhar, respectivamente.

**Descoberta durante a implementação:** a ordem de extração documentada no README estava invertida. O código tenta `articleBody` de JSON-LD **antes** do microdado `itemprop`, não depois. O README foi corrigido e o teste fixa a ordem real.

---

## Épico: Produto: novas funcionalidades

Funcionalidades propostas para depois das stories acima. Nenhuma existe no
código: as estimativas foram feitas contra a base atual, e os critérios são
intenção de produto, não descrição de comportamento.

### US-37: Ler uma história em vários capítulos como uma série

**Épico:** Produto: novas funcionalidades
**Prioridade:** Should
**Story points:** 8
**Status:** Proposta
**Evidência:** a continuação (US-23) avança `?page=` **dentro** de um capítulo; capítulos diferentes (`the-cabin-ch-01`, `-ch-02`) são textos soltos, sem vínculo, em `src/db/schema.ts`

Como leitor de ficção seriada, eu quero que os capítulos de uma mesma história fiquem agrupados e encadeados, para que eu acompanhe a série sem importar capítulo por capítulo e sem procurar o próximo na lista.

**Critérios de aceitação**
1. Dado que importo ou compartilho um texto cujo título ou endereço indica capítulo ("Ch. 02", "-ch-02"), quando ele é salvo, então é vinculado à série dos capítulos já existentes da mesma história.
2. Dado que tenho capítulos de uma série, quando abro a biblioteca, então vejo um cartão por série, com o progresso no formato "cap. 3 de 7", em vez de um item por capítulo.
3. Dado que termino um capítulo, quando chego à tela de conclusão, então o app oferece o próximo capítulo: abre o que já está na biblioteca ou importa o seguinte da origem.
4. Dado que a origem não tem o próximo capítulo, quando tento avançar, então vejo mensagem de fim de série e a leitura não é interrompida.
5. Dado que o padrão de capítulo não é reconhecido, quando o texto é salvo, então ele fica solto na biblioteca, como hoje, sem erro.
6. Dado que abro uma série, quando vejo seus capítulos, então posso desvincular um capítulo ou a série inteira.

**Notas técnicas:** exige migration (`series_key` e `chapter` em `texts`, ou tabela própria) e detecção heurística por título e slug, confiável no padrão do Literotica e sujeita a falha em outras origens — daí o critério 5. Reaproveita `lib/source-url.ts` e a proteção anti-SSRF da importação.

### US-38: Consultar significado e tradução ao toque

**Épico:** Produto: novas funcionalidades
**Prioridade:** Could
**Story points:** 8
**Status:** Proposta
**Decisão pendente:** a metade de tradução exige um provedor externo. A metade de dicionário em inglês pode ser entregue antes, sem contratar nada.
**Evidência:** não há interação por palavra no leitor; os parágrafos são renderizados como blocos em `reader-client.tsx`

Como leitor de textos em outro idioma, eu quero tocar numa palavra e ver significado e tradução, para que eu não precise sair do app e perder o fio da leitura.

**Critérios de aceitação**
1. Dado que leio nos modos Rolagem ou Páginas, quando toco numa palavra, então uma folha inferior mostra a palavra, o significado e, quando disponível, a tradução.
2. Dado que leio no modo Foco, quando pauso e toco na palavra exibida, então vejo a mesma folha.
3. Dado que a consulta falha ou a palavra não é encontrada, quando a folha abre, então vejo mensagem própria e a leitura continua de onde estava.
4. Dado que consultei uma palavra, quando abro "Palavras salvas", então vejo a lista das consultas com o texto de origem.
5. Dado que a palavra vira alvo de toque, quando leio no modo Páginas, então a quebra de página continua idêntica à de hoje.

**Notas técnicas:** o critério 5 é o risco real: a régua de medição de `use-paged-text.ts` monta os mesmos parágrafos, então envolver cada palavra em um elemento próprio muda a medição se a régua não acompanhar. Requer rota própria passando por `lib/safe-fetch.ts`, tabela de palavras salvas e tratamento de limite do provedor.

### US-39: Ouvir o texto com a voz do aparelho

**Épico:** Produto: novas funcionalidades
**Prioridade:** Could
**Story points:** 8
**Status:** Proposta
**Evidência:** `ReadingMode` em `src/lib/reading.ts` tem apenas `rsvp`, `flow` e `page`

Como leitor, eu quero ouvir o texto em voz alta com a frase atual destacada, para que eu acompanhe a história com as mãos ou os olhos ocupados.

**Critérios de aceitação**
1. Dado que escolho o modo Audiolivro, quando inicio, então o texto é lido em voz alta pelo próprio aparelho e a frase atual fica destacada.
2. Dado que pauso ou saio, quando volto ao texto, então a leitura retoma na mesma posição e a sessão é registrada como nos demais modos.
3. Dado que abro os ajustes, quando escolho a voz, então vejo as vozes disponíveis no aparelho e a velocidade acompanha a configuração de ppm.
4. Dado que o navegador não oferece síntese de voz, quando escolho o modo, então vejo aviso claro e os outros modos continuam disponíveis.

**Notas técnicas:** usa `speechSynthesis`, no próprio aparelho, sem custo e sem chave. Exige segmentação por frase em `lib/reading.ts` e sincronia entre os eventos de fala e `progressIndex`. Limitação conhecida: reprodução com a tela bloqueada é instável nos navegadores móveis, então o caso "ouvir no caminho" fica parcialmente atendido.

### US-40: Ler sem conexão

**Épico:** Produto: novas funcionalidades
**Prioridade:** Could
**Story points:** 13
**Status:** Proposta
**Evidência:** não há service worker no projeto; o manifest não prevê cache

Como leitor em deslocamento, eu quero ler os textos que já abri mesmo sem rede, para que metrô, avião e área sem sinal não interrompam a leitura.

**Critérios de aceitação**
1. Dado que já abri um texto com rede, quando fico sem conexão, então consigo abrir e ler esse texto normalmente.
2. Dado que li sem conexão, quando a rede volta, então o progresso e as sessões registradas offline são enviados.
3. Dado que o mesmo texto avançou em outro dispositivo enquanto eu lia offline, quando a sincronização acontece, então a posição mais recente vence e nada é perdido silenciosamente.
4. Dado que estou sem conexão, quando tento importar uma URL, então vejo aviso de que a ação exige rede, em vez de erro genérico.
5. Dado que publico uma versão nova, quando abro o app, então não fico preso a uma versão em cache.

**Notas técnicas:** é a maior das quatro e a única que adiciona uma camada com risco de comportamento estranho em produção — o critério 5 existe por causa disso. O service worker passa a mediar chamadas autenticadas, o que exige cuidado com o cookie de sessão e com cache de resposta de API.

---

## Fora do escopo (Won't Have)

- **Importação de PDF e EPUB:** a importação aceita apenas páginas HTML (`O endereco nao devolveu uma pagina de texto.`).
- **Compartilhamento de textos entre usuários:** todas as consultas são restritas ao dono; compartilhar mudaria o modelo de privacidade. Não confundir com o épico Compartilhamento, que trata de trazer conteúdo de fora para dentro.
- **Gráficos de evolução de ritmo:** os dados existem nas sessões, mas o painel atual trabalha apenas com agregados.

## Sugestão de MVP e próximos passos

O MVP está implementado: as 15 stories Must somam 49 pontos e cobrem cadastro,
importação, compartilhamento, leitura com retomada e registro de sessões.

Restam quatro stories prontas para entrar em sprint e duas bloqueadas:

| Ordem | Stories | Pontos | Objetivo |
| --- | --- | --- | --- |
| ~~1~~ | ~~US-32~~ | ~~8~~ | Concluída: rede de testes e pipeline de CI |
| 1 | US-26, US-14 | 5 | Concluir o destaque e dar busca e filtro à biblioteca |
| 2 | US-07, US-06 | 6 | Conta: exclusão com eliminação de dados e edição de nome e senha |
| 3 | US-37 | 8 | Produto: séries de capítulos, a de maior valor no uso atual |
| 4 | US-39, US-38 | 16 | Produto: audiolivro e consulta ao toque |
| 5 | US-40 | 13 | Produto: leitura offline |
| — | US-05, US-31 | 10 | Aguardando pendência: provedor de e-mail e armazenamento do limitador |

A US-32 veio primeiro porque não dependia de nada externo e porque o histórico
do projeto já registrava três regressões que um teste teria pegado. O épico de
produto vem por último de propósito: cada uma das quatro é maior que tudo o que
está acima somado por ordem, e entra com a rede de testes já montada.
