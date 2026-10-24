# Backlog: rk-leitura, sustentação

## Visão geral

Proposta de stories de sustentação para o rk-leitura: falhas, riscos e lacunas
encontrados numa auditoria do código depois da entrega das 170 stories
anteriores. A análise partiu do `main` no commit `a41d9a2` e cobriu quatro
frentes: progresso e modo offline, importação e leitor, conta e segurança,
estudo com IA e operação. A numeração continua a de
`docs/backlog-aprendizado.md`, a partir da US-171.

## Premissas

- As stories nasceram como **Proposta**; o campo Status de cada uma registra
  o andamento. Cada uma cita no campo Evidência o trecho
  do código que mostra a lacuna; a auditoria foi feita por leitura estática, sem
  executar os testes nem o app.
- Duas stories corrigem critérios de stories marcadas como implementadas: a
  US-175 cumpre o critério 2 da US-40 (fila offline) e a US-176 cumpre o
  critério 5 da US-40 (versão nova do cache descarta a anterior). A US-193
  amplia a US-143 para o que a IA gera no estudo.
- Os itens "Fora do escopo" dos três backlogs anteriores não foram reabertos.
- Nenhuma story pede provedor ou dependência nova. A US-184 usa o `undici`,
  que já acompanha o Node.
- Os valores citados nos critérios (limites, prazos, tamanhos) são pontos de
  partida e seguem as constantes que já existem no código quando há uma.
- Não foi possível ver pelo repositório o escopo das variáveis de ambiente na
  Vercel. A US-204 parte do risco de `DATABASE_URL` valer para Preview e
  Production ao mesmo tempo; se não valer, a story cai para Could.
- Velocidade de referência: 20 a 25 pontos por sprint de 2 semanas.

## Papéis

- **Leitor:** usuário autenticado que mantém a biblioteca e lê os textos.
- **Leitor que lê offline:** leitor que usa o app sem conexão (viagem, metrô) e
  depende da fila de sincronização.
- **Leitor que estuda:** leitor que usa cartões, glossário e revisões.
- **Mantenedor:** responsável pelo deploy, pela operação e pela segurança da
  aplicação.

## Resumo

| Épico | Stories | Pontos | Must | Should | Could |
| --- | --- | --- | --- | --- | --- |
| Progresso e leitura offline | 7 | 27 | 3 | 3 | 1 |
| Importação e narração | 5 | 16 | 1 | 3 | 1 |
| Segurança e privacidade da conta | 9 | 24 | 5 | 2 | 2 |
| Integridade do estudo e da IA | 9 | 21 | 4 | 3 | 2 |
| Operação e qualidade | 9 | 21 | 2 | 6 | 1 |
| **Total** | **39** | **109** | **15 (38%)** | **17 (44%)** | **7 (18%)** |

Must fica um pouco abaixo e Should um pouco acima da faixa de referência. Num
backlog de sustentação, Must ficou restrito ao que causa perda de dados do
leitor, falha de segurança ou quebra de regra já prometida (sem spoiler,
exclusão do que a IA gerou); o restante tem contorno até ser corrigido.

## Épico: Progresso e leitura offline

### US-171: Não perder a posição e as sessões quando a gravação falha

**Épico:** Progresso e leitura offline
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/app/(app)/leitor/[id]/reader-client.tsx:454-466` (`savedIndexRef` avança antes do fetch e o erro é engolido), `reader-client.tsx:481-500` (`postRecord` sem nova tentativa), `public/sw.js:83` (a fila descarta a entrada em qualquer 4xx)

Como leitor que lê offline, eu quero que minha posição e minhas sessões só
sejam dadas como salvas depois que o servidor confirmar, para que eu não perca
o que li por uma sessão expirada ou uma falha passageira.

**Critérios de aceitação**
1. Dado que o `PATCH` da posição responde 5xx ou falha por rede, quando o
   leitor tenta salvar de novo a mesma posição, então ela é reenviada, porque
   só é marcada como salva depois de `response.ok`.
2. Dado entradas na fila offline, quando o envio responde 401, 408, 429 ou 5xx,
   então a entrada continua na fila; só 400, 403, 404 e 409 a descartam.
3. Dado que a fila recebeu 401, quando o leitor entra de novo na mesma conta,
   então a fila é enviada e as sessões aparecem no histórico.
4. Dado que uma gravação falhou três vezes seguidas, quando o leitor está no
   texto, então aparece o aviso "Não foi possível salvar o progresso. Vamos
   tentar de novo quando a conexão voltar."

**Notas técnicas:** a US-175 guarda o dono de cada entrada da fila; as duas
devem ser entregues juntas para que uma entrada mantida no 401 não seja
enviada com a sessão de outra conta.

### US-172: Contar a sessão offline no dia em que a leitura aconteceu

**Épico:** Progresso e leitura offline
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/db/schema.ts:158` (`createdAt` com `defaultNow()`), `src/app/api/reading-sessions/route.ts:86-105` (sem hora da leitura), `public/sw.js:226` (`at: Date.now()` guardado e não enviado)

Como leitor que lê offline, eu quero que a sessão conte no dia em que li, para
que minha meta diária e minha sequência não quebrem por causa da hora em que a
conexão voltou.

**Critérios de aceitação**
1. Dado uma sessão lida offline na segunda e sincronizada na terça, quando ela
   chega ao servidor, então é gravada com a hora da leitura e conta para a meta
   e a sequência de segunda no fuso do leitor.
2. Dado uma hora enviada no futuro em relação ao servidor ou mais de 7 dias no
   passado, quando a sessão é gravada, então vale a hora do servidor.
3. Dado uma sessão gravada num dia anterior, quando ela chega, então o dia do
   programa de treino e o resumo semanal são recalculados para aquele dia.

### US-173: Reabrir um texto offline na última posição lida

**Épico:** Progresso e leitura offline
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** `src/app/(app)/leitor/[id]/page.tsx` (posição embutida no HTML), `public/sw.js:199` (HTML da última visita com rede), `reader-client.tsx:344-346` (posição inicial vem só de `text.progressIndex`)

Como leitor que lê offline, eu quero que o texto reabra onde parei mesmo sem
conexão, para que eu não precise procurar o ponto de leitura de novo.

**Critérios de aceitação**
1. Dado que li offline da palavra 1.000 à 6.000, quando volto à biblioteca e
   reabro o texto, então ele abre na palavra 6.000.
2. Dado uma posição local e uma posição no HTML, quando o leitor abre, então
   vale a mais recente pelas horas gravadas (regra de `newerPosition`).
3. Dado que saí da conta, quando outra conta abre o mesmo aparelho, então
   nenhuma posição local da conta anterior é usada.

### US-174: Continuar de onde parei em outro aparelho

**Épico:** Progresso e leitura offline
**Prioridade:** Should
**Story points:** 5
**Status:** Proposta
**Evidência:** `reader-client.tsx:938-944` (ao voltar a ficar visível, não consulta o servidor), `src/lib/offline.ts:84-85` (save ao vivo sempre vence), `src/app/api/texts/[id]/route.ts:204-208` (`kept: "servidor"` ignorado pelo cliente), `route.ts:139` (PUT zera a posição)

Como leitor, eu quero que uma aba antiga não apague o progresso que fiz em
outro aparelho, para que eu continue sempre do ponto mais avançado.

**Critérios de aceitação**
1. Dado que pausei na palavra 1.000 no celular e li até a 5.000 no computador,
   quando volto à aba do celular, então aparece "Você leu até a palavra 5.000
   em outro aparelho. Continuar de lá?" com "Continuar" e "Ficar aqui".
2. Dado que escolho "Continuar", quando a leitura retoma, então começa na
   palavra 5.000 e nenhuma gravação da posição 1.000 é feita.
3. Dado que o texto foi editado em outra aba, quando a aba antiga tenta salvar
   a posição, então o servidor recusa com 409 e a aba recarrega o texto.
4. Dado que a consulta ao servidor falha por rede, quando volto à aba, então a
   leitura segue da posição local sem aviso.

### US-175: Isolar a fila offline por conta e sincronizar em segundo plano

**Épico:** Progresso e leitura offline
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `public/sw.js:121-129` (o "limpar" não apaga o IndexedDB `leitura-offline`), `src/app/sair/route.ts:52-60`, `public/sw.js:236-238` (trata `sync` sem nenhum `sync.register` em `src/`)

Como leitor que lê offline, eu quero que minhas leituras pendentes fiquem
presas à minha conta e sejam enviadas assim que houver rede, para que nada se
perca ao trocar de conta ou fechar o app.

**Critérios de aceitação**
1. Dado entradas na fila, quando saio da conta, então elas são enviadas antes
   da saída ou guardadas com o id do dono e enviadas só quando o mesmo dono
   entrar de novo.
2. Dado que outra conta entra no aparelho, quando a fila é processada, então
   nenhuma entrada de outro dono é enviada.
3. Dado uma entrada enfileirada num navegador com Background Sync, quando a
   conexão volta com o app fechado, então a fila é enviada (`sync.register`
   "leitura-fila" chamado ao enfileirar).
4. Dado um navegador sem Background Sync, quando o app abre com rede, então a
   fila é enviada como hoje.

**Notas técnicas:** cumpre o critério 2 da US-40.

### US-176: Renovar o cache offline a cada deploy

**Épico:** Progresso e leitura offline
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** `public/sw.js:18` (`VERSION = "v1"` sem mudança no histórico), `sw.js:165` (`MAX_PAGES = 22`) contra `src/lib/offline.ts:19` (`OFFLINE_TEXTS = 20`), `QUEUEABLE` duplicado em `sw.js:32` e `offline.ts:28`, `OFFLINE_BUDGET_BYTES` declarado e sem uso (`offline.ts:22`)

Como leitor que lê offline, eu quero que o app offline seja o da versão atual,
para que eu não abra telas antigas depois de uma atualização.

**Critérios de aceitação**
1. Dado um deploy novo, quando o service worker é ativado, então a versão do
   cache muda (derivada do id do build) e os caches da versão anterior são
   apagados.
2. Dado as constantes de `offline.ts` e `sw.js`, quando os testes rodam, então
   um teste compara limite de textos e rotas enfileiráveis e falha se
   divergirem.
3. Dado um texto aberto offline depois do deploy, quando ele ainda não foi
   aberto com rede na versão nova, então o leitor aparece com o aviso "Abra este
   texto com conexão para atualizá-lo" em vez do HTML antigo.

**Notas técnicas:** cumpre o critério 5 da US-40. Decidir se `OFFLINE_BUDGET_BYTES`
passa a valer ou é removido.

### US-177: Destacar e anotar offline sem perder o destaque

**Épico:** Progresso e leitura offline
**Prioridade:** Could
**Story points:** 5
**Status:** Proposta
**Evidência:** `reader-client.tsx:571-590` (`notify(cause.message)`), `src/lib/client.ts:39-47` (`apiSend` sem tratamento de rede), `src/lib/offline.ts:25` (`/destaques` fora de `QUEUEABLE`)

Como leitor que lê offline, eu quero marcar trechos e escrever notas sem
conexão, para que eu não perca o que achei importante no metrô.

**Critérios de aceitação**
1. Dado que estou offline, quando destaco um trecho, então o destaque aparece
   no texto e é enviado quando a conexão volta.
2. Dado uma falha de rede em qualquer chamada do `apiSend`, quando ela ocorre,
   então a mensagem é "Sem conexão. Tente de novo quando a rede voltar." e
   nunca "Failed to fetch" ou "Load failed".
3. Dado um destaque enfileirado cujo texto foi removido em outro aparelho,
   quando a fila é enviada, então a entrada é descartada sem erro na tela.

## Épico: Importação e narração

### US-178: Importar páginas e arquivos em outras codificações

**Épico:** Importação e narração
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/lib/safe-fetch.ts:206` (sempre `new TextDecoder("utf-8")`), `src/components/file-import.tsx:202,225` (`file.text()`)

Como leitor, eu quero que páginas e arquivos em ISO-8859-1 ou Windows-1252
sejam importados com os acentos certos, para que dicionário, narração e
destaques funcionem nesses textos.

**Critérios de aceitação**
1. Dado uma página com `Content-Type: text/html; charset=iso-8859-1`, quando a
   importo por URL, compartilhamento, feed ou série, então "atenção" aparece
   como "atenção".
2. Dado uma página sem charset no cabeçalho e com `<meta charset="windows-1252">`
   ou `<?xml encoding="...">`, quando a importo, então vale a declaração do
   documento.
3. Dado um .txt salvo em Windows-1252, quando o importo, então a leitura em
   UTF-8 estrito falha e o arquivo é lido como Windows-1252.
4. Dado uma codificação não reconhecida, quando a importo, então vale UTF-8,
   como hoje.

### US-179: Aplicar o limite de tamanho em todas as importações

**Épico:** Importação e narração
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** `src/app/api/share/route.ts:60-73`, `src/lib/follow-runner.ts:154-167` e `src/lib/chapter-import.ts:66-80` (inserem sem checar tamanho) contra `src/app/api/texts/route.ts:80` e `src/app/api/texts/[id]/route.ts:85` (recusam acima de 400 mil caracteres); `textos/texts-client.tsx:246-256` (o editor sempre manda `content`)

Como leitor, eu quero que todo texto importado respeite o mesmo limite, para
que eu consiga editar título e etiquetas de qualquer texto da biblioteca.

**Critérios de aceitação**
1. Dado um conteúdo acima de 400 mil caracteres vindo de compartilhar, feed ou
   série, quando é importado, então é cortado no limite com o aviso "Texto
   cortado em 400 mil caracteres", igual à importação por URL.
2. Dado um texto da biblioteca acima do limite, quando altero só título ou
   etiquetas, então a gravação funciona, porque o conteúdo não é enviado nem
   validado quando não mudou.
3. Dado que altero o conteúdo de um texto acima do limite, quando salvo, então
   aparece "O texto é grande demais", como hoje.

### US-180: Importar EPUB sem corte silencioso e retomar sem duplicar

**Épico:** Importação e narração
**Prioridade:** Should
**Story points:** 5
**Status:** Proposta
**Evidência:** `src/components/file-import.tsx:322-328` (`body.slice(0, MAX_IMPORT_CHARS)` com `words` do corpo inteiro e sem `setTruncated`), `file-import.tsx:371-383` (`saveBook` sem deduplicar)

Como leitor de textos longos, eu quero que capítulos grandes não sejam cortados
sem aviso e que um salvamento interrompido continue de onde parou, para que o
livro chegue inteiro e sem capítulos repetidos.

**Critérios de aceitação**
1. Dado um EPUB com um capítulo acima de 400 mil caracteres, quando o
   pré-visualizo, então o capítulo é dividido em partes dentro do limite, com a
   contagem de palavras de cada parte.
2. Dado que o salvamento falhou no capítulo 7 de 20, quando toco "Salvar" de
   novo, então o envio continua do capítulo 7 e os capítulos 1 a 6 não são
   duplicados.
3. Dado uma falha no meio do salvamento, quando ela ocorre, então aparece
   "6 de 20 capítulos salvos. Tente de novo para continuar."

### US-181: Explicar por que um PDF não abriu

**Épico:** Importação e narração
**Prioridade:** Could
**Story points:** 1
**Status:** Proposta
**Evidência:** `src/lib/pdf-client.ts:34-36` (sem tratar `PasswordException` e `InvalidPDFException`), `src/components/file-import.tsx:123-130` (mostra `cause.message`)

Como leitor, eu quero uma mensagem clara quando um PDF não pode ser importado,
para que eu saiba se o problema é senha ou arquivo danificado.

**Critérios de aceitação**
1. Dado um PDF protegido por senha, quando o escolho, então aparece "Este PDF é
   protegido por senha. Remova a senha e tente de novo."
2. Dado um PDF corrompido, quando o escolho, então aparece "Não foi possível
   ler este PDF. O arquivo pode estar corrompido."
3. Dado qualquer outro erro do pdf.js, quando ocorre, então a mensagem é em
   português, sem o texto original em inglês.

### US-182: Narrar no primeiro toque com a voz do sistema

**Épico:** Importação e narração
**Prioridade:** Should
**Story points:** 2
**Status:** Proposta
**Evidência:** `src/hooks/use-speech.ts:215-221` (`getVoices()` só no toque, sem `voiceschanged` em `src/`)

Como leitor, eu quero que a narração comece no primeiro toque, para que o app
não diga que meu aparelho não tem voz quando ele tem.

**Critérios de aceitação**
1. Dado o Chrome no Android ou no desktop, quando abro o texto e toco em
   "Narrar" pela primeira vez, então a narração começa com a voz do idioma do
   texto.
2. Dado que as vozes ainda não carregaram, quando toco em "Narrar", então o app
   espera o evento `voiceschanged` por até 2 segundos antes de decidir.
3. Dado um aparelho realmente sem voz do idioma, quando o prazo termina, então
   aparece a mensagem atual de voz indisponível.

## Épico: Segurança e privacidade da conta

### US-183: Parar as notificações ao sair ou desconectar um aparelho

**Épico:** Segurança e privacidade da conta
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/api/auth/logout/route.ts:4-9`, `src/app/api/auth/aparelhos/[deviceId]/route.ts:26`, `src/components/providers.tsx:240-255`, `src/app/api/cron/lembretes/route.ts:118-121`, `src/lib/follow-runner.ts:111-115,196-200`

Como leitor, eu quero que um navegador do qual saí deixe de receber
notificações da minha conta, para que títulos dos meus textos não apareçam num
computador compartilhado ou num aparelho perdido.

**Critérios de aceitação**
1. Dado que saio da conta num navegador, quando os lembretes e avisos de
   capítulo novo rodam, então esse navegador não recebe nada (a inscrição do
   endpoint é apagada e `pushManager.unsubscribe` é chamado).
2. Dado que desconecto um aparelho em "Aparelhos conectados", quando o cron
   roda, então a inscrição desse aparelho foi apagada.
3. Dado que uso "Sair de todos os aparelhos" ou troco a senha, quando a ação
   termina, então todas as inscrições da conta são apagadas e o aparelho atual
   pode ativar de novo em Ajustes.

**Notas técnicas:** a inscrição precisa ficar ligada à sessão (`auth_sessions`)
para a desconexão de um aparelho apagar a dele.

### US-184: Bloquear acesso à rede interna por troca de DNS na importação

**Épico:** Segurança e privacidade da conta
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/lib/safe-fetch.ts:169` (validação com `lookup` próprio) e `safe-fetch.ts:241` (`fetch(url)` resolve o nome de novo)

Como mantenedor, eu quero que a importação conecte só no endereço que foi
validado, para que um domínio malicioso não leve o servidor a endereços
internos.

**Critérios de aceitação**
1. Dado um domínio que responde um IP público na validação e `169.254.169.254`
   na conexão, quando é importado, então a conexão vai para o IP validado ou é
   recusada com "Endereço não permitido".
2. Dado redirecionamentos, quando cada salto é seguido, então a mesma regra vale
   em cada salto.
3. Dado um teste unitário com resolvedor simulado que muda a resposta, quando a
   suíte roda, então a conexão a endereço privado nunca acontece.

**Notas técnicas:** `Agent` do `undici` com `connect.lookup` fixo no IP
validado, mantendo SNI e cabeçalho `Host` do nome original.

### US-185: Limitar tentativas de login por conta

**Épico:** Segurança e privacidade da conta
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/api/auth/login/route.ts:12` (chave só por IP) contra `src/app/api/auth/recuperar/route.ts:43` (limite também por e-mail)

Como leitor, eu quero que minha conta resista a tentativas de senha vindas de
muitos endereços, para que ninguém descubra minha senha por força bruta.

**Critérios de aceitação**
1. Dado 10 tentativas erradas para o mesmo e-mail em 15 minutos, vindas de IPs
   diferentes, quando a 11ª chega, então a resposta é 429 com "Muitas
   tentativas. Tente de novo em alguns minutos."
2. Dado o bloqueio por e-mail, quando o login certo é tentado durante a janela,
   então também é recusado, sem revelar se a senha estava certa.
3. Dado um e-mail com maiúsculas ou espaços, quando a chave é montada, então
   vale o e-mail normalizado (`normalizeEmail`).

### US-186: Neutralizar fórmulas nas planilhas exportadas

**Épico:** Segurança e privacidade da conta
**Prioridade:** Must
**Story points:** 1
**Status:** Implementada
**Evidência:** `src/app/api/exportar/route.ts:153-157` (`escapeCell`) e `src/lib/vocabulary.ts:164-167` (`csvCell`)

Como leitor, eu quero abrir os CSVs exportados no Excel sem executar nada, para
que um título de página importada não rode uma fórmula na minha planilha.

**Critérios de aceitação**
1. Dado uma célula que começa com `=`, `+`, `-`, `@`, tab ou CR, quando o CSV é
   gerado, então ela recebe o prefixo `'`.
2. Dado células comuns, quando o CSV é gerado, então o conteúdo segue igual ao
   de hoje.
3. Dado os dois geradores, quando os testes rodam, então um teste cobre o
   título `=HYPERLINK(...)` nos dois.

### US-187: Tirar dados pessoais e conteúdo dos logs

**Épico:** Segurança e privacidade da conta
**Prioridade:** Should
**Story points:** 2
**Status:** Proposta
**Evidência:** `src/lib/rate-limit.ts:78`, `src/app/api/texts/[id]/pergunta/route.ts:146`, `src/lib/ai.ts:244` (erro do Drizzle com `params` direto no `console.error`)

Como leitor, eu quero que meu e-mail e o conteúdo dos meus textos não apareçam
nos logs do servidor, para que a promessa da US-73 valha também em falhas do
banco.

**Critérios de aceitação**
1. Dado uma falha do banco no limitador, quando o erro é logado, então a chave
   com o e-mail não aparece.
2. Dado uma falha ao gravar a pergunta ao texto, quando o erro é logado, então
   pergunta, resposta e trechos não aparecem.
3. Dado os três pontos citados, quando o erro é logado, então passa por
   `summarizeError()`, e um teste garante que `params` não sai no log.

### US-188: Mostrar só aparelhos com sessão válida

**Épico:** Segurança e privacidade da conta
**Prioridade:** Could
**Story points:** 2
**Status:** Proposta
**Evidência:** `src/app/api/auth/aparelhos/route.ts:19` (filtra só `revokedAt IS NULL`), `src/lib/auth.ts:128` (uma linha por login), `src/lib/session-token.ts:11` (token de 7 dias)

Como leitor, eu quero ver em "Aparelhos conectados" só as sessões que ainda
valem, para que eu reconheça de fato quem tem acesso à minha conta.

**Critérios de aceitação**
1. Dado sessões criadas há mais de 7 dias, quando abro "Aparelhos conectados",
   então elas não aparecem.
2. Dado sessões revogadas ou vencidas há mais de 30 dias, quando o cron de
   acompanhamento roda, então elas são apagadas.
3. Dado a sessão atual, quando abro a lista, então ela continua marcada como
   "Este aparelho".

### US-189: Exportar todos os dados da conta

**Épico:** Segurança e privacidade da conta
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/app/api/exportar/route.ts:64-139` e `src/lib/backup.ts:42-55` (faltam `author`, `seriesKey`, `seriesTitle`, `chapter`, `abandonedAt`, `sections` e as tabelas `ask_turns`, `ai_results`, `reading_goals`, `speed_settings`, `feeds`, `series_follows`, `training_programs`, `review_answers`, `quiz_recalls`)

Como leitor, eu quero que a exportação leve tudo o que a conta guarda, para que
eu possa sair do app ou restaurar numa conta nova sem perder nada.

**Critérios de aceitação**
1. Dado uma conta com séries, feeds, metas e perguntas ao texto, quando exporto
   "Conta completa", então o arquivo traz todos os campos e tabelas listados na
   Evidência.
2. Dado esse arquivo, quando o restauro numa conta nova, então autor, vínculo
   de série e capítulo voltam, e textos largados continuam largados.
3. Dado um backup no formato anterior, quando o restauro, então ele continua
   aceito.
4. Dado uma tabela nova no schema sem entrada na exportação, quando os testes
   rodam, então um teste falha listando a tabela.

**Notas técnicas:** é a portabilidade da LGPD, par da exclusão de conta
(US-07). Envelope v3 com `BackupTextSchema` ampliado.

### US-190: Avisar sobre senhas acima de 72 bytes

**Épico:** Segurança e privacidade da conta
**Prioridade:** Could
**Story points:** 1
**Status:** Proposta
**Evidência:** `src/app/api/auth/register/route.ts:35`, `src/app/api/auth/me/route.ts:83`, `src/app/api/auth/recuperar/route.ts:39` (só mínimo de 8) e `src/lib/auth.ts:29-31` (bcrypt corta em 72 bytes)

Como leitor, eu quero saber quando minha senha passa do que o sistema
considera, para que uma frase-senha longa não seja mais fraca do que parece.

**Critérios de aceitação**
1. Dado uma senha com mais de 72 bytes em UTF-8, quando cadastro, troco ou
   redefino a senha, então aparece "A senha pode ter até 72 caracteres (menos
   se tiver acentos)."
2. Dado senhas já gravadas com mais de 72 bytes, quando a pessoa entra, então o
   login segue funcionando como hoje.

### US-191: Manter os códigos de recuperação ao trocar o segredo das sessões

**Épico:** Segurança e privacidade da conta
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** `src/lib/recovery.ts:22-26` (hash usa `jwtSecret()`), `.env.example:18` e `README.md:82` (só citam a queda das sessões)

Como leitor, eu quero que meus códigos de recuperação continuem valendo depois
de uma troca do segredo do servidor, para que eu não perca a conta ao esquecer
a senha.

**Critérios de aceitação**
1. Dado que o `JWT_SECRET` foi trocado, quando uso um código de recuperação
   válido, então consigo redefinir a senha.
2. Dado a nova variável `RECOVERY_PEPPER`, quando ela não está definida, então
   o app usa o `JWT_SECRET` como hoje e o `/api/health` informa a ausência.
3. Dado o README, quando descreve a troca do `JWT_SECRET`, então diz o que ela
   invalida.

**Notas técnicas:** migrar os hashes atuais exige reemitir os códigos; a
transição pode aceitar os dois temperos até a próxima troca de códigos.

## Épico: Integridade do estudo e da IA

### US-192: Manter os cartões de estudo alinhados ao texto

**Épico:** Integridade do estudo e da IA
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/lib/reprocess.ts:97-117` (remapeia só `highlights` e `bookmarks`), `src/app/api/texts/[id]/route.ts:138,150-155`, `src/lib/study-card-drafts.ts:231-250` e `src/app/api/texts/[id]/cartoes-estudo/route.ts:115-132` (posição de origem aceita do cliente)

Como leitor que estuda, eu quero que os cartões continuem apontando para o
trecho certo depois de reprocessar ou editar o texto, para que eu não veja
cartões de partes que não li nem cartões de um conteúdo que não existe mais.

**Critérios de aceitação**
1. Dado que omito e restauro as referências de um texto, quando o
   reprocessamento termina, então `sourceStart` e `sourceEnd` dos cartões são
   remapeados como os destaques, e nenhum cartão de trecho não lido aparece.
2. Dado que reescrevo o conteúdo do texto, quando salvo, então os cartões
   gerados pela IA são apagados e os manuais ficam marcados "Trecho de origem
   alterado".
3. Dado que o conteúdo mudou entre gerar e salvar cartões, quando salvo, então
   o servidor relocaliza cada trecho com `locatePassage` e descarta os que não
   encontra.
4. Dado os três casos acima, quando os testes rodam, então cada um tem teste.

### US-193: Apagar também o que a IA gerou no estudo

**Épico:** Integridade do estudo e da IA
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/api/ia/resultados/route.ts:18-24,44-53` (apaga e conta só `ai_results` e `ask_turns`)

Como leitor, eu quero que "Apagar o que a IA gerou" leve também cartões,
analogias e questionários gerados, para que a tela diga a verdade sobre o que
fica guardado.

**Critérios de aceitação**
1. Dado cartões de estudo gerados pela IA e não editados, analogias, cartões de
   destaque e questionários, quando apago os resultados, então todos são
   removidos.
2. Dado cartões gerados que editei, quando apago os resultados, então eles
   ficam e a confirmação diz "N cartões editados por você foram mantidos".
3. Dado a contagem antes da confirmação, quando abro a opção, então ela inclui
   esses itens por tipo.

**Notas técnicas:** amplia a US-143. Exige marcar em `study_cards` se o cartão
foi editado depois da geração.

### US-194: Garantir no servidor que as perguntas-guia não revelam o que vem depois

**Épico:** Integridade do estudo e da IA
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/api/texts/[id]/guia/route.ts:37-48` (aceita qualquer seção), `src/components/guide-questions.tsx:21-47` (opção só no `localStorage`)

Como leitor que estuda, eu quero que só a seção que estou começando seja
enviada para gerar perguntas-guia, para que elas nunca adiantem o desfecho.

**Critérios de aceitação**
1. Dado que estou na seção 2, quando peço perguntas-guia da seção 2 ou 3, então
   o pedido é aceito.
2. Dado que estou na seção 2, quando chega um pedido da seção 8, então a
   resposta é 403 e nada é enviado à IA.
3. Dado a regra, quando os testes rodam, então um teste da montagem do pedido a
   cobre, como nas US-128 e US-149.

### US-195: Devolver a cota quando a resposta da IA não serve

**Épico:** Integridade do estudo e da IA
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** cota consumida antes da chamada em `src/lib/study-tools.ts:124` e `cartoes-estudo/gerar/route.ts:74`; respostas vazias com 503 em `glossario/route.ts:55`, `fichamento/route.ts:58`, `guia/route.ts:56`, `cartao/route.ts:51` e 422 em `study-card-generator.ts:132`; `recordResponse` em `src/lib/ai.ts:257-268` só conhece "recusa" e "sucesso"

Como leitor que estuda, eu quero que uma geração que falhou ou veio vazia não
gaste minha cota do dia, para que eu possa tentar de novo.

**Critérios de aceitação**
1. Dado timeout, falha da API ou validação que não deixa nada passar, quando a
   rota responde erro, então a unidade da cota volta (`releaseDailyQuota`).
2. Dado validação vazia, quando o uso é registrado, então o resultado é
   "inválida", e o relatório da US-141 a mostra separada de sucesso.
3. Dado uma geração bem-sucedida, quando termina, então a cota é descontada
   como hoje.

### US-196: Encerrar o questionário antes do teto da função

**Épico:** Integridade do estudo e da IA
**Prioridade:** Should
**Story points:** 1
**Status:** Proposta
**Evidência:** `src/lib/quiz-generator.ts:87-101,136-150` (`aiParse` sem `timeoutMs`), `questionario/route.ts:23` e `compreensao/route.ts:23` (`maxDuration = 60`)

Como leitor em treino, eu quero uma mensagem clara quando o questionário demora
demais, para que eu saiba que posso tentar de novo sem perder a cota.

**Critérios de aceitação**
1. Dado uma geração de questionário que passa de 50 segundos, quando o prazo
   termina, então a chamada é cancelada, a falha é registrada como "tempo" e a
   cota é devolvida (US-195).
2. Dado o cancelamento, quando a tela recebe a resposta, então aparece "O
   questionário demorou demais. Tente de novo." e não um 504 genérico.

### US-197: Impedir cartões de estudo duplicados

**Épico:** Integridade do estudo e da IA
**Prioridade:** Should
**Story points:** 2
**Status:** Proposta
**Evidência:** `src/app/api/texts/[id]/cartoes-estudo/route.ts:121-132` (PUT insere sem comparar), `glossario/cartao/route.ts:46-52` (insere sempre), `glossary-panel.tsx:78` (bloqueio só local)

Como leitor que estuda, eu quero que o mesmo cartão não seja salvo duas vezes,
para que a revisão e a retenção não contem em dobro.

**Critérios de aceitação**
1. Dado um cartão já salvo, quando salvo de novo a mesma frente (outra aba ou
   glossário reaberto), então o servidor descarta a repetição pela frente
   normalizada (`frontKey`).
2. Dado o descarte, quando a tela recebe a resposta, então aparece "Já existe
   um cartão com essa frente".
3. Dado duas gravações simultâneas, quando chegam ao banco, então só uma é
   gravada (índice único por texto e frente normalizada).

### US-198: Ignorar a nota repetida de um item que não está vencido

**Épico:** Integridade do estudo e da IA
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/api/cartoes/[id]/revisao/route.ts:38-52`, `src/app/api/palavras/revisao/route.ts:44-53`, `src/app/api/destaques/revisao/route.ts:52` (nenhuma confere vencimento)

Como leitor que estuda, eu quero que uma resposta enviada duas vezes conte uma
vez só, para que os intervalos de revisão e a retenção fiquem certos.

**Critérios de aceitação**
1. Dado um cartão de 4 dias respondido "Bom", quando a mesma nota chega duas
   vezes, então o intervalo vai para 10 dias e só uma linha é gravada em
   `review_answers`.
2. Dado um item que não está vencido hoje, quando chega uma nota, então a rota
   responde 200 com o estado atual, sem gravar.
3. Dado palavras, destaques e cartões, quando os testes rodam, então a regra é
   coberta nas três rotas.

### US-199: Vencer a primeira revisão do destaque pelo dia do leitor

**Épico:** Integridade do estudo e da IA
**Prioridade:** Could
**Story points:** 2
**Status:** Proposta
**Evidência:** `src/lib/learning-queries.ts:89-92` (`createdAt < now() - 1 day`), `src/lib/study-review-queries.ts:565,646`

Como leitor que estuda, eu quero que um destaque vença no dia seguinte do meu
fuso, como palavras e cartões, para que a revisão do dia e o lembrete batam com
o que a tela promete.

**Critérios de aceitação**
1. Dado um destaque criado às 22h, quando abro a revisão na manhã seguinte,
   então ele está vencido.
2. Dado "N itens amanhã", quando a contagem é feita, então usa o dia no fuso do
   leitor (`todayIn`), igual a `firstReview` das palavras.

### US-200: Nomear as funções de estudo no histórico de envios

**Épico:** Integridade do estudo e da IA
**Prioridade:** Could
**Story points:** 1
**Status:** Proposta
**Evidência:** `src/lib/ai-history.ts:12-25` (`FEATURE_LABELS` termina em `semana`)

Como leitor, eu quero ver o nome de cada função no histórico do que foi enviado
à IA, para que eu reconheça cada envio.

**Critérios de aceitação**
1. Dado envios de `estudo`, `cartao`, `glossario`, `fichamento`, `guia`,
   `apontamentos` e `analogia`, quando abro o histórico, então cada um aparece
   com nome em português ("Cartões de estudo", "Glossário", "Explicar com as
   próprias palavras" etc.).
2. Dado uma chave de `AI_MODELS` sem rótulo, quando os testes rodam, então um
   teste falha.

## Épico: Operação e qualidade

### US-201: Mostrar os lembretes de leitura e de revisão separados

**Épico:** Operação e qualidade
**Prioridade:** Must
**Story points:** 1
**Status:** Implementada
**Evidência:** `public/sw.js:255` (`tag: "lembrete-diario"` fixa), `src/app/api/cron/lembretes/route.ts:131-145` (dois envios seguidos), `src/lib/push.ts` (`PushPayload` sem `tag`)

Como leitor, eu quero receber o lembrete de leitura e o de revisão, para que um
não apague o outro no meu aparelho.

**Critérios de aceitação**
1. Dado os dois lembretes ligados, quando o cron envia os dois, então as duas
   notificações ficam visíveis (`lembrete-leitura` e `lembrete-revisao`).
2. Dado um payload sem `tag`, quando chega ao service worker, então vale
   `lembrete-diario`, para não quebrar inscrições antigas.

### US-202: Acusar quando o lembrete deixa de ser enviado

**Épico:** Operação e qualidade
**Prioridade:** Should
**Story points:** 2
**Status:** Proposta
**Evidência:** `src/app/api/cron/lembretes/route.ts:45-46` (200 com `motivo: "push não configurado"`), `.github/workflows/lembretes.yml:59`, `src/app/api/health/route.ts:14-19`

Como mantenedor, eu quero que o workflow e o health acusem quando o push está
sem configuração, para que o lembrete não fique parado por semanas sem aviso.

**Critérios de aceitação**
1. Dado chaves VAPID ausentes, quando o cron roda, então a rota responde 503 e
   o workflow falha.
2. Dado `GET /api/health`, quando chamado, então informa presença (sem o valor)
   de `NEXT_PUBLIC_VAPID_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` e
   `AI_USAGE_SECRET`.

### US-203: Dar prazo ao cron de lembretes

**Épico:** Operação e qualidade
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** `src/app/api/cron/lembretes/route.ts:21,67-163` (`maxDuration = 60`, laço sem prazo), `src/lib/push.ts:58-62` (`sendNotification` sem `timeout`), `lembretes.yml:47`

Como mantenedor, eu quero que um serviço de push lento não derrube o envio dos
lembretes, para que todos os inscritos recebam o lembrete a cada hora.

**Critérios de aceitação**
1. Dado um endpoint de push que não responde, quando o envio passa de 10
   segundos, então é cancelado e o laço segue para o próximo.
2. Dado o laço perto de 50 segundos, quando o prazo chega, então ele para,
   grava as marcas já enviadas e responde com o número de pendentes, como a
   rota `cron/acompanhamento` faz com `BUDGET_MS`.
3. Dado candidatos pendentes, quando a próxima execução roda, então eles são
   os primeiros.

### US-204: Aplicar as migrations só no deploy de produção

**Épico:** Operação e qualidade
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `package.json:11` (`"vercel-build": "npm run db:migrate && next build"`), `README.md:65-67`

Como mantenedor, eu quero que um preview de PR não altere o banco de produção,
para que uma migration ainda não aprovada não derrube o app no ar.

**Critérios de aceitação**
1. Dado um deploy de Preview, quando o build roda, então `db:migrate` não roda
   (condição `VERCEL_ENV=production`).
2. Dado um deploy de Production, quando o build roda, então as migrations são
   aplicadas antes do `next build`, como hoje.
3. Dado o README, quando descreve o deploy, então registra a regra de
   migrations aditivas (expandir antes, remover depois) e o novo comportamento.

**Notas técnicas:** se `DATABASE_URL` já for separada por ambiente na Vercel, a
story cai para Could; isso não é visível pelo repositório.

### US-205: Barrar na CI um schema sem migration

**Épico:** Operação e qualidade
**Prioridade:** Could
**Story points:** 1
**Status:** Proposta
**Evidência:** `.github/workflows/ci.yml` (sem passo de `drizzle-kit generate` ou `check`), `README.md:13` ("Node.js 20+") contra `package.json` (`engines` `>=22 <23`)

Como mantenedor, eu quero que a CI falhe quando `src/db/schema.ts` mudar sem
migration, para que uma coluna ou índice não fique só no código.

**Critérios de aceitação**
1. Dado uma mudança no schema sem `npm run db:generate`, quando a CI roda,
   então o passo gera a migration num diretório temporário e falha se surgir
   SQL novo.
2. Dado schema e migrations em dia, quando a CI roda, então o passo passa.
3. Dado o README, quando cita a versão do Node, então bate com `engines`.

### US-206: Indexar as consultas frequentes e limitar o registro de uso da IA

**Épico:** Operação e qualidade
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** `src/db/schema.ts:743` (`ai_usage` só com índice `(created_at, feature)`), `src/app/api/ia/historico/route.ts:33-37`, `src/db/schema.ts:160` (`reading_sessions` sem índice em `text_id`), `src/lib/queries.ts:753,1467`, `src/lib/cloze-quiz.ts:40,87,113`

Como mantenedor, eu quero índices nas colunas consultadas e uma retenção para o
`ai_usage`, para que histórico e exclusões continuem rápidos no banco gratuito.

**Critérios de aceitação**
1. Dado a migration nova, quando aplicada, então existem os índices
   `ai_usage(user_id, created_at desc)` e `reading_sessions(text_id)`.
2. Dado linhas de `ai_usage` com mais de 400 dias, quando o cron de
   acompanhamento roda, então são apagadas em lotes.
3. Dado o relatório de uso da IA (`/api/uso-ia`), quando consultado depois da
   limpeza, então os últimos 400 dias seguem iguais.

### US-207: Cobrir com testes a cota, os lotes e o cron

**Épico:** Operação e qualidade
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** nenhum arquivo em `tests/` importa `src/lib/daily-quota.ts`, `word-batch.ts`, `follow-runner.ts`, `recovery.ts`, `push.ts`, `study-review-queries.ts` ou `learning-queries.ts`

Como mantenedor, eu quero testes nas regras de cota, lotes e cron, para que uma
regressão no teto de custo ou na devolução de cota não passe pela CI.

**Critérios de aceitação**
1. Dado a aritmética de reserva e devolução de cota, quando extraída para
   funções puras, então tem testes de teto, devolução e dia novo.
2. Dado `word-batch.ts` e `follow-runner.ts`, quando os testes rodam, então a
   regra de pular por prazo e a devolução de unidades de lote têm teste.
3. Dado o job da CI que já tem Postgres, quando roda, então um teste de
   integração exercita `reserveDailyQuota` e `releaseDailyQuota` no banco.

### US-208: Cobrir com testes de ponta a ponta a conta e as sessões

**Épico:** Operação e qualidade
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** `e2e/conta-dados.spec.ts` (só recuperação, desconexão de um aparelho e restauração); sem teste para `DELETE /api/auth/me`, troca de senha (`me/route.ts:124`), `logout/todos`, rotas de cron sem segredo e 429 de login e cadastro

Como mantenedor, eu quero testes das regras de conta e sessão, para que uma
refatoração não volte a deixar um token antigo válido.

**Critérios de aceitação**
1. Dado dois contextos de navegador na mesma conta, quando troco a senha num
   deles, então o outro recebe 401 na próxima chamada.
2. Dado "Sair de todos os aparelhos", quando executado, então todos os
   contextos perdem a sessão.
3. Dado a exclusão de conta, quando concluída, então textos, sessões e
   inscrições da conta não existem mais no banco.
4. Dado as rotas de cron e `/api/uso-ia` sem segredo, quando chamadas, então
   respondem 401.

### US-209: Calcular o "tempo livre" sem carregar o conteúdo dos textos

**Épico:** Operação e qualidade
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
**Evidência:** `src/lib/queries.ts:1341-1364` (`loadTimeWindow` lê e analisa o `content` de até 70 textos por chamada)

Como leitor, eu quero que a sugestão do que ler no tempo livre abra rápido,
para que a tela não espere o servidor ler a biblioteca inteira.

**Critérios de aceitação**
1. Dado a fila e os textos recentes, quando chamo `/api/tempo-livre`, então a
   consulta usa contagem de palavras e posição já gravadas, sem ler `content`.
2. Dado as sugestões de hoje, quando a mudança é aplicada, então as mesmas
   sugestões aparecem para a mesma biblioteca (teste comparando as duas
   versões).

## Fora do escopo (Won't Have)

- **Resposta genérica no cadastro para não revelar e-mails existentes:**
  `register/route.ts:45-46` responde "Esse e-mail já está cadastrado." Com o
  limite por conta no login (US-185), a enumeração deixa de ajudar na força
  bruta, e a resposta genérica pioraria o cadastro de quem esqueceu que já tem
  conta. A decisão fica registrada aqui.
- **Paginação em segundo plano para textos longos (`use-paged-text.ts`):** o
  custo aparece só no redimensionamento; vale medir antes de mover a paginação
  para um worker.
- **Fila de leitura recusando ids fora da fila (`PUT /api/fila`):** o efeito é
  um texto voltar para a fila numa aba desatualizada, e o leitor desfaz com um
  toque. Entra se aparecer relato de uso.

## Sugestão de MVP

Total Must: 15 stories, 47 pontos, 2 sprints. A estimativa deve ser
recalibrada depois da primeira sprint.

**Sprint 1 (24 pontos, Must: perda de dados e segurança)**
- US-171 Não perder posição e sessões em falha de gravação (5)
- US-175 Isolar a fila offline por conta (3)
- US-172 Sessão offline no dia da leitura (3)
- US-183 Parar notificações ao sair (3)
- US-185 Limite de login por conta (2)
- US-186 Neutralizar fórmulas nos CSVs (1)
- US-201 Lembretes de leitura e revisão separados (1)
- US-204 Migrations só em produção (2)
- US-198 Ignorar nota repetida (2)
- US-194 Perguntas-guia sem spoiler no servidor (2)

**Sprint 2 (23 pontos, Must restantes)**
- US-184 Bloquear troca de DNS na importação (5)
- US-178 Importar outras codificações (5)
- US-192 Cartões alinhados ao texto (5)
- US-189 Exportar todos os dados da conta (5)
- US-193 Apagar o que a IA gerou no estudo (3)

**Depois, por ordem sugerida (Should)**
- US-195 e US-196 juntas, US-174, US-173, US-176, US-179, US-180, US-182, US-187,
  US-191, US-197, US-202, US-203, US-206, US-207, US-208, US-209

**Could, conforme sobrar capacidade**
- US-177, US-181, US-188, US-190, US-199, US-200, US-205
