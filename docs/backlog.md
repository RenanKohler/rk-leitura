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
- Os épicos US-01 a US-36 descrevem o que o código faz ou o que falta nele. Os
  oito épicos finais (US-37 a US-61) são de produto: funcionalidades que ainda
  não existem em lugar nenhum e cujas estimativas são previsões, não leitura.
- Três itens antes listados como Won't Have foram reavaliados e entraram:
  leitura offline (US-40), importação de PDF e EPUB (US-57 e US-58) e gráficos
  de evolução (US-48). Compartilhamento entre usuários continua fora.
- O fuso horário do usuário não é armazenado hoje. É o pré-requisito comum de
  US-41, US-42, US-48 e US-49, e deve ser a primeira entrega do épico de
  hábito.
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
| Hábito e metas | 3 | 11 | 2 | 1 | 0 |
| Treino de velocidade e compreensão | 4 | 24 | 2 | 1 | 1 |
| Estatísticas e evolução | 3 | 10 | 2 | 1 | 0 |
| Anotações e destaques | 3 | 11 | 2 | 1 | 0 |
| Organização da biblioteca | 4 | 18 | 1 | 2 | 1 |
| Importação ampliada | 3 | 18 | 0 | 2 | 1 |
| Ferramentas de leitura | 4 | 22 | 1 | 1 | 2 |
| Leitura offline | 1 | 13 | 0 | 1 | 0 |
| **Total** | **61** | **255** | **25 (41%)** | **25 (41%)** | **11 (18%)** |

Status: 42 Implementadas, 16 Propostas, 2 Aguardando pendência.

Os oito épicos finais (Hábito e metas em diante) reúnem o que ainda não existe
no código: são propostas de produto, não leitura dele. Vêm depois das demais.

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
**Status:** Implementada
**Evidência:** `PATCH /api/auth/me`, `src/components/account-card.tsx`

Como leitor, eu quero alterar meu nome de exibição e minha senha, para que eu mantenha meus dados atualizados sem criar outra conta.

**Critérios de aceitação**
1. Dado que altero o nome para um valor de 1 a 80 caracteres, quando salvo, então o novo nome aparece na navegação e em Ajustes.
2. Dado que informo a senha atual correta e uma nova senha com 8 ou mais caracteres, quando salvo, então a senha é alterada.
3. Dado que a senha atual está errada, quando salvo, então recebo mensagem de erro e nada é alterado.

**Notas técnicas:** o nome também vive no JWT, então a rota reemite a sessão — sem isso a navegação seguiria mostrando o nome antigo por até sete dias. Nome e senha são independentes: dá para mudar um, o outro ou os dois na mesma chamada. Trocar a senha exige a atual (403 quando erra), porque sem isso um cookie roubado bastaria para tomar a conta em definitivo; a rota divide o balde de limite com o login, já que confirmar a senha atual é um oráculo tão útil à força bruta quanto a tela de entrada.

### US-07: Excluir conta

**Épico:** Autenticação e conta
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** `DELETE /api/auth/me`, `src/app/sair/route.ts`, `src/lib/api.ts` (`requireSession`), `src/lib/queries.ts` (`loadSettings`), `src/app/(app)/layout.tsx`

Como leitor, eu quero excluir minha conta e todos os meus dados, para que eu exerça meu direito de eliminação de dados pessoais.

**Critérios de aceitação**
1. Dado que confirmo a exclusão informando minha senha, quando concluo, então usuário, textos, sessões e preferências são removidos e a sessão é encerrada.
2. Dado que a senha informada está errada, quando confirmo, então nada é removido.
3. Dado que a conta foi excluída, quando o token antigo é usado, então `/api/auth/me` retorna `user: null` e as telas redirecionam ao login.

**Notas técnicas:** atende ao direito de eliminação previsto na LGPD. A cascata do schema apaga textos, sessões e preferências junto, então basta uma instrução e não há estado parcial possível.

O caso do token pendurado foi resolvido de três lados, porque o middleware roda no Edge e não consulta banco: `requireSession` confirma a conta antes de qualquer rota de API responder — o que trocou uma classe de erro 500 por violação de chave estrangeira por um 401 honesto; `loadSettings` devolve `null` quando a conta sumiu, e o layout autenticado redireciona para `/sair`; `/sair` apaga o cookie e volta ao login. A rota existe porque um componente de servidor não pode apagar cookie durante a renderização, e redirecionar direto para `/login` entraria em laço — o middleware manda quem tem token válido de volta ao painel.

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
**Status:** Implementada
**Evidência:** `src/lib/text-filter.ts`, `src/lib/queries.ts` (`loadTexts` com `TextFilters`), `src/app/api/texts/route.ts` (`q` e `status`), `src/app/(app)/textos/texts-client.tsx`

Como leitor, eu quero buscar textos pelo título e filtrar por status de leitura, para que eu encontre um texto sem percorrer todas as páginas.

**Critérios de aceitação**
1. Dado que digito parte de um título, quando a busca é aplicada, então vejo apenas textos cujo título contém o termo, sem diferenciar maiúsculas, minúsculas e acentos.
2. Dado que filtro por "Não iniciados", "Em andamento" ou "Concluídos", quando o filtro é aplicado, então a lista e a paginação refletem apenas esse grupo.
3. Dado que nenhum texto corresponde, quando a busca termina, então vejo estado vazio específico com opção de limpar o filtro.
4. Dado que o termo contém `%` ou `_`, quando busco, então eles são procurados como texto comum, não como curinga.
5. Dado que estou na página 3 e mudo a busca ou o filtro, quando a lista recarrega, então volto à página 1.
6. Dado que digito, quando as teclas se sucedem, então só uma consulta é feita depois que a digitação para.

**Notas técnicas:** a dobra de acento usa `translate()` em SQL com o mesmo par de listas que `foldForSearch` usa no cliente — `unaccent` exigiria um `CREATE EXTENSION` fora das migrations, e um deploy novo passaria a depender de um passo manual. O teste fixa que as duas listas têm o mesmo tamanho: `translate()` apaga os caracteres sem par, então listas desiguais fariam letras sumirem do título consultado. O total e a contagem de páginas são calculados com o mesmo filtro da listagem.

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
**Status:** Implementada
**Evidência:** `src/lib/reading.ts` (`MIN_HIGHLIGHT`, `MAX_HIGHLIGHT`), `src/app/(app)/ajustes/page.tsx` (slider e prévia), `src/app/globals.css` (`--highlight-opacity`), `src/app/(app)/leitor/[id]/reader-client.tsx`

Como leitor, eu quero ajustar a intensidade do destaque do trecho atual, para que o realce não canse a vista nem fique imperceptível.

**Critérios de aceitação**
1. Dado que abro Ajustes, quando altero a intensidade do destaque, então posso escolher valores entre 10% e 80% e a prévia é atualizada.
2. Dado que salvei a intensidade, quando leio no modo Rolagem, então o trecho atual usa a opacidade configurada.
3. Dado que nunca alterei a opção, quando leio, então a intensidade padrão é 35%.

**Notas técnicas:** a intensidade desce por variável CSS (`--highlight-opacity`), então mudá-la não rerrenderiza palavra nenhuma: quem pinta o trecho é uma regra de estilo. O texto do trecho destacado passou a usar a tinta normal em vez da tinta do acento — com fundo translúcido é ela que tem contraste (10:1 no ajuste padrão contra menos de 2:1 da outra, medido nos dois temas). Um contorno de 1px mantém o trecho localizável na intensidade mínima. A faixa virou constante única em `lib/reading.ts`, lida pelo slider e pelo clamp da rota; antes cada lado guardava o próprio número.

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

## Épico: Hábito e metas

### US-41: Definir meta diária de leitura

**Épico:** Hábito e metas
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `reading_goals`, `src/lib/goals.ts`, `/api/metas`, `src/components/goal-card.tsx`

Como leitor, eu quero definir uma meta diária em minutos ou em palavras, para que eu crie o hábito de ler todos os dias.

**Critérios de aceitação**
1. Dado que defino em Ajustes uma meta de 5 a 180 minutos ou de 500 a 50.000 palavras, quando salvo, então o painel passa a exibir o progresso do dia em relação à meta.
2. Dado que registro sessões ao longo do dia, quando abro o painel, então o progresso soma todas as sessões do dia no meu fuso horário.
3. Dado que atinjo a meta durante uma leitura, quando a sessão é registrada, então vejo um aviso de meta concluída uma única vez naquele dia.
4. Dado que não defini meta, quando abro o painel, então o bloco de meta mostra apenas um convite para configurá-la.

**Notas técnicas:** requer armazenar o fuso horário do usuário (detectado no navegador e editável) — é o pré-requisito compartilhado por esta story, US-42, US-48 e US-49. O limiar de 10 palavras da US-21 é do cliente, então sessões curtas não chegam a ser registradas e não contam para a meta.

### US-42: Acompanhar sequência de dias

**Épico:** Hábito e metas
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `computeStreak` em `src/lib/goals.ts`, `loadGoalStatus` em `src/lib/queries.ts`

Como leitor, eu quero ver quantos dias seguidos atingi minha meta, para que eu tenha um incentivo para manter a regularidade.

**Critérios de aceitação**
1. Dado que atingi a meta em dias consecutivos, quando abro o painel, então vejo a sequência atual e a maior sequência já alcançada.
2. Dado que ainda não atingi a meta hoje, mas atingi ontem, quando abro o painel, então a sequência atual é mantida e sinalizada como pendente para hoje.
3. Dado que um dia inteiro passou sem a meta atingida, quando abro o painel no dia seguinte, então a sequência atual volta a zero e a maior sequência é preservada.
4. Dado que altero a meta, quando a mudança é salva, então os dias anteriores são avaliados pela meta vigente em cada dia.

**Notas técnicas:** o critério 4 exige guardar o histórico de metas (valor e data de vigência), não só o valor atual. Depende de US-41.

### US-43: Receber lembrete diário

**Épico:** Hábito e metas
**Prioridade:** Should
**Story points:** 5
**Status:** Proposta
**Decisão pendente:** a periodicidade do agendamento. O plano Hobby da Vercel limita a frequência dos cron jobs, o que define a granularidade possível do horário escolhido.

Como leitor, eu quero receber um lembrete no horário que escolher quando ainda não li no dia, para que eu não quebre minha sequência por esquecimento.

**Critérios de aceitação**
1. Dado que ativo lembretes e escolho um horário, quando concedo permissão de notificação, então passo a receber um lembrete diário nesse horário no meu fuso.
2. Dado que já atingi a meta do dia, quando chega o horário, então nenhum lembrete é enviado.
3. Dado que nego a permissão ou o navegador não suporta notificações, quando tento ativar, então vejo orientação de como habilitar ou a indicação de que o recurso não está disponível.
4. Dado que toco no lembrete, quando o app abre, então vou para o texto em andamento mais recente ou para a biblioteca, se não houver.

**Notas técnicas:** Web Push com chaves VAPID, que são geradas localmente e não exigem contratar nada. Exige service worker — o mesmo da US-40, então vale entregar as duas próximas uma da outra. No iOS, notificação web só funciona com o app instalado na tela inicial, o que já é requisito do compartilhamento (US-33).

---

## Épico: Treino de velocidade e compreensão

### US-44: Acelerar gradualmente no início da leitura

**Épico:** Treino de velocidade e compreensão
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `warmupFactor` e `chunkDurationMs` em `src/lib/reading.ts`, motor de avanco do leitor

Como leitor, eu quero que a velocidade comece mais baixa e suba até a configurada, para que eu me adapte ao ritmo sem perder as primeiras frases.

**Critérios de aceitação**
1. Dado que a aceleração gradual está ativa, quando inicio ou retomo a leitura, então a velocidade começa em 60% da configurada e atinge 100% ao longo das primeiras 50 palavras.
2. Dado que pauso por menos de 3 segundos, quando retomo, então a leitura continua na velocidade plena, sem nova aceleração.
3. Dado que desativo a opção em Ajustes, quando inicio a leitura, então ela começa direto na velocidade configurada.
4. Dado que a sessão usa aceleração, quando é registrada, então o ppm continua calculado a partir de palavras e duração reais.

**Notas técnicas:** entra em `chunkDurationMs`, que hoje é pura e testada. Manter a pureza: a rampa vira parâmetro da função, não estado escondido no leitor.

### US-45: Medir minha velocidade inicial

**Épico:** Treino de velocidade e compreensão
**Prioridade:** Must
**Story points:** 5
**Status:** Proposta

Como leitor novo, eu quero fazer um teste de leitura, para que o app sugira uma velocidade adequada em vez de eu escolher no escuro.

**Critérios de aceitação**
1. Dado que inicio o teste, quando leio um texto padrão em modo normal (sem avanço automático) e toco em "Terminei", então o app calcula meu ppm.
2. Dado que termino o texto, quando respondo 5 perguntas de múltipla escolha, então vejo ppm, percentual de acertos e uma velocidade sugerida.
3. Dado que acerto menos de 60%, quando a sugestão é calculada, então ela fica abaixo do ppm medido.
4. Dado que aceito a sugestão, quando confirmo, então ela passa a ser minha velocidade base; posso refazer o teste a qualquer momento em Ajustes.

**Notas técnicas:** textos e perguntas fixos, escritos para o teste e versionados no repositório, sem dependência de IA — é o que separa esta story da US-46 e o que a mantém entregável sem decisão externa. Oferecer no primeiro acesso após o cadastro, com opção de pular.

### US-46: Responder perguntas de compreensão ao concluir um texto

**Épico:** Treino de velocidade e compreensão
**Prioridade:** Should
**Story points:** 8
**Status:** Proposta
**Decisão tomada:** usa a API da Anthropic, com a chave em `ANTHROPIC_API_KEY` (guardada como variável sensível na Vercel) e sem teto mensal.

Como estudante, eu quero responder perguntas sobre o texto que acabei de ler, para que eu saiba se a velocidade está prejudicando meu entendimento.

**Critérios de aceitação**
1. Dado que concluo um texto com pelo menos 300 palavras, quando a tela de conclusão aparece, então posso iniciar um questionário de 3 a 5 perguntas de múltipla escolha sobre o conteúdo.
2. Dado que respondo o questionário, quando envio, então vejo acertos, a resposta correta de cada pergunta e o trecho do texto que a justifica.
3. Dado que a sessão tem questionário respondido, quando aparece no histórico, então exibe o percentual de compreensão ao lado do ppm.
4. Dado que o serviço de geração está indisponível ou o limite diário foi atingido, quando peço o questionário, então vejo mensagem informativa e a conclusão da leitura não é afetada.

**Notas técnicas:** cache por texto e versão do conteúdo, senão a continuação (US-23) faria regerar a cada parte anexada. O conteúdo do texto sai da aplicação rumo a um terceiro, o que precisa estar dito na tela antes do primeiro uso — vale lembrar que a biblioteca deste app guarda leitura pessoal.

### US-47: Seguir um programa de treino

**Épico:** Treino de velocidade e compreensão
**Prioridade:** Could
**Story points:** 8
**Status:** Proposta

Como leitor, eu quero seguir um programa com metas progressivas de velocidade, para que eu aumente meu ritmo de forma estruturada.

**Critérios de aceitação**
1. Dado que escolho um programa de 14 ou 30 dias, quando começo, então cada dia define uma velocidade alvo calculada a partir da minha velocidade atual.
2. Dado que concluo a sessão do dia na velocidade alvo, quando ela é registrada, então o dia é marcado como cumprido e o próximo é liberado.
3. Dado que a compreensão do dia fica abaixo de 60%, quando existir questionário (US-46), então o alvo do dia seguinte não aumenta.
4. Dado que abandono o programa, quando confirmo, então as preferências voltam à velocidade anterior ao programa.

**Notas técnicas:** depende de US-45. O critério 3 depende de US-46, que está bloqueada — então ele fica opcional, e o programa funciona sem ele.

---

## Épico: Estatísticas e evolução

### US-48: Ver a evolução do ritmo ao longo do tempo

**Épico:** Estatísticas e evolução
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `loadTrend` em `src/lib/queries.ts`, `src/components/trend-chart.tsx`, `/estatisticas`

Como leitor, eu quero ver um gráfico do meu ppm médio e do tempo de leitura por período, para que eu confirme se estou evoluindo.

**Critérios de aceitação**
1. Dado que tenho sessões registradas, quando abro Estatísticas, então vejo ppm médio e minutos lidos por dia nos últimos 30 dias e por semana nos últimos 6 meses.
2. Dado que um dia não tem sessões, quando o gráfico é exibido, então esse dia aparece vazio, sem interpolação.
3. Dado que tenho menos de 3 sessões, quando abro a tela, então vejo mensagem de dados insuficientes em vez do gráfico.
4. Dado que uso o app no celular, quando vejo o gráfico, então ele cabe na largura da tela e permite consultar o valor de cada ponto com toque.

**Notas técnicas:** agregação no banco por dia no fuso do usuário, seguindo o padrão de `loadOverview` — baixar o histórico para somar no cliente é justamente o que o painel evita hoje. Gráfico em SVG próprio: uma biblioteca de gráficos custaria mais bundle do que o desenho de duas séries.

### US-49: Receber um resumo semanal

**Épico:** Estatísticas e evolução
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** `loadWeeklySummary`, `/api/resumo-semanal`, `src/components/weekly-summary-card.tsx`

Como leitor, eu quero ver um resumo da semana anterior ao abrir o app na segunda-feira, para que eu compare meu desempenho sem precisar consultar gráficos.

**Critérios de aceitação**
1. Dado que li na semana anterior, quando abro o painel pela primeira vez na semana, então vejo um cartão com minutos lidos, palavras, ppm médio e textos concluídos, com variação em relação à semana anterior.
2. Dado que dispenso o cartão, quando volto ao painel, então ele não aparece novamente naquela semana.
3. Dado que não li na semana anterior, quando abro o painel, então o cartão não é exibido.

### US-50: Exportar meus dados de leitura

**Épico:** Estatísticas e evolução
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/api/exportar/route.ts`, `src/components/export-card.tsx`

Como leitor, eu quero baixar meu histórico de sessões e minha biblioteca, para que eu analise os dados em outra ferramenta e tenha uma cópia do que é meu.

**Critérios de aceitação**
1. Dado que aciono "Exportar dados" em Ajustes, quando escolho sessões, então baixo um CSV com data, título, ppm, palavras, duração e conclusão.
2. Dado que escolho biblioteca, quando exporto, então baixo um JSON com título, origem, conteúdo, progresso e datas de cada texto.
3. Dado que não tenho dados, quando exporto, então o arquivo contém apenas o cabeçalho ou uma lista vazia.

**Notas técnicas:** atende à portabilidade prevista na LGPD e fecha o par com a US-07, que já entrega a eliminação. É a menor story do backlog e a de maior valor por ponto.

---

## Épico: Anotações e destaques

### US-51: Destacar trechos durante a leitura

**Épico:** Anotações e destaques
**Prioridade:** Must
**Story points:** 5
**Status:** Proposta

Como estudante, eu quero marcar trechos importantes enquanto leio, para que eu os revise depois sem reler o texto inteiro.

**Critérios de aceitação**
1. Dado que estou no modo Rolagem ou Páginas, quando seleciono um trecho e aciono "Destacar", então o trecho fica marcado e continua visível ao reabrir o texto.
2. Dado que estou no modo Foco, quando aciono "Destacar frase", então a frase que contém a palavra atual é destacada sem interromper a leitura.
3. Dado que toco em um destaque existente, quando escolho remover, então ele deixa de existir.
4. Dado que edito o conteúdo do texto (US-12), quando salvo, então sou avisado de que os destaques serão removidos e posso cancelar.

**Notas técnicas:** armazenar início e fim por índice de palavra, coerente com `progressIndex`. A continuação (US-23) apenas anexa conteúdo, então os índices existentes seguem válidos; a edição não garante isso, e a US-12 já zera o progresso pelo mesmo motivo — daí o critério 4.

### US-52: Adicionar notas aos destaques

**Épico:** Anotações e destaques
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta

Como estudante, eu quero escrever uma nota em um destaque, para que eu registre minha interpretação junto do trecho.

**Critérios de aceitação**
1. Dado que toco em um destaque, quando escolho "Adicionar nota" e salvo um texto de até 2.000 caracteres, então a nota fica associada ao trecho.
2. Dado que um destaque tem nota, quando é exibido no leitor, então há um indicador visual que abre a nota ao toque.
3. Dado que apago todo o texto da nota, quando salvo, então a nota é removida e o destaque permanece.

### US-53: Revisar e exportar destaques

**Épico:** Anotações e destaques
**Prioridade:** Must
**Story points:** 3
**Status:** Proposta

Como estudante, eu quero ver todos os destaques de um texto em uma lista e exportá-los, para que eu use o material em resumos e anotações externas.

**Critérios de aceitação**
1. Dado que um texto tem destaques, quando abro "Destaques" a partir da biblioteca ou do leitor, então vejo os trechos na ordem do texto, com as notas.
2. Dado que toco em um destaque da lista, quando o leitor abre, então a leitura se posiciona no início desse trecho.
3. Dado que aciono "Exportar", quando confirmo, então baixo um arquivo Markdown com título, link de origem, trechos em citação e notas, ou copio o mesmo conteúdo para a área de transferência.

---

## Épico: Organização da biblioteca

### US-37: Ler uma história em vários capítulos como uma série

**Épico:** Organização da biblioteca
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

**Notas técnicas:** exige migration (`series_key` e `chapter` em `texts`, ou tabela própria) e detecção heurística por título e slug, confiável no padrão do Literotica e sujeita a falha em outras origens — daí o critério 5. Reaproveita `lib/source-url.ts` e a proteção anti-SSRF da importação. Série e etiqueta (US-54) resolvem problemas diferentes: uma é sequência automática, a outra é classificação manual.

### US-54: Organizar textos com etiquetas

**Épico:** Organização da biblioteca
**Prioridade:** Should
**Story points:** 5
**Status:** Proposta

Como leitor, eu quero atribuir etiquetas aos textos e filtrar por elas, para que eu separe estudo, trabalho e lazer.

**Critérios de aceitação**
1. Dado que edito um texto, quando adiciono etiquetas existentes ou crio novas (até 30 caracteres cada), então elas aparecem no card do texto.
2. Dado que escolho uma etiqueta no filtro da biblioteca, quando o filtro é aplicado, então a lista e a paginação mostram apenas textos com essa etiqueta.
3. Dado que renomeio ou excluo uma etiqueta, quando confirmo, então a mudança vale para todos os textos associados.

**Notas técnicas:** entra na barra de filtros que a US-14 já entregou, junto da busca e do estado de leitura — `TextFilters` em `lib/queries.ts` foi feito para receber mais um critério sem reescrita.

### US-55: Arquivar textos concluídos

**Épico:** Organização da biblioteca
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `texts.archivedAt`, `POST`/`DELETE /api/texts/[id]/arquivo`, aba na biblioteca

Como leitor, eu quero que textos concluídos saiam da lista principal sem serem apagados, para que a biblioteca mostre só o que ainda vou ler e o histórico seja preservado.

**Critérios de aceitação**
1. Dado que concluo um texto, quando volto à biblioteca, então ele aparece na aba "Arquivados", e não mais em "Meus textos".
2. Dado que desarquivo um texto, quando confirmo, então ele volta à lista principal com o progresso atual.
3. Dado que arquivo manualmente um texto não concluído, quando confirmo, então ele vai para "Arquivados" sem perder a posição de leitura.
4. Dado que um texto é arquivado, quando consulto histórico e estatísticas, então suas sessões continuam contabilizadas.

**Notas técnicas:** o filtro "Lidos" da US-14 já responde "o que terminei"; esta story separa o que ainda está em jogo do que saiu de cena, o que é uma pergunta diferente. Coluna `archived_at` em `texts`, acrescentada ao mesmo `TextFilters`.

### US-56: Montar uma fila de leitura

**Épico:** Organização da biblioteca
**Prioridade:** Could
**Story points:** 3
**Status:** Proposta

Como leitor, eu quero ordenar os próximos textos em uma fila, para que o app sugira automaticamente o próximo ao terminar um.

**Critérios de aceitação**
1. Dado que adiciono textos à fila, quando a abro, então posso reordená-los arrastando.
2. Dado que concluo um texto, quando a tela de conclusão aparece, então ela oferece abrir o próximo texto da fila.
3. Dado que um texto da fila é removido ou arquivado, quando isso ocorre, então ele sai da fila automaticamente.

---

## Épico: Importação ampliada

### US-57: Importar arquivos PDF

**Épico:** Importação ampliada
**Prioridade:** Should
**Story points:** 8
**Status:** Proposta

Como estudante, eu quero importar um PDF com texto, para que eu leia artigos acadêmicos e apostilas no ritmo do app.

**Critérios de aceitação**
1. Dado que envio um PDF de até 10 MB com texto selecionável, quando importo, então vejo título (dos metadados ou do nome do arquivo) e prévia do conteúdo com parágrafos.
2. Dado que o PDF tem cabeçalhos e números de página repetidos, quando o texto é extraído, então essas linhas repetidas são removidas.
3. Dado que o PDF é digitalizado e não tem camada de texto, quando importo, então vejo mensagem informando que o arquivo não contém texto extraível.
4. Dado que o texto extraído excede 400.000 caracteres, quando importo, então sou informado e posso importar apenas o trecho inicial.

**Notas técnicas:** extração no cliente com pdf.js evita o limite de corpo e de tempo das funções serverless. O arquivo não é armazenado, apenas o texto extraído — o que também mantém a superfície de dados igual à de hoje.

### US-58: Importar livros EPUB por capítulo

**Épico:** Importação ampliada
**Prioridade:** Could
**Story points:** 8
**Status:** Proposta

Como leitor, eu quero importar um EPUB sem DRM, para que eu leia livros no app capítulo a capítulo.

**Critérios de aceitação**
1. Dado que envio um EPUB sem DRM, quando importo, então vejo o sumário e escolho importar o livro inteiro ou capítulos específicos.
2. Dado que importo o livro inteiro, quando ele é salvo, então cada capítulo vira um texto com etiqueta do livro (US-54) e ordem preservada.
3. Dado que o EPUB tem DRM ou está corrompido, quando importo, então vejo mensagem específica e nada é salvo.

**Notas técnicas:** depende de US-54 para agrupar capítulos, e convém decidir antes se livro e série (US-37) são o mesmo conceito no schema. São: os dois são uma sequência ordenada de textos com uma origem comum.

### US-59: Importar a página atual pelo navegador

**Épico:** Importação ampliada
**Prioridade:** Should
**Story points:** 2
**Status:** Proposta

Como leitor no computador ou no iPhone, eu quero enviar a página que estou vendo para o Leitura com um toque, para que eu não precise copiar a URL.

**Critérios de aceitação**
1. Dado que instalo o favorito ("bookmarklet") oferecido em Ajustes, quando o aciono em uma página, então o Leitura abre em nova aba na importação com a URL preenchida.
2. Dado que uso iOS, quando sigo as instruções em Ajustes, então consigo criar um Atalho que envia a URL compartilhada para a mesma tela.
3. Dado que a URL recebida não é http ou https, quando a tela abre, então vejo a mensagem de URL inválida já existente na importação.

**Notas técnicas:** `/compartilhar?url=` já faz exatamente isso e já trata os três critérios, incluindo a confirmação exigida quando a navegação vem de outro site (US-36). Esta story é o que falta: o favorito, o Atalho do iOS e as instruções em Ajustes. É o caminho do iPhone, onde o Safari não implementa Web Share Target.

---

## Épico: Ferramentas de leitura

### US-60: Personalizar a tipografia

**Épico:** Ferramentas de leitura
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `typographyVars` em `src/lib/reading.ts`, `.reader-prose` em `globals.css`, controles em Ajustes

Como leitor, eu quero ajustar tamanho, família da fonte e espaçamento entre linhas, para que a leitura seja confortável para a minha visão.

**Critérios de aceitação**
1. Dado que abro Ajustes, quando altero tamanho (5 níveis), família (serifada, sem serifa ou fonte voltada a dislexia) ou espaçamento (3 níveis), então a prévia reflete a mudança imediatamente.
2. Dado que leio no modo Páginas, quando mudo a tipografia, então as páginas são recalculadas mantendo a palavra atual visível.
3. Dado que as preferências foram salvas, quando abro o app em outro dispositivo, então a mesma tipografia é aplicada.

**Notas técnicas:** segue o padrão que a US-26 estabeleceu — variável CSS na raiz do leitor, para que mudar o ajuste não rerrenderize palavra nenhuma. A régua de `use-paged-text.ts` já recalcula quando as fontes carregam; falta incluir a tipografia nas dependências do cálculo.

### US-39: Ouvir o texto em voz alta com destaque sincronizado

**Épico:** Ferramentas de leitura
**Prioridade:** Should
**Story points:** 8
**Status:** Proposta
**Evidência:** `ReadingMode` em `src/lib/reading.ts` tem apenas `rsvp`, `flow` e `page`

Como leitor, eu quero que o app leia o texto em voz alta enquanto destaca as palavras, para que eu continue a leitura em momentos em que não posso olhar para a tela o tempo todo.

**Critérios de aceitação**
1. Dado que ativo a leitura em voz alta, quando inicio, então o texto é narrado e o trecho narrado é destacado no modo Rolagem.
2. Dado que pauso, avanço ou volto, quando a ação é aplicada, então a narração acompanha a nova posição.
3. Dado que a velocidade configurada excede a suportada pela voz, quando a narração começa, então a velocidade é limitada e sou informado do valor aplicado.
4. Dado que o dispositivo não tem voz no idioma do texto, quando tento ativar, então vejo mensagem explicando a limitação.
5. Dado que a narração termina, quando uso a leitura em voz alta, então progresso e sessão são registrados como em uma leitura comum.

**Notas técnicas:** `speechSynthesis`, no próprio aparelho, sem custo e sem chave. Os eventos de fronteira de palavra variam entre navegadores e vozes, então prever sincronização por frase como alternativa. Limitação conhecida: reprodução com a tela bloqueada é instável nos navegadores móveis, o que atende só parcialmente o caso "ouvir no caminho". A narração não deve contar para o alvo de ppm do programa de treino (US-47).

### US-38: Consultar o significado de uma palavra

**Épico:** Ferramentas de leitura
**Prioridade:** Could
**Story points:** 8
**Status:** Proposta
**Decisão pendente:** a fonte do dicionário. Definição em inglês tem API gratuita e pode ser entregue sem contratar nada; tradução e dicionário em português exigem provedor, e a cobertura gratuita é fraca.
**Evidência:** não há interação por palavra no leitor; os parágrafos são renderizados como blocos em `reader-client.tsx`

Como leitor, eu quero tocar em uma palavra desconhecida e ver seu significado, para que eu não interrompa a leitura para pesquisar em outro app.

**Critérios de aceitação**
1. Dado que toco longamente em uma palavra no modo Rolagem ou Páginas, quando o toque é reconhecido, então a leitura pausa e vejo a definição em um painel.
2. Dado que leio no modo Foco, quando pauso e toco na palavra exibida, então vejo o mesmo painel.
3. Dado que a palavra está flexionada (plural, conjugação), quando a consulta é feita, então a busca tenta a forma base antes de informar que não encontrou.
4. Dado que fecho o painel, quando retomo, então a leitura continua da mesma posição.
5. Dado que consultei uma palavra, quando abro "Palavras salvas", então vejo a lista das consultas com o texto de origem.
6. Dado que a palavra vira alvo de toque, quando leio no modo Páginas, então a quebra de página continua idêntica à de hoje.

**Notas técnicas:** o critério 6 é o risco real e o que justifica os 8 pontos em vez dos 5 de uma estimativa superficial: a régua de `use-paged-text.ts` monta os mesmos parágrafos, então envolver cada palavra em um elemento próprio muda a medição se a régua não acompanhar. A consulta passa por `lib/safe-fetch.ts`. Integra com US-52 para salvar a palavra como nota.

### US-61: Enfatizar o início das palavras

**Épico:** Ferramentas de leitura
**Prioridade:** Could
**Story points:** 3
**Status:** Proposta

Como leitor, eu quero que as primeiras letras de cada palavra fiquem em negrito, para que eu teste se esse apoio visual melhora minha fluidez nos modos de texto corrido.

**Critérios de aceitação**
1. Dado que ativo a opção, quando leio nos modos Rolagem ou Páginas, então aproximadamente a primeira metade das letras de cada palavra aparece em negrito.
2. Dado que a opção está ativa, quando o modo Páginas calcula as páginas, então a medição considera a ênfase aplicada.
3. Dado que desativo a opção, quando volto ao texto, então ele é exibido sem ênfase.

**Notas técnicas:** não usar o nome comercial da técnica, que é marca registrada. Compartilha com a US-38 o problema de envolver cada palavra em um elemento próprio sem quebrar a régua de paginação — vale entregar as duas próximas uma da outra.

---

## Épico: Leitura offline

### US-40: Ler textos salvos sem conexão

**Épico:** Leitura offline
**Prioridade:** Should
**Story points:** 13
**Status:** Proposta
**Evidência:** não há service worker no projeto; o manifest não prevê cache

Como leitor, eu quero continuar lendo textos já abertos sem internet, para que eu aproveite viagens e locais com sinal ruim.

**Critérios de aceitação**
1. Dado que abri um texto com conexão, quando fico offline, então consigo abrir esse texto e os 20 textos mais recentes da biblioteca.
2. Dado que leio offline, quando progresso e sessões são gerados, então ficam em fila local e são enviados automaticamente ao reconectar.
3. Dado que o mesmo texto avançou em outro dispositivo enquanto eu estava offline, quando sincronizo, então prevalece a posição com atualização mais recente.
4. Dado que tento importar ou continuar um texto offline, quando aciono a ação, então vejo aviso de que a ação exige conexão.
5. Dado que publico uma versão nova, quando abro o app, então não fico preso a uma versão em cache.

**Notas técnicas:** service worker com IndexedDB. É a maior story do backlog e a única que adiciona uma camada com risco de comportamento estranho em produção — o critério 5 existe por causa disso. O service worker passa a mediar chamadas autenticadas, o que exige cuidado com o cookie de sessão e com cache de resposta de API; hoje o `middleware.ts` valida a sessão no servidor, e a navegação offline precisa de uma casca de app em cache. As sessões usam o horário do dispositivo para contar na meta do dia correto (US-41). O mesmo service worker serve à US-43.

---

## Fora do escopo (Won't Have)

- **Compartilhamento de textos e destaques entre usuários:** todas as consultas são restritas ao dono; compartilhar mudaria o modelo de privacidade. Não confundir com o épico Compartilhamento, que trata de trazer conteúdo de fora para dentro.
- **Resumo automático do texto antes da leitura:** seria uma segunda dependência de modelo de linguagem, com custo próprio. Reavaliar depois de medir uso e custo do questionário (US-46).
- **Aplicativos nativos:** o PWA com Share Target (US-33) e o modo offline (US-40) cobrem os principais casos de uso móvel.
- **Ranking e competição entre leitores:** depende de dados compartilhados e não se alinha ao objetivo de treino individual.

## Sugestão de MVP e próximos passos

O MVP está implementado: as stories extraídas do código estão todas fechadas,
com exceção das duas que dependem de decisão externa.

Entregue até aqui, em ordem:

| Stories | Pontos | Resultado |
| --- | --- | --- |
| US-33 a US-36 | 13 | Compartilhar do navegador direto para a biblioteca |
| US-32 | 8 | Rede de testes e pipeline de CI |
| US-26 | 2 | Intensidade do destaque |
| US-14 | 3 | Busca e filtro na biblioteca |
| US-07, US-06 | 6 | Exclusão de conta e edição de nome e senha |

Restam 27 stories: 24 prontas para entrar em sprint (119 pontos) e 3 travadas
por decisão externa (18 pontos). A ordem abaixo agrupa por dependência, não por
tema: cada faixa entrega algo utilizável e prepara a seguinte.

| Ordem | Stories | Pontos | Objetivo |
| --- | --- | --- | --- |
| ~~1~~ | ~~US-50, US-55, US-60, US-44~~ | ~~10~~ | Concluída: exportar dados, arquivar, tipografia e aceleração gradual |
| ~~2~~ | ~~US-41, US-42, US-48, US-49~~ | ~~14~~ | Concluída: meta diária, sequência, evolução e resumo semanal |
| 3 | US-51, US-52, US-53 | 11 | Estudo: destacar, anotar e exportar destaques. |
| 4 | US-37, US-54, US-56 | 16 | Organização: séries, etiquetas e fila. |
| 5 | US-45, US-47 | 13 | Treino: medir a velocidade inicial e o programa progressivo. |
| 6 | US-57, US-59, US-58 | 18 | Importação ampliada: PDF, favorito e EPUB. |
| 7 | US-39, US-61, US-38 | 19 | Ferramentas de leitura: voz alta, ênfase no início das palavras e dicionário. |
| 8 | US-40, US-43 | 18 | Offline e lembrete, que compartilham o service worker. |
| — | US-05, US-31 | 10 | Aguardando pendência: provedor de e-mail e armazenamento do limitador. |

Por que esta ordem e não a do documento de origem:

- **US-50 (exportar dados) primeiro.** São 2 pontos, fecha o par com a US-07
  que já entrega a eliminação, e não depende de nada.
- **O fuso horário é um marco, não um detalhe.** US-41, US-42, US-48 e US-49
  não podem ser entregues em sprints diferentes sem duplicar a decisão de como
  agrupar sessões por dia. Estão juntas de propósito.
- **US-38 e US-61 perto uma da outra.** As duas precisam envolver cada palavra
  em um elemento próprio sem quebrar a régua de paginação. Resolver isso duas
  vezes seria desperdício, e resolver mal quebra o modo Páginas.
- **US-40 e US-43 no fim, juntas.** As duas exigem service worker. É a camada
  de maior risco em produção, e entra por último, com a suíte de testes já
  montada.

Duas decisões pendentes travam 10 pontos. Nenhuma delas bloqueia as ordens 1 a
8: provedor de e-mail (US-05), armazenamento do limitador (US-31) e provedor de
modelo de linguagem com teto de custo (US-46).
