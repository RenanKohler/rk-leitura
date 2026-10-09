# Backlog: rk-leitura, segunda rodada de IA

## Visão geral

Proposta de stories para melhorar, ampliar e acrescentar funções de IA ao
rk-leitura, o leitor pessoal com biblioteca, Word Runner, narração e treino de
velocidade e compreensão. A análise partiu do código no `main` (commit
`2c70bca`), em que as 18 stories de IA da rodada anterior (US-123 a US-140)
estão implementadas. A numeração continua a de `docs/backlog.md`, a partir da
US-141.

## Premissas

- Toda story usa só a integração que já existe: `@anthropic-ai/sdk`, chave em
  `ANTHROPIC_API_KEY`, acesso único por `src/lib/ai.ts`. Nenhuma exige
  provedor novo ou dependência nova no `package.json`.
- As regras da rodada anterior continuam valendo e não são repetidas em cada
  story: consentimento por conta (US-125), cota diária por função (US-72),
  registro de uso (US-124) e, nas funções sobre "o que já li", recorte que
  termina na posição de leitura, garantido na montagem do pedido e coberto por
  teste.
- Os itens do Won't Have de `docs/backlog.md` não foram reabertos: conversa sem
  texto aberto, perguntas abertas com correção por IA, busca por significado,
  tradução do texto inteiro, ajuste automático de velocidade e narração com voz
  gerada por IA.
- Lacunas observadas no código, que motivam stories:
  - `recordUsage` só grava chamadas que deram certo; falha, recusa e tempo
    esgotado ficam apenas no log do servidor (`src/lib/ai.ts`).
  - Não há teste que verifique as saídas reais do modelo, só os recortes e a
    validação das respostas.
  - As respostas chegam inteiras, sem streaming; a explicação tem espera de
    até 30 segundos (`EXPLAIN_TIMEOUT_MS`).
  - A conversa de "Perguntar ao texto" vive na folha e não é gravada
    (`src/lib/ask.ts`).
  - A explicação de frase não tem pedido de continuação: a folha só fecha
    (`src/components/explain-sheet.tsx`).
  - Os resultados guardados em `ai_results` não têm como ser apagados pelo
    leitor, a não ser excluindo o texto.
- Cotas, tetos de palavras e preços citados são pontos de partida, a revisar
  com os dados da US-124 e da US-141.
- Velocidade de referência: 20 a 25 pontos por sprint de 2 semanas.

## Papéis

- **Leitor:** usuário autenticado que mantém a biblioteca e lê os textos.
- **Leitor em treino:** leitor que mede velocidade e compreensão.
- **Leitor que estuda outro idioma:** leitor que consulta palavras e revisa
  vocabulário.
- **Mantenedor:** responsável pelo deploy, pela operação e pelo custo da
  aplicação.

## Resumo

| Épico | Stories | Pontos | Must | Should | Could |
| --- | --- | --- | --- | --- | --- |
| Qualidade e controle da IA | 4 | 12 | 3 | 0 | 1 |
| Leitura assistida por IA (ampliação) | 4 | 13 | 1 | 2 | 1 |
| Compreensão e revisão com IA | 3 | 13 | 1 | 2 | 0 |
| Biblioteca e hábito com IA | 3 | 10 | 0 | 1 | 2 |
| **Total** | **14** | **48** | **5 (36%)** | **5 (36%)** | **4 (28%)** |

Must fica abaixo da faixa de 40 a 50% pelo mesmo motivo da rodada anterior: o
produto está no ar e nenhuma story deste grupo impede a leitura. Entram como
Must a medição de falhas, a avaliação de qualidade, o direito de apagar o que
foi gerado, a resposta em tempo real e a checagem de compreensão por sessão,
que é a função de IA ligada diretamente ao objetivo de treino.

## Épico: Qualidade e controle da IA

### US-141: Registrar falhas e recusas de cada função de IA

**Épico:** Qualidade e controle da IA
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/lib/ai.ts` (`recordFailure`, `recordResponse`), `src/lib/ai-usage-report.ts`, `src/app/api/uso-ia/route.ts`

Como mantenedor, eu quero saber quantas chamadas de cada função falharam, foram
recusadas ou passaram do tempo, para que eu troque modelo, esforço ou tempo
limite com base na taxa de erro, e não só no custo.

**Critérios de aceitação**
1. Dado uma chamada que termina em recusa depois do fallback, quando ela é
   registrada, então `ai_usage` ganha uma linha com `outcome = 'recusa'`, a
   função, o modelo e os tokens consumidos (zero quando a API não os informar).
2. Dado uma chamada que passa do `timeoutMs` ou recebe 429 ou 5xx, quando ela é
   registrada, então o `outcome` é `tempo` ou `falha`, respectivamente.
3. Dado `/api/ia/uso`, quando o mantenedor consulta os últimos 7 dias, então
   cada função mostra total de chamadas, taxa de sucesso em porcentagem e custo.
4. Dado que o banco falha ao gravar o registro, quando a chamada ao modelo já
   respondeu, então o leitor recebe a resposta normalmente e o erro vai só para
   o log, como hoje.

**Notas técnicas:** nova coluna `outcome` em `ai_usage`, com padrão `sucesso`
para as linhas antigas. O ponto de gravação é `src/lib/ai.ts`, nos blocos
`catch` das funções de chamada.

### US-142: Avaliar as respostas de IA com um conjunto fixo de textos

**Épico:** Qualidade e controle da IA
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `tests/eval/run.ts`, `tests/eval/checks.ts`, `tests/eval/casos/`, `npm run eval:ia`

Como mantenedor, eu quero rodar as funções de IA sobre um conjunto fixo de
textos e verificar as respostas automaticamente, para que uma troca de modelo
ou de prompt não piore o questionário, as citações ou a regra de não revelar o
que vem depois.

**Critérios de aceitação**
1. Dado o comando `npm run eval:ia`, quando ele roda com `ANTHROPIC_API_KEY`
   definida, então executa questionário, pergunta, explicação, resumo e
   sinopse sobre pelo menos 6 textos versionados em `tests/eval/`, em português
   e em inglês.
2. Dado um questionário gerado, quando é verificado, então toda `evidence`
   aparece literalmente no texto, cada pergunta tem 4 alternativas distintas e
   a justificativa respeita `MAX_RATIONALE_WORDS`.
3. Dado uma resposta de "Perguntar ao texto" com citação, quando é verificada,
   então todo trecho citado está dentro do recorte enviado.
4. Dado um texto com nomes ou eventos marcados como "só depois da posição" no
   arquivo do caso, quando resumo, sinopse ou descrição de nomes são gerados,
   então nenhum desses termos aparece na resposta.
5. Dado que a chave não está definida, quando o comando roda, então encerra com
   a mensagem "Defina ANTHROPIC_API_KEY para rodar a avaliação." e código 1,
   sem afetar `npm test`.

**Notas técnicas:** fora do `vitest` padrão, para não gastar tokens em cada
execução da suíte. O relatório lista casos aprovados, reprovados e custo total
da rodada. Rodar antes de qualquer mudança em `AI_MODELS` ou nos prompts.

### US-143: Apagar os resultados de IA guardados

**Épico:** Qualidade e controle da IA
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/app/api/ia/resultados/route.ts`, `src/components/ai-card.tsx`

Como leitor, eu quero apagar as explicações, resumos, sinopses e sínteses que a
IA gerou sobre os meus textos, para que esse conteúdo não fique guardado depois
que eu desligar os recursos de IA.

**Critérios de aceitação**
1. Dado Ajustes > Recursos de IA, quando toco "Apagar o que a IA gerou" e
   confirmo, então todas as linhas de `ai_results` da conta são excluídas e
   vejo "Resultados de IA apagados."
2. Dado que desligo os recursos de IA, quando confirmo o desligamento, então a
   tela oferece apagar os resultados guardados na mesma confirmação.
3. Dado que apaguei os resultados, quando abro de novo um resumo já gerado, com
   a IA ligada, então ele é gerado de novo e conta na cota do dia.
4. Dado uma conta sem resultados guardados, quando abro a opção, então o botão
   aparece desativado com o texto "Nada guardado."

**Notas técnicas:** as definições salvas em Palavras e as notas criadas a partir
de respostas (US-129) são do leitor e não entram na exclusão; o texto da
confirmação diz isso.

### US-144: Ver o que foi enviado à IA

**Épico:** Qualidade e controle da IA
**Prioridade:** Could
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/api/ia/historico/route.ts`, `src/lib/ai-history.ts`, `src/components/ai-history.tsx`

Como leitor, eu quero ver a lista das últimas chamadas à IA com a função, o
texto e o volume enviado, para que eu confira que só saiu do app o que eu pedi.

**Critérios de aceitação**
1. Dado Ajustes > Uso de IA, quando abro "Histórico de envios", então vejo as
   últimas 50 chamadas com data, função, título do texto e quantidade de
   palavras enviadas.
2. Dado uma chamada sem texto associado (dicionário, por exemplo), quando ela
   aparece na lista, então o campo de texto mostra "Palavra consultada".
3. Dado um texto já excluído, quando a chamada aparece, então o título é
   substituído por "Texto excluído".
4. Dado uma conta sem chamadas, quando abro o histórico, então vejo "Nenhum
   envio registrado."

**Notas técnicas:** exige `text_id` e `words_sent` em `ai_usage`. O conteúdo
enviado não é guardado: guardar o pedido inteiro duplicaria o texto e
contrariaria o objetivo da story.

## Épico: Leitura assistida por IA (ampliação)

### US-145: Ver a resposta aparecer enquanto é escrita

**Épico:** Leitura assistida por IA (ampliação)
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/lib/ai-stream.ts`, `src/lib/stream-response.ts`, `src/app/api/texts/[id]/pergunta/route.ts`, `src/app/api/texts/[id]/explicacao/route.ts`

Como leitor, eu quero ver a explicação e a resposta ao texto surgirem enquanto
são geradas, para que eu não fique diante de um indicador de carregamento por
vários segundos no meio da leitura.

**Critérios de aceitação**
1. Dado que peço uma explicação ou faço uma pergunta, quando o modelo começa a
   responder, então o primeiro trecho aparece na folha antes da resposta
   completa, e o indicador de carregamento some nesse momento.
2. Dado uma resposta com citações, quando o streaming termina, então as
   citações aparecem como hoje, com o toque levando à posição no texto.
3. Dado que fecho a folha no meio da resposta, quando ela fecha, então a
   requisição é cancelada e o uso registrado corresponde aos tokens já gerados.
4. Dado que a conexão cai no meio da resposta, quando isso acontece, então o
   trecho já recebido continua visível com o aviso "A resposta foi
   interrompida." e o botão "Tentar de novo".

**Notas técnicas:** a explicação usa saída estruturada; o streaming dela exige
mostrar o campo `simple` à medida que chega ou trocar para texto livre com
validação no fim. Medir o tempo até o primeiro trecho no registro da US-141.

### US-146: Pedir uma explicação mais simples ou um exemplo

**Épico:** Leitura assistida por IA (ampliação)
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/api/texts/[id]/explicacao/route.ts` (`followUp`), `src/components/explain-sheet.tsx`

Como leitor, eu quero pedir outra forma de explicação quando a primeira não
resolveu, para que eu entenda a frase sem sair do texto para pesquisar.

**Critérios de aceitação**
1. Dado uma explicação aberta, quando toco "Mais simples", então recebo uma
   nova versão de até 40 palavras, sem termos técnicos que não estejam na
   frase.
2. Dado uma explicação aberta, quando toco "Dar um exemplo", então recebo um
   exemplo de até 50 palavras que não usa nada posterior à frase no texto.
3. Dado que já pedi as duas variações, quando a folha mostra os botões, então
   eles ficam desativados: são no máximo duas continuações por frase.
4. Dado que a cota de explicações acabou, quando toco uma das opções, então
   vejo a mensagem de cota e a explicação original continua na tela.

**Notas técnicas:** cada continuação conta como uma explicação na cota. O pedido
reaproveita o recorte da US-127; nenhum contexto novo sai do app.

### US-147: Retomar a conversa com o texto

**Épico:** Leitura assistida por IA (ampliação)
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/lib/ask-turns.ts`, `src/app/api/texts/[id]/pergunta/route.ts` (GET e DELETE), `src/components/ask-sheet.tsx`

Como leitor de textos longos, eu quero que as perguntas que fiz a um texto
fiquem guardadas, para que eu consulte as respostas dias depois sem perguntar
de novo e gastar cota.

**Critérios de aceitação**
1. Dado que fiz perguntas a um texto, quando reabro "Perguntar ao texto" em
   outra sessão, então vejo as perguntas e respostas anteriores, com a posição
   de leitura em que cada uma foi feita.
2. Dado uma resposta antiga feita na palavra 2.000, quando estou na palavra
   5.000, então ela aparece com a marca "Respondida até a palavra 2.000" e o
   botão "Perguntar de novo com o trecho atual".
3. Dado que toco "Limpar conversa", quando confirmo, então as perguntas do
   texto são apagadas.
4. Dado que o conteúdo do texto foi editado ou continuado, quando abro a
   conversa, então as respostas antigas aparecem com o aviso "O texto mudou
   desde esta resposta."

**Notas técnicas:** guardar no máximo 50 perguntas por texto. Entra na exclusão
da US-143. O limite de 10 perguntas por conversa (`MAX_QUESTIONS`) passa a valer
por sessão da folha, não pelo total guardado.

### US-148: Receber sugestões de perguntas sobre o trecho lido

**Épico:** Leitura assistida por IA (ampliação)
**Prioridade:** Could
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/lib/suggestions-generator.ts`, `src/app/api/texts/[id]/sugestoes/route.ts`

Como leitor, eu quero ver três perguntas sugeridas ao abrir "Perguntar ao
texto", para que eu use a função mesmo quando não sei por onde começar.

**Critérios de aceitação**
1. Dado que abro "Perguntar ao texto" depois de ler pelo menos 300 palavras,
   quando a folha abre, então vejo até 3 perguntas sugeridas sobre o trecho
   lido, cada uma com no máximo 15 palavras.
2. Dado que toco uma sugestão, quando ela é enviada, então conta como pergunta
   na cota, como se eu a tivesse digitado.
3. Dado que li menos de 300 palavras ou a geração falhou, quando a folha abre,
   então ela aparece como hoje, sem sugestões e sem mensagem de erro.
4. Dado que reabro a folha na mesma posição, quando as sugestões aparecem,
   então são as mesmas, sem nova chamada.

**Notas técnicas:** Haiku, guardado em `ai_results` por texto e por faixa de
1.000 palavras de posição. A geração das sugestões não conta na cota de
perguntas, só a pergunta enviada.

## Épico: Compreensão e revisão com IA

### US-149: Checar a compreensão do trecho lido na sessão

**Épico:** Compreensão e revisão com IA
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/lib/session-check.ts`, `src/lib/session-quiz.ts`, `src/app/api/texts/[id]/compreensao/`, `src/app/(app)/treino/training-client.tsx`

Como leitor em treino, eu quero responder duas perguntas sobre o que li na
sessão ao parar de ler, para que a velocidade registrada venha acompanhada de
uma medida de compreensão, mesmo em textos que eu não termino.

**Critérios de aceitação**
1. Dado uma sessão no Word Runner com pelo menos 800 palavras lidas, quando
   pauso e toco "Checar compreensão", então recebo 2 perguntas de múltipla
   escolha sobre o trecho lido nessa sessão.
2. Dado o pedido, quando ele é montado, então contém só as palavras entre o
   início da sessão e a posição atual; o teste da montagem verifica que nenhuma
   palavra posterior é enviada.
3. Dado que respondo, quando a sessão é gravada, então a nota fica associada a
   ela e aparece no treino ao lado do ppm daquela sessão.
4. Dado que a IA está indisponível ou a cota acabou, quando toco "Checar
   compreensão", então recebo as perguntas de lacuna da US-113 sobre o mesmo
   trecho.
5. Dado uma sessão com menos de 800 palavras, quando pauso, então a opção não
   aparece.

**Notas técnicas:** usa o gerador do questionário (US-133) com outro recorte e
`MIN_QUESTIONS` de 2. Conta na cota de questionários. A ligação entre nota e
sessão exige coluna nova em `reading_sessions`.

### US-150: Gerar cartões de revisão a partir dos destaques

**Épico:** Compreensão e revisão com IA
**Prioridade:** Should
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/lib/highlight-cards.ts`, `src/lib/card-generator.ts`, `src/app/api/texts/[id]/destaques/cartoes/route.ts`, `src/app/(app)/textos/[id]/destaques/cards-panel.tsx`

Como leitor, eu quero transformar os destaques de um texto em cartões de
pergunta e resposta revisados ao longo dos dias, para que eu retenha as ideias
que considerei importantes.

**Critérios de aceitação**
1. Dado um texto com pelo menos 3 destaques, quando toco "Criar cartões" em
   Destaques, então recebo até 1 cartão por destaque, até 20, cada um com
   pergunta e resposta tiradas só do trecho destacado e da minha nota.
2. Dado os cartões gerados, quando os reviso, então posso editar ou descartar
   cada um antes de salvar.
3. Dado cartões salvos, quando abro a revisão, então eles seguem os mesmos
   intervalos da revisão de palavras e mostram o destaque de origem depois da
   resposta.
4. Dado um texto com menos de 3 destaques, quando abro Destaques, então o botão
   aparece desativado com "Destaque pelo menos 3 trechos."

**Notas técnicas:** só os destaques e as notas saem do app, como na síntese
(US-140). Uma chamada por texto, na cota de resumos. Depende da tabela de
revisão; avaliar se reaproveita o agendamento de `saved_words`.

### US-151: Revisar palavras escolhendo a definição certa

**Épico:** Compreensão e revisão com IA
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/lib/word-lookup.ts`, `src/lib/word-choices.ts`, `src/app/(app)/palavras/revisar/review-client.tsx`

Como leitor que estuda outro idioma, eu quero revisar uma palavra escolhendo a
definição correta entre quatro, para que a revisão teste a lembrança e não só a
autoavaliação.

**Critérios de aceitação**
1. Dado uma palavra salva depois desta entrega, quando ela é consultada, então a
   mesma chamada do dicionário devolve 3 definições incorretas e plausíveis,
   guardadas com a palavra.
2. Dado uma palavra com alternativas guardadas, quando ela aparece na revisão,
   então vejo a frase original com a palavra marcada e 4 definições em ordem
   aleatória.
3. Dado que erro, quando respondo, então a definição correta é destacada e a
   palavra volta para o intervalo inicial.
4. Dado uma palavra sem alternativas guardadas, quando ela aparece na revisão,
   então a revisão funciona como hoje.

**Notas técnicas:** as alternativas são geradas uma vez, na consulta, com cerca
de 40 tokens a mais de saída no Haiku; não há chamada por revisão, o que
respeita o item do Won't Have sobre frases de exemplo. O lote da US-139 usa o
mesmo esquema.

## Épico: Biblioteca e hábito com IA

### US-152: Preencher título e autor ausentes na importação

**Épico:** Biblioteca e hábito com IA
**Prioridade:** Should
**Story points:** 2
**Status:** Implementada
**Evidência:** `src/lib/import-ai.ts` (`analyzePreview`), `src/lib/import-analysis.ts`, `src/components/suggested-field.tsx`

Como leitor, eu quero que a prévia da importação sugira título e autor quando o
arquivo ou a página não trazem esses dados, para que a biblioteca não fique
cheia de "Sem título" e nomes de arquivo.

**Critérios de aceitação**
1. Dado um PDF ou DOCX sem título nos metadados, quando a prévia abre, então o
   campo de título vem preenchido com uma sugestão de até 12 palavras, marcada
   como "Sugerido".
2. Dado um texto em que o autor aparece nas primeiras linhas, quando a prévia
   abre, então o campo de autor vem preenchido; sem autor identificável, fica
   vazio.
3. Dado que edito a sugestão, quando salvo, então vale o que digitei.
4. Dado que a análise passa de 15 segundos ou falha, quando a prévia abre,
   então os campos aparecem como hoje.

**Notas técnicas:** entra na chamada da limpeza (US-136), no Haiku, sem chamada
nova. Só os primeiros 2.000 caracteres são enviados para esta parte.

### US-153: Dividir um documento longo em seções com título

**Épico:** Biblioteca e hábito com IA
**Prioridade:** Could
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/lib/sections.ts`, `src/lib/sections-ai.ts`, `src/app/api/texts/[id]/secoes/route.ts`, `src/components/sections-review.tsx`

Como leitor de textos longos, eu quero que um documento sem estrutura ganhe
seções com título, para que eu navegue por ele em "Navegar no texto" como faço
num EPUB.

**Critérios de aceitação**
1. Dado um texto de pelo menos 5.000 palavras sem títulos, quando toco
   "Sugerir seções", então recebo de 3 a 30 pontos de divisão, cada um no
   início de um parágrafo e com título de até 8 palavras.
2. Dado as seções sugeridas, quando as reviso, então posso renomear, remover ou
   aceitar cada uma antes de aplicar.
3. Dado que aplico, quando abro "Navegar no texto", então as seções aparecem no
   sumário, e o conteúdo do texto não muda.
4. Dado um texto que já tem títulos, quando abro a opção, então ela não aparece.

**Notas técnicas:** os títulos ficam como marcação de navegação, separados do
conteúdo, para não mudar a contagem de palavras nem as posições de destaques.
Enviar o texto com os parágrafos numerados, como na US-136; acima de 200 mil
caracteres, processar em partes. Cota de resumos.

### US-154: Receber o resumo semanal com as ideias lidas

**Épico:** Biblioteca e hábito com IA
**Prioridade:** Could
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/lib/week-ideas.ts`, `src/lib/week-ideas-ai.ts`, `src/app/api/resumo-semanal/ideias/`, `weekly-summary-card.tsx`

Como leitor, eu quero que o resumo semanal traga um parágrafo com as ideias
principais do que li na semana, para que eu relembre o conteúdo além dos
números de tempo e palavras.

**Critérios de aceitação**
1. Dado uma semana com pelo menos 2 textos lidos, quando toco "Ver as ideias da
   semana" no cartão do resumo semanal, então recebo um parágrafo de até 120
   palavras que cita cada texto pelo título.
2. Dado o pedido, quando ele é montado, então leva só as sinopses (US-138) e os
   destaques da semana, nunca o conteúdo dos textos.
3. Dado que reabro o cartão na mesma semana, quando o parágrafo aparece, então
   vem do que foi guardado, sem nova chamada.
4. Dado que a IA está desligada, sem chave ou sem cota, ou que a semana tem
   menos de 2 textos lidos, quando abro o cartão, então ele aparece como hoje,
   só com os números e sem o botão.

**Notas técnicas:** o cartão do resumo semanal (US-49) é montado quando o
painel abre; por isso a geração é sob demanda, pelo botão, e não automática a
cada visita. Guardar em `ai_results` com a segunda-feira da semana na chave.
Cota de resumos.

## Fora do escopo (Won't Have)

- **Pré-gerar questionário, sinopse e seções de todo texto na importação:** gera
  custo para textos que talvez nunca sejam lidos. As stories acima são todas
  sob demanda ou ligadas a uma leitura que aconteceu.
- **Avaliar a leitura em voz alta pelo microfone:** a API do Claude não recebe
  áudio, e a story exigiria um segundo provedor.
- **Corrigir resumos escritos pelo leitor:** mesma objeção das perguntas abertas
  no Won't Have principal: a nota varia entre correções e entraria no treino
  como medida.
- **Continuar ou reescrever o texto com IA (versão simplificada, final
  alternativo):** o app ajuda a ler o que está na biblioteca; gerar texto novo
  muda o objetivo e o custo por texto.
- **Recomendar leituras de fora da biblioteca:** exige busca na web ou catálogo
  externo, fora da integração existente.
- **Modelo rodando no navegador:** dependência nova e download de centenas de
  megabytes, para funções que já têm cota e custo controlados.

## Notas da implementação

As 14 stories foram implementadas sobre o commit `210362d`. Onde a entrega se
afastou do texto da story:

- **US-141:** a visão por função fica em `/api/uso-ia` (US-124), que já é a
  rota do mantenedor e mantém a autenticação por `AI_USAGE_SECRET`; a
  `/api/ia/uso` continua sendo a das cotas do leitor.
- **US-142:** o comando roda com `tsx --conditions=react-server` e usa uma conta
  local própria (`avaliacao-ia@rk-leitura.local`). Ainda não foi executado
  contra o modelo, por falta de chave no ambiente de desenvolvimento.
- **US-145:** o protocolo é NDJSON (`start`, `delta`, `done`, `error`). Uma
  resposta interrompida porque o leitor fechou a folha é registrada como
  `falha`, com os tokens de saída estimados até o corte.
- **US-148:** a geração das sugestões não usa a cota de perguntas; o limite é o
  cache por faixa de 1.000 palavras, 60 pedidos por hora por IP e 100 gerações
  por conta por dia.
- **US-149:** a sessão é gravada no momento em que o leitor toca "Checar
  compreensão", e a nota é escrita nessa sessão. Retomar a leitura abre outra.
- **US-152:** o autor também é lido dos metadados da página (JSON-LD e
  `meta author`), sem chamada ao modelo. Aparece nos cartões da biblioteca, não
  no cabeçalho do leitor.
- **US-153:** as seções são apagadas quando o conteúdo é reescrito, e posições
  que deixaram de começar um parágrafo são descartadas ao montar o sumário.
- **US-154:** textos da semana sem sinopse guardada vão só com o título e os
  destaques; a sinopse não é gerada para isso.

Nenhuma das funções foi exercitada contra o modelo real neste ambiente: os
testes de ponta a ponta simulam as rotas de IA. A US-142 existe para fazer essa
verificação antes de colocar em produção.

## Sugestão de MVP

**Sprint 1 (19 pontos, Must)**
- US-141 Registrar falhas e recusas (2)
- US-143 Apagar os resultados de IA guardados (2)
- US-142 Conjunto de avaliação (5)
- US-145 Resposta em tempo real (5)
- US-149 Checar a compreensão da sessão (5)

US-141 vem primeiro porque mede o efeito das demais; US-142 deve existir antes
de qualquer mudança de prompt pedida pelas stories seguintes.

**Sprint 2 (16 pontos, Should)**
- US-146 Explicação mais simples ou exemplo (3)
- US-147 Retomar a conversa com o texto (3)
- US-151 Revisar palavras com alternativas (3)
- US-152 Título e autor na importação (2)
- US-150 Cartões de revisão a partir dos destaques (5)

**Depois, conforme o uso medido (13 pontos, Could)**
- US-144 Histórico de envios (3)
- US-148 Sugestões de perguntas (2)
- US-153 Seções em documentos longos (5)
- US-154 Ideias lidas no resumo semanal (3)
