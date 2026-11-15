# Backlog: rk-leitura, leitura no celular

## Visão geral

Proposta de stories para melhorar a experiência de leitura no celular, nos dois
modos do leitor (página e Word Runner). Saiu de uma sessão de brainstorming
com o leitor, que usa o app sozinho, num aparelho Android. A análise partiu do
`main` no commit `5c55e45`. A numeração continua a de
`docs/backlog-sustentacao.md`, a partir da US-210.

## Premissas

- As stories nasceram como **Proposta**; o campo Status de cada uma registra
  o andamento. O campo Evidência cita o trecho do código que motivou a story;
  a análise foi feita por leitura estática, sem executar o app.
- Aparelho de referência: Android, Chrome ou PWA instalado. A API de vibração
  (US-216) não existe no Safari do iOS; lá a story não se aplica.
- Decisões tomadas na sessão: no Word Runner, deslizar na horizontal ajusta a
  velocidade; os controles somem durante a leitura; a troca de modo é por
  botão fixo, não por gesto.
- O toque longo continua sendo do dicionário (`use-word-touch.ts`) e arrastar
  continua selecionando texto para destacar. Nenhum gesto novo pode disputar
  com eles.
- O sistema Android usa o deslize a partir da borda lateral como "voltar".
  Gestos que começam a menos de 24 px das bordas laterais são ignorados.
- Os valores citados (limiares, tempos, passos) são pontos de partida. O passo
  de velocidade segue o dos atalhos de teclado (25 ppm).
- Fora do escopo: pausar e retomar por interrupções do aparelho (notificação,
  ligação), descartado na sessão.
- Velocidade de referência: 20 a 25 pontos por sprint de 2 semanas.

## Papéis

- **Leitor:** usuário autenticado que lê os textos no celular.
- **Mantenedor:** responsável pelo código e pela operação da aplicação.

## Resumo

| Épico | Stories | Pontos | Must | Should | Could |
| --- | --- | --- | --- | --- | --- |
| Controles e gestos | 5 | 14 | 3 | 1 | 1 |
| Layout e retorno | 3 | 8 | 0 | 2 | 1 |
| Avisos na leitura | 4 | 9 | 2 | 1 | 1 |
| Rolagem contínua | 1 | 5 | 1 | 0 | 0 |
| Revisão e destaques | 2 | 10 | 1 | 1 | 0 |
| Leitor de livro | 3 | 10 | 1 | 1 | 1 |
| Navegação e biblioteca | 3 | 9 | 2 | 1 | 0 |
| **Total** | **21** | **65** | **10 (48%)** | **7 (33%)** | **4 (19%)** |

Must ficou com os três pedidos centrais da sessão: virar página deslizando,
ajustar a velocidade deslizando e esconder os controles. A US-210 é Should,
mas vem primeiro, porque reduz o custo das outras.

## Épico: Controles e gestos

### US-210: Separar a barra de controles e os gestos do leitor

**Épico:** Controles e gestos
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** `src/app/(app)/leitor/[id]/reader-client.tsx` tem 3.546 linhas; o rodapé de controles (`reader-client.tsx:1926-2184`) e os atalhos de teclado (`reader-client.tsx:1580-1610`) estão no mesmo componente do motor de leitura

Como mantenedor, eu quero a barra de controles e o tratamento de gestos em
módulos próprios, para que as stories deste backlog mudem o leitor sem
reabrir o motor do Word Runner e da paginação.

**Critérios de aceitação**
1. Dado o leitor atual, quando a barra de controles é extraída para um
   componente próprio, então o comportamento visível não muda e os testes e2e
   do leitor continuam passando.
2. Dado um hook novo de gestos, quando ele recebe os eventos de ponteiro da
   área de leitura, então devolve gestos já classificados (toque, deslize para
   a esquerda, deslize para a direita) e não interfere no `useWordTouch`.
3. Dado o hook de gestos, quando é testado em unidade, então os limiares de
   distância, tempo e borda lateral estão cobertos.

**Notas técnicas:** extração sem mudança de comportamento; entregar antes das
US-211, US-212 e US-213.

### US-211: Virar a página deslizando

**Épico:** Controles e gestos
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `reader-client.tsx:2127` e `reader-client.tsx:2147` (virar página só pelos botões do rodapé); não há tratamento de deslize no leitor

Como leitor, eu quero virar a página deslizando o dedo, para ler sem procurar
os botões da barra.

**Critérios de aceitação**
1. Dado o modo página parado, quando deslizo para a esquerda pelo menos 60 px
   na horizontal, com deslocamento vertical menor que o horizontal, então vai
   para a próxima página, pelo mesmo caminho de `turnPage(1)` (conta a página
   como lida).
2. Dado o modo página parado, quando deslizo para a direita, então volta uma
   página.
3. Dado que estou selecionando texto ou que o toque longo abriu o dicionário,
   quando movo o dedo, então a página não vira.
4. Dado um deslize que começa a menos de 24 px da borda lateral, quando ele
   termina, então o app ignora e deixa o gesto de voltar do Android agir.
5. Dado a primeira ou a última página, quando deslizo para fora do texto, então
   nada acontece além de um retorno visual curto da página.
6. Dado os botões de página anterior e próxima, quando os gestos existem,
   então os botões continuam funcionando, inclusive por teclado e leitor de
   tela.

### US-212: Ajustar a velocidade deslizando no Word Runner

**Épico:** Controles e gestos
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `reader-client.tsx:809` (no Word Runner o toque é o freio), `reader-client.tsx:1590-1593` (setas mudam a velocidade em 25 ppm só pelo teclado), `reader-client.tsx:2160` (no celular a velocidade só muda abrindo o controle)

Como leitor, eu quero acelerar ou desacelerar o Word Runner deslizando o dedo,
sem parar a leitura, para ajustar o ritmo ao trecho que estou lendo.

**Critérios de aceitação**
1. Dado o Word Runner em andamento, quando deslizo para a direita, então a
   velocidade sobe 25 ppm a cada 40 px percorridos, pelo mesmo caminho de
   `changeWpm`, respeitando `MIN_WPM` e `MAX_WPM`.
2. Dado o Word Runner em andamento, quando deslizo para a esquerda, então a
   velocidade desce na mesma proporção.
3. Dado um deslize de velocidade, quando ele acontece, então a leitura não
   para e aparece por 1 segundo um indicador com a velocidade nova.
4. Dado um toque sem deslize, quando acontece no Word Runner, então continua
   sendo o freio, como hoje.
5. Dado o ritmo dinâmico ligado, quando ajusto a velocidade por deslize, então
   o ajuste vale como a velocidade base, igual ao controle deslizante.
6. Dado um deslize que começa perto da borda lateral, quando termina, então é
   ignorado (gesto de voltar do Android).

### US-213: Esconder os controles durante a leitura

**Épico:** Controles e gestos
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** `reader-client.tsx:1710` (cabeçalho) e `reader-client.tsx:1926` (rodapé) ficam sempre visíveis enquanto o leitor está aberto

Como leitor, eu quero que o cabeçalho e o rodapé saiam da tela enquanto leio,
para ter mais espaço para o texto e menos distração.

**Critérios de aceitação**
1. Dado o Word Runner em andamento, quando ele começa, então cabeçalho e rodapé
   saem da tela; ao pausar, voltam.
2. Dado o modo página parado, quando passo 4 segundos sem tocar nos controles,
   então cabeçalho e rodapé saem da tela.
3. Dado os controles escondidos no modo página, quando toco numa área sem
   palavra (margem ou espaço entre parágrafos), então eles voltam. Toque em
   palavra continua com o comportamento atual.
4. Dado uma folha aberta (dicionário, destaque, ajustes, perguntar), um aviso
   na tela ou o foco do teclado dentro dos controles, quando isso acontece,
   então os controles não somem.
5. Dado que os controles somem e voltam, quando isso acontece, então a
   paginação não é refeita e a posição não muda (os controles saem por cima
   do texto, sem mudar a altura da área de leitura).
6. Dado um leitor de tela ativo ou a preferência por movimento reduzido, quando
   leio, então os controles continuam acessíveis (aparecem ao receber foco) e
   a transição é instantânea.
7. Dado os ajustes de leitura, quando desligo "Esconder controles", então tudo
   volta ao comportamento atual.

**Notas técnicas:** o rodapé já mantém os avisos fora do fluxo
(`reader-client.tsx:1929-1931`); o mesmo princípio vale para escondê-lo sem
repaginar.

### US-214: Alternar Word Runner e Guia na página com um botão fixo

**Épico:** Controles e gestos
**Prioridade:** Could
**Story points:** 2
**Status:** Implementada
**Evidência:** `reader-client.tsx:2384-2392` (a escolha entre Word Runner e Guia na página fica dentro dos ajustes); `reader-client.tsx:373` (`setPlayMode` grava em `localStorage`)

Como leitor, eu quero trocar entre Word Runner e Guia na página com um botão
na barra, para mudar de modo sem abrir os ajustes.

**Critérios de aceitação**
1. Dado o rodapé, quando o leitor está aberto, então há um botão fixo que
   mostra o modo do play atual e alterna entre os dois.
2. Dado que troco de modo com a leitura parada, quando toco play, então começa
   no modo novo, na mesma palavra.
3. Dado que troco de modo com a leitura em andamento, quando o botão é tocado,
   então a leitura continua no modo novo a partir da palavra atual.
4. Dado a troca, quando acontece, então a escolha é gravada como hoje
   (`PLAY_MODE_KEY`) e o ajuste nos ajustes reflete o valor novo.

**Notas técnicas:** a passagem entre página parada e Word Runner já é o botão
de play, e a palavra atual já é marcada na página ao pausar
(`reader-client.tsx:1665-1670`). Esta story cobre só a troca entre os dois
modos do play.

## Épico: Layout e retorno

### US-215: Ações do cabeçalho ao alcance do polegar

**Épico:** Layout e retorno
**Prioridade:** Should
**Story points:** 2
**Status:** Implementada
**Evidência:** `reader-client.tsx:1710-1790` (Destaques, Perguntar ao texto, Estudar, Navegar e Ajustes ficam no cabeçalho, no topo da tela)

Como leitor que segura o celular com uma mão, eu quero as ações do leitor
perto do polegar, para não precisar mudar a pegada do aparelho.

**Critérios de aceitação**
1. Dado o rodapé, quando o leitor está aberto, então há um botão "Mais" que
   abre uma folha com Destaques, Perguntar ao texto, Estudar, Navegar e
   Ajustes.
2. Dado o cabeçalho, quando o leitor está aberto no celular, então ele mantém
   só o botão Voltar e o progresso.
3. Dado uma tela larga (a partir de `sm`), quando o leitor está aberto, então o
   cabeçalho pode manter as ações atuais.
4. Dado todos os controles do rodapé, quando medidos, então têm área de toque
   de pelo menos 48 x 48 px.

### US-216: Sentir o fim de uma seção no Word Runner

**Épico:** Layout e retorno
**Prioridade:** Could
**Story points:** 2
**Status:** Implementada
**Evidência:** `reader-client.tsx:276` (o Word Runner já conhece o tipo de bloco de cada palavra, inclusive títulos)

Como leitor, eu quero uma vibração curta quando o Word Runner entra numa seção
ou capítulo novo, para perceber a estrutura do texto sem olhar o progresso.

**Critérios de aceitação**
1. Dado o Word Runner em andamento, quando a próxima palavra é a primeira de um
   título, então o aparelho vibra uma vez por 30 ms.
2. Dado o fim de um capítulo de uma série, quando o Word Runner chega a ele,
   então vibra duas vezes curtas.
3. Dado um navegador sem `navigator.vibrate`, quando o leitor abre, então a
   opção não aparece nos ajustes.
4. Dado os ajustes, quando o leitor abre pela primeira vez, então a vibração
   está desligada e pode ser ligada em "Vibrar ao mudar de seção".
5. Dado a narração em andamento, quando chega a um título, então não vibra.

### US-217: Ler com o celular deitado

**Épico:** Layout e retorno
**Prioridade:** Should
**Story points:** 4
**Status:** Implementada
**Evidência:** `src/app/manifest.ts:11` (`orientation: "portrait"` trava o app instalado na vertical)

Como leitor, eu quero ler com o celular na horizontal, para aproveitar a tela
inteira em textos com linhas longas, tabelas ou código.

**Critérios de aceitação**
1. Dado o app instalado, quando giro o aparelho, então a tela acompanha
   (`orientation: "any"` no manifesto).
2. Dado o modo página, quando giro o aparelho, então a página é refeita e a
   palavra atual continua na tela.
3. Dado o modo página na horizontal, quando a largura passa do limite de leitura
   confortável, então a coluna de texto fica limitada a cerca de 70 caracteres
   por linha, centralizada.
4. Dado o Word Runner na horizontal, quando está em andamento, então a palavra
   fica centralizada e o tamanho acompanha a altura disponível, sem corte.
5. Dado a horizontal, quando os controles estão visíveis, então não cobrem mais
   de 25% da altura da tela.
6. Dado o Word Runner em andamento, quando giro o aparelho, então a leitura não
   para e não pula palavras.

**Notas técnicas:** depois da US-213 os controles somem durante a leitura, o
que resolve boa parte da falta de altura na horizontal.

## Épico: Avisos na leitura

Saiu de uma segunda sessão com o leitor, depois das US-210 a US-217: ele
apontou os avisos que aparecem acima da barra como o que mais atrapalha e
pediu para diminuir, não para acabar com eles. Ficam fora deste épico as
pausas automáticas (descanso dos olhos, marcos de 25%, 50% e 75%, ponto de
parada), que não foram apontadas (os marcos, além disso, já vêm desligados nos
ajustes), e os avisos de estado que pedem uma ação (texto largado, outro
aparelho, falha de gravação, erro de narração, "voltar para onde parou"). As
referências de linha deste épico valem para o código depois da US-219.

### US-218: Não repetir um aviso que já dispensei

**Épico:** Avisos na leitura
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** antes desta story, a sugestão de reduzir a velocidade era buscada a cada abertura do leitor e dispensar só zerava o estado da tela (`reader-client.tsx:342`); a checagem de compreensão era oferecida de novo a cada pausa depois de 800 palavras no Word Runner (`reader-client.tsx:932`)

Como leitor, eu quero que um aviso dispensado não volte logo em seguida, para
não ter de fechar a mesma sugestão toda vez que pauso ou abro um texto.

**Critérios de aceitação**
1. Dado que dispensei a sugestão de reduzir a velocidade, quando abro qualquer
   texto nos 7 dias seguintes, então ela não aparece.
2. Dado que aceitei a sugestão de reduzir a velocidade, quando abro outro
   texto, então ela não aparece até haver sessões novas que a justifiquem.
3. Dado que a checagem de compreensão foi oferecida numa sessão, quando pauso
   de novo no mesmo texto no mesmo dia, então ela não é oferecida outra vez.
4. Dado que dispensei um aviso num aparelho, quando abro o leitor em outro,
   então a dispensa vale lá também.

**Notas da implementação:** a resposta à sugestão de velocidade fica em
`users.slowdown_answered_at` (`POST /api/reading-sessions/sugestao`) e a oferta
da checagem em `texts.session_check_offered_at` (`POST
/api/texts/[id]/checagem`), migration `0033_avisos_dispensados`. A regra da
velocidade ficou uma só para aceitar e dispensar (`slowdownSamples`, em
`src/lib/difficulty.ts`): 7 dias sem sugestão e, depois, só contam as sessões
gravadas depois da resposta. É mais restrita que o critério 2, que não pedia os
7 dias para quem aceitou. A checagem ganhou botão de fechar, conta como
oferecida quando aparece na tela, não quando a pausa a calcula, e "hoje" é o
dia do aparelho (`offeredToday`, em `src/lib/session-check.ts`). Sem conexão a
marca não é gravada: vale até fechar o leitor e pode repetir na abertura
seguinte.

### US-219: Mostrar um aviso por vez acima da barra

**Épico:** Avisos na leitura
**Prioridade:** Must
**Story points:** 2
**Status:** Implementada
**Evidência:** antes desta story cada aviso tinha a sua condição (`reader-client.tsx:2192-2290`), e checagem de compreensão, sugestão de velocidade e "voltar para onde parou" podiam aparecer empilhados ao pausar

Como leitor, eu quero ver no máximo um aviso de sugestão por vez, para que a
pausa não cubra a página com cartões.

**Critérios de aceitação**
1. Dado mais de uma sugestão pendente ao pausar, quando a página volta, então
   aparece só a de maior prioridade: recapitular, depois checar compreensão,
   depois reduzir a velocidade.
2. Dado que respondi ou dispensei a sugestão visível, quando continuo parado,
   então a próxima não aparece nessa pausa.
3. Dado um aviso de estado (texto largado, falha de gravação, erro de
   narração, outro aparelho), quando ele existe, então aparece sempre, e a
   sugestão espera.
4. Dado a barra de seleção ou o controle de velocidade aberto, quando há uma
   sugestão pendente, então ela não aparece junto.

**Notas da implementação:** a escolha é `visibleSuggestion`, em
`src/lib/reader-notices.ts`; o leitor informa o que está pendente e desenha só
a sugestão escolhida. "Voltar para onde parou" conta como aviso de estado:
enquanto ele aparece, a sugestão espera. Abrir a checagem, pular uma
recapitulação e responder a sugestão de velocidade encerram as sugestões da
pausa; a próxima vez é no play seguinte. Os controles (US-213) só ficam presos
na tela pela sugestão que aparece de fato, não pelas que estão esperando.
Coberto por `tests/reader-notices.test.ts` e `e2e/avisos.spec.ts`.

### US-220: Desligar as sugestões durante a leitura

**Épico:** Avisos na leitura
**Prioridade:** Should
**Story points:** 2
**Status:** Proposta
**Evidência:** `src/app/(app)/ajustes/page.tsx:234` e `:265` (os marcos de "isso ainda vale?" e o descanso dos olhos têm ajuste; os marcos já vêm desligados); recapitular, checar compreensão e reduzir a velocidade não podem ser desligados

Como leitor, eu quero um ajuste para desligar as sugestões do leitor, para ler
sem nenhum cartão quando eu não quiser ser interrompido.

**Critérios de aceitação**
1. Dado os ajustes de leitura, quando abro, então há "Sugestões durante a
   leitura", ligado por padrão.
2. Dado o ajuste desligado, quando leio, então não aparecem recapitular,
   checar compreensão nem reduzir a velocidade, e o leitor não consulta a
   sugestão de velocidade ao abrir.
3. Dado o ajuste desligado, quando quero recapitular ou checar a compreensão,
   então consigo pela folha de navegação do texto.
4. Dado o ajuste desligado, quando há um aviso de estado, então ele continua
   aparecendo.

### US-221: Avisos em uma linha

**Épico:** Avisos na leitura
**Prioridade:** Could
**Story points:** 2
**Status:** Proposta
**Evidência:** `reader-client.tsx:2192` (o aviso de recapitular ocupa um cartão com título, texto, dois botões e o resumo de IA embaixo)

Como leitor, eu quero que cada sugestão ocupe uma linha, com a ação e um botão
de fechar, para que ela não cubra o fim da página.

**Critérios de aceitação**
1. Dado uma sugestão visível, quando aparece, então tem uma frase curta, um
   botão de ação e um de fechar, na altura de um controle (44 px de toque).
2. Dado o aviso de recapitular, quando toco na ação, então o resumo do que li
   e os destaques abrem numa folha, não no cartão.
3. Dado a largura de 320 px, quando a sugestão aparece, então não há rolagem
   horizontal nem texto cortado sem reticências.

## Épico: Rolagem contínua

### US-222: Ler em rolagem contínua, arrastando o texto

**Épico:** Rolagem contínua
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** pedido direto do leitor; antes desta story o texto parado só aparecia em páginas (`PageStage`, em `src/app/(app)/leitor/[id]/reader-client.tsx`), e o modo Rolagem antigo (US-16) tinha sido substituído pela US-106

Como leitor, eu quero ler o texto inteiro numa coluna só, arrastando para
baixo, para ler no celular sem virar página.

**Critérios de aceitação**
1. Dado os ajustes de leitura, quando ligo "Rolagem contínua", então o texto
   inteiro aparece numa coluna que rola com o dedo, sem páginas; desligada,
   tudo volta às páginas. A opção é do aparelho e vem desligada.
2. Dado a rolagem ligada, quando arrasto o texto e paro, então a posição de
   leitura passa a ser a primeira palavra à vista, e é ela que fica guardada.
3. Dado que abro um texto com a rolagem ligada, quando a tela carrega, então a
   coluna já está na posição guardada.
4. Dado que rolo para a frente, quando o tempo desde a última parada é
   plausível para as palavras que passaram, então elas contam como leitura,
   pela mesma regra da página virada (US-108).
5. Dado o fim do texto, quando chego ao fundo, então nada conclui sozinho; o
   botão "Concluir leitura" termina a leitura (ou busca a próxima parte na
   origem), como a última página.
6. Dado que pauso o Word Runner, uso o guia na página, a narração, a busca ou
   os botões de página, quando a posição muda, então a coluna rola até a
   palavra se ela não estiver à vista; estando à vista, o texto não se mexe.
7. Dado que toco numa palavra, seguro para o dicionário ou seleciono para
   destacar, quando a rolagem está ligada, então tudo funciona como nas
   páginas, e a borda da tela não vira nada.
8. Dado "Esconder controles" ligado, quando cabeçalho e rodapé saem ou voltam,
   então o texto fica no mesmo lugar da tela.

**Notas da implementação:** a opção fica em `localStorage`
(`rk-leitura:rolagem`), como as outras do aparelho; não há migração. O
`PageStage` desenha todos os parágrafos, cada um memoizado, e o
`useScrollReading` (`src/hooks/use-scroll-reading.ts`) liga a rolagem à
posição nos dois sentidos; as contas puras estão em
`src/lib/scroll-reading.ts`. Na rolagem a paginação não é medida: os botões de
página e as teclas rolam 90% da tela, e "voltar para onde parou" aparece a
mais de 250 palavras do lugar da leitura. A leitura rolada é gravada como
sessão de modo "pagina"; não há modo novo no histórico. A linha de estado
mostra "N%" no lugar de "Página N de M". A posição que vem da rolagem não ganha a marca de palavra atual; a
que vem de pausa, toque, busca ou retomada ganha. Com o guia ou a narração em
andamento, arrastar não muda a posição: é preciso pausar. Coberto por
`tests/scroll-reading.test.ts` e `e2e/rolagem.spec.ts`.

**Correções depois do primeiro uso no celular** (o leitor relatou que a
rolagem não funcionou):
- Rolar para trás com "Esconder controles" ligado fazia o texto tremer sem
  parar. O atalho "voltar para onde parou" era decidido pelas páginas, que
  mudam com a altura do quadro; como o atalho segura os controles na tela e os
  controles mudam a altura, os dois se alternavam a cada 200 ms. A distância
  passou a ser medida em palavras (`scrolledAway`).
- Num texto do tamanho de um livro (60 mil palavras, processador 4 vezes mais
  lento), medir as páginas travava a tela por cerca de 8 s ao abrir e de novo
  por 6 s logo depois. A rolagem não usa páginas, então a medição foi
  desligada nesse modo (`usePagedText`, parâmetro `enabled`): a abertura caiu
  para cerca de 1,4 s de tarefas longas. O modo páginas continua com esse
  custo; não foi tratado aqui.
- A posição que vem da própria rolagem não move mais a coluna, mesmo quando a
  conta da primeira palavra à vista erra por uma linha.
- A linha de estado era cortada na barra ("Rolage..."); ficou só o número.
- O leitor confirmou o sintoma: o texto não rolava com o dedo, ou travava.
  Além dos itens acima, um arraste em andamento era puxado para trás quando
  os controles saíam da tela aos 4 s: a coluna mudava de tamanho e a posição
  era reescrita com o dedo ainda rolando. Com o dedo na coluna, ou com ela
  ainda em movimento, a posição não é mais escrita pelo leitor
  (`useScrollReading`, `userScrolling`).

## Épico: Revisão e destaques

Saiu de uma revisão do app inteiro, pedida pelo leitor em novembro de 2026.
Ele escolheu dois grupos da revisão para implementar: funções novas (este
épico e o seguinte) e reduções (épico "Navegação e biblioteca").

### US-223: Pular e tirar itens da Revisão do dia

**Épico:** Revisão e destaques
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** `src/app/(app)/revisar/daily-review-client.tsx` só avançava com uma nota; todo destaque e toda palavra consultada entram na revisão sozinhos, então um item indesejado travava os que vinham depois

Como leitor, eu quero pular um item ou tirá-lo da revisão, para que a Revisão
do dia não me obrigue a responder o que não quero revisar.

**Critérios de aceitação**
1. Dado um item na Revisão do dia, quando toco em "Pular", então a tela passa
   ao próximo sem gravar nota; o item continua vencido e volta ao reabrir a
   tela.
2. Dado um item, quando toco em "Tirar da revisão", então uma folha diz o
   efeito em uma frase e pede confirmação, conforme o tipo: palavra ("Já sei
   esta palavra"), destaque ("Não revisar"), cartão de estudo ("Excluir
   cartão", sem volta) e questionário ("Dispensar este questionário").
3. Dado um destaque tirado da revisão, quando abro os destaques do texto,
   então ele aparece como "Fora da revisão", com "Voltar a revisar"; os demais
   oferecem "Não revisar". Fora da revisão ele não entra em nenhuma contagem
   de vencidos.
4. Dado o fim da sessão, quando vejo o resumo, então ele separa respondidos,
   pulados e tirados; se nada foi respondido, o título não diz "concluída".
5. Dado um questionário concluído há 60 dias ou mais, quando a rodada de 30
   dias não foi respondida, então ela deixa de ser oferecida.
6. Dado que a nota de um item já foi enviada, quando ele ainda está na tela,
   então "Pular" e "Tirar da revisão" não aparecem.

**Notas da implementação:** migração `drizzle/0034_revisao_dispensada.sql`:
coluna `highlights.review_off_at` (nula = na revisão) e `quiz_recalls.score`
passa a aceitar nulo (nulo = rodada dispensada). O destaque usa o `PATCH` que
já existia em `/api/texts/[id]/destaques/[markId]`, com o corpo
`{ review: boolean }`; o questionário usa `DELETE /api/texts/[id]/recordar`.
Voltar a revisar um destaque com data vencida ou ausente agenda para o dia
seguinte. A condição central `highlightDue` (`src/lib/learning-queries.ts`)
exclui o destaque fora da revisão, e todas as contas herdam. A rodada de 30
dias vale do dia 30 ao 59 (`RECALL_EXPIRY_DAYS`, `src/lib/quiz-recall.ts`);
dispensar a de 7 não dispensa a de 30. O resumo e os textos da folha vêm de
funções puras (`sessionSummary`, `removalCopy`, em `src/lib/daily-review.ts`).
A tela perdeu a seta de voltar, porque virou aba (US-229). Coberto por
`tests/daily-review.test.ts`, `tests/quiz-recall.test.ts`,
`tests/integration/highlight-due.test.ts` e `e2e/revisao-pular.spec.ts`.
Ficou de fora: a exportação e o backup da conta não levam o estado "fora da
revisão"; as revisões separadas de palavras e de destaques não têm "Pular";
rever os pulados exige reabrir a tela.

### US-224: Destaques e notas de todos os textos em um lugar só

**Épico:** Revisão e destaques
**Prioridade:** Should
**Story points:** 5
**Status:** Implementada
**Evidência:** os destaques só apareciam por texto (`src/app/(app)/textos/[id]/destaques/`); não havia busca nem exportação da conta inteira

Como leitor, eu quero ver e buscar todos os meus destaques e notas numa tela,
para achar um trecho sem lembrar em que texto ele está.

**Critérios de aceitação**
1. Dado que abro "Destaques e notas" em "Você", quando a tela carrega, então
   vejo os destaques de todos os textos, agrupados por texto, com o texto do
   destaque mais recente primeiro, e a contagem "N destaques em M textos".
2. Dado o campo de busca, quando digito, então a lista filtra a cada letra
   pelo trecho, pela nota e pelo título do texto, sem diferenciar acento nem
   maiúscula.
3. Dado o filtro "Com nota", quando o escolho, então só ficam os destaques
   que têm nota.
4. Dado um destaque, quando toco em "Ler a partir daqui", então o leitor abre
   naquele trecho; o título do grupo leva aos destaques do texto.
5. Dado "Exportar tudo (.md)", quando toco, então baixo um arquivo
   `destaques-AAAA-MM-DD.md` com todos os destaques e notas, por texto.
6. Dado que há destaques vencidos, quando abro a tela, então há o atalho
   "Revisar destaques (N)".
7. Dado uma conta sem destaques, quando abro a tela, então ela explica como
   criar um.

**Notas da implementação:** rota `/destaques`
(`src/app/(app)/destaques/`), consulta em
`src/lib/highlight-library-queries.ts` (duas consultas; as palavras de cada
texto são separadas uma vez, com a regra de `loadHighlights`) e regras puras
em `src/lib/highlight-library.ts`. A tela carrega os 2.000 destaques mais
recentes e avisa quando corta; a exportação
(`GET /api/destaques/exportar`) não tem esse corte, tem teto de 20.000. A
tela não edita: nota, remoção e "Não revisar" continuam na tela do texto. A
seta de `/textos/destaques/revisar` passou a voltar para esta tela, e a aba
acesa ali é "Você". Coberto por `tests/highlight-library.test.ts` e
`e2e/destaques-todos.spec.ts`.

## Épico: Leitor de livro

### US-225: Rolagem automática no ritmo

**Épico:** Leitor de livro
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** na rolagem contínua (US-222) o guia na página e a narração só moviam a coluna quando a palavra saía da vista, em saltos de uma tela; num texto de 60 mil palavras, com processador 4 vezes mais lento, a página era redesenhada inteira a cada palavra e a tela ficava travada 6,4 s de cada 12 s com o Word Runner

Como leitor, eu quero que o texto role sozinho no ritmo da leitura, para
acompanhar o guia ou a narração sem a tela saltar.

**Critérios de aceitação**
1. Dado a rolagem contínua ligada, quando o guia na página ou a narração
   correm, então a coluna rola de forma contínua e a linha da leitura fica a
   cerca de um terço do quadro.
2. Dado a rolagem automática, quando ponho o dedo no texto ou a coluna ainda
   corre com o impulso, então a automação cede; solta e parada, ela volta.
3. Dado a rolagem automática, quando a coluna se move por ela, então a posição
   de leitura não é reescrita como se fosse um arraste.
4. Dado "reduzir movimento" no sistema, quando a leitura avança, então a
   coluna anda um passo por linha, sem deslize.
5. Dado que pauso, quando a leitura para, então a coluna fica onde está.
6. Dado o modo páginas ou o Word Runner, quando leio, então nada muda; não há
   opção nova em Ajustes.
7. Dado um texto do tamanho de um livro, quando o Word Runner ou o guia
   correm, então a página não é redesenhada inteira a cada palavra.

**Notas da implementação:** a conta do alvo é pura
(`src/lib/scroll-reading.ts`) e o laço fica em
`src/hooks/use-scroll-reading.ts`. Para o critério 7: `onOpenMark` virou
função estável, os objetos de `useSpeech` e `useWordTouch` foram desmontados
em partes estáveis, a prop `index` da página fica parada enquanto o Word
Runner a cobre e o relógio visível não depende mais do índice. Com o guia,
só o parágrafo que perde e o que ganha a marca redesenham. O React Compiler
não está ligado no build (só as regras de lint), então a memoização é
manual. Coberto por `tests/scroll-reading.test.ts` e `e2e/rolagem.spec.ts`.
As constantes (âncora a 1/3, 400 ms de aproximação, 250 ms de quietude)
saíram de conta e podem pedir ajuste depois do uso no aparelho.

### US-226: Trocar de capítulo sem sair do leitor

**Épico:** Leitor de livro
**Prioridade:** Should
**Story points:** 3
**Status:** Implementada
**Evidência:** para ir a outro capítulo de uma série era preciso voltar à biblioteca, abrir a série e escolher; o leitor só oferecia o capítulo seguinte ao terminar

Como leitor, eu quero a lista de capítulos da série dentro do leitor, para
trocar de capítulo sem passar pela biblioteca.

**Critérios de aceitação**
1. Dado um texto de série com mais de um capítulo, quando abro "Navegar no
   texto", então há a seção "Capítulos", com número, título e estado de cada
   um (lido, N%, não lido, largado).
2. Dado a lista, quando vejo o capítulo aberto, então ele está marcado e não é
   link; os outros levam ao leitor daquele capítulo.
3. Dado uma série com mais de 5 capítulos, quando abro a folha, então vejo o
   aberto com o anterior e o seguinte, e "Mostrar todos os N capítulos" abre a
   lista inteira, já posicionada no aberto.
4. Dado um texto solto, quando abro a folha, então a seção não aparece.

**Notas da implementação:** `loadSeriesChapters`
(`src/lib/series-queries.ts`) não lê o conteúdo e não vai ao banco para texto
solto; é chamada em `src/app/(app)/leitor/[id]/page.tsx`. As regras da janela
e do rótulo de estado são puras (`chapterWindow`, `chapterStateLabel`, em
`src/lib/navigation.ts`). O capítulo seguinte ainda não importado não aparece
na lista. Coberto por `tests/navigation.test.ts`,
`tests/integration/series-chapters.test.ts` e `e2e/navegacao.spec.ts`.

### US-227: Ir para uma porcentagem do texto

**Épico:** Leitor de livro
**Prioridade:** Could
**Story points:** 2
**Status:** Implementada
**Evidência:** num texto longo sem títulos, a única forma de ir para o meio era virar página ou rolar; a folha "Navegar no texto" só tinha busca, sumário e marcadores

Como leitor, eu quero ir direto para uma porcentagem do texto, para voltar a
um ponto de um livro sem virar página por página.

**Critérios de aceitação**
1. Dado a folha "Navegar no texto", quando ela abre, então há o controle "Ir
   para", de 0 a 100, na porcentagem atual.
2. Dado que arrasto o controle, quando o valor muda, então vejo o destino: a
   seção onde ele cai (se o texto tem seções) e quanto falta a partir dali.
3. Dado o botão "Ir para N%", quando toco, então a leitura vai para o começo
   do parágrafo daquele ponto e a folha fecha.

**Notas da implementação:** `positionAtPercent` e `percentAt`
(`src/lib/navigation.ts`); o tempo restante usa o mesmo relógio do cabeçalho
(`remainingLabel`, agora um formatador só). A posição é gravada no ponto de
salvamento seguinte do leitor, como no sumário. Coberto por
`tests/navigation.test.ts` e `e2e/navegacao.spec.ts`.

## Épico: Navegação e biblioteca

### US-228: Início mais curto

**Épico:** Navegação e biblioteca
**Prioridade:** Should
**Story points:** 1
**Status:** Implementada
**Evidência:** o Início media 2,8 telas de celular; o cartão "Revisar destaques" contava itens que a "Revisão do dia" já conta, e "Importar de um link" fazia o mesmo que o botão "+" da barra

Como leitor, eu quero um Início sem blocos repetidos, para chegar ao que vou
ler com menos rolagem.

**Critérios de aceitação**
1. Dado o Início, quando há destaques vencidos, então eles aparecem só na
   conta da "Revisão do dia"; o cartão "Revisar destaques" não existe mais.
2. Dado o Início, quando procuro importar, então uso o botão "+"; o campo
   "Importar de um link" não existe mais, e a biblioteca vazia aponta o "+".

**Notas da implementação:** `src/components/import-card.tsx` foi apagado. O
Início passou de 2,8 para 2,4 telas na conta de demonstração. A ordem dos
outros blocos não mudou. Coberto por `e2e/barra.spec.ts`.

### US-229: "Revisar" na barra de navegação, com contador

**Épico:** Navegação e biblioteca
**Prioridade:** Must
**Story points:** 3
**Status:** Implementada
**Evidência:** a barra de baixo tinha "Ajustes", que também está em "Você" e é pouco usado; a Revisão do dia, de uso diário, ficava a dois toques (`src/components/app-shell.tsx`)

Como leitor, eu quero a Revisão do dia na barra, com o número de itens
vencidos, para saber se há o que revisar sem abrir a tela.

**Critérios de aceitação**
1. Dado o celular, quando vejo a barra, então os destinos são Início, Textos,
   "+", Revisar e Você; Ajustes continua dentro de "Você".
2. Dado itens vencidos, quando vejo a aba "Revisar", então ela tem um selo
   com a contagem ("99+" acima de 99); sem itens, não há selo.
3. Dado que respondo ou tiro um item na Revisão do dia, quando a nota entra,
   então o selo cai na hora.
4. Dado um leitor de tela, quando foca a aba, então ouve a contagem inteira
   ("Revisar, 12 itens vencidos").
5. Dado o desktop, quando vejo a lateral, então há Início, Textos, Revisar,
   Você e Ajustes.
6. Dado falha ou falta de rede na contagem, quando a barra desenha, então fica
   sem selo e sem aviso.

**Notas da implementação:** as regras da navegação (destinos, aba acesa,
texto do selo, nome acessível) são puras, em `src/lib/app-nav.ts`. A
contagem vem de `GET /api/revisar/contagem` (`countDailyReview`), buscada por
`src/hooks/use-review-count.ts` ao montar, a cada troca de rota, quando a
Revisão do dia avisa por evento de janela (`REVIEW_CHANGED_EVENT`) e quando o
app volta para a frente. Em "Você", "Revisão do dia" deu lugar a "Destaques
e notas". `/revisar` e `/destaques` entraram nas rotas protegidas do
`src/middleware.ts`. Coberto por `tests/app-nav.test.ts` e
`e2e/barra.spec.ts`.

### US-230: Biblioteca compacta, na ordem da última leitura

**Épico:** Navegação e biblioteca
**Prioridade:** Must
**Story points:** 5
**Status:** Implementada
**Evidência:** em 412 px cabiam 2 textos por tela e o primeiro cartão começava em y = 438; a ordem era a da importação, então o livro em andamento descia a cada texto novo (`src/app/(app)/textos/texts-client.tsx`, `loadLibrary` em `src/lib/queries.ts`)

Como leitor, eu quero uma lista compacta, com o que li por último no topo,
para achar o texto em andamento sem rolar.

**Critérios de aceitação**
1. Dado a biblioteca, quando a tela abre, então o primeiro item começa até
   y = 300 e cabem pelo menos 4 textos inteiros na primeira tela.
2. Dado um item, quando o vejo, então há título (até 2 linhas), uma linha de
   dados, as etiquetas numa linha, um indicador fino de progresso e um botão
   "Mais ações"; "Do que se trata?", "Estudar" e "N destaques" ficam na folha.
3. Dado a ordem padrão, quando abro a biblioteca, então os textos vêm pela
   última leitura; o nunca lido vale pela data de importação.
4. Dado o controle "Ordem", quando escolho "Data de importação", então a
   lista volta à ordem antiga e a escolha fica guardada no aparelho.
5. Dado que leio um texto e volto pela seta do leitor, quando a biblioteca
   abre, então esse texto está no topo.
6. Dado as etiquetas do cabeçalho, quando uma não tem texto ativo, então ela
   não aparece.

**Notas da implementação:** a ordem usa o mais recente entre a importação e a
última sessão de leitura (`libraryOrderBy`, `src/lib/queries.ts`); numa série
vale o capítulo lido por último. `GET /api/texts` aceita
`ordem=leitura|importacao`; a escolha fica em `localStorage`
(`src/hooks/use-library-order.ts`), sem migração. Para o critério 5, a seta
do leitor grava a posição e a sessão antes de navegar, com teto de 800 ms
(`leaveToLibrary`, em `reader-client.tsx`); antes só gravava ao desmontar,
depois de a lista já ter sido pedida. O voltar do Android não passa por esse
caminho. Medido na conta de demonstração: primeiro item em y = 274, 5 itens
inteiros acima da barra. Coberto por `tests/library.test.ts`,
`tests/integration/library-order.test.ts` e `e2e/biblioteca.spec.ts`.

## Sugestão de entrega

Total: 21 stories, 65 pontos (a US-222 e as US-223 a US-230 entraram depois, a pedido do leitor).

**Sprint 1 (22 pontos)**
- US-210 Separar barra e gestos do leitor (3)
- US-211 Virar a página deslizando (3)
- US-212 Ajustar a velocidade deslizando (3)
- US-213 Esconder os controles durante a leitura (3)
- US-215 Ações ao alcance do polegar (2)
- US-217 Ler com o celular deitado (4)
- US-214 Alternar Word Runner e Guia (2)
- US-216 Vibrar ao mudar de seção (2)

**Sprint 2 (9 pontos), épico Avisos na leitura**
- US-218 Não repetir um aviso dispensado (3), implementada
- US-219 Um aviso por vez (2), implementada
- US-220 Desligar as sugestões (2)
- US-221 Avisos em uma linha (2)

**Entrega de novembro de 2026 (29 pontos), revisão do app inteiro**
- US-223 Pular e tirar itens da Revisão do dia (5), implementada
- US-224 Destaques e notas em um lugar só (5), implementada
- US-225 Rolagem automática no ritmo (5), implementada
- US-226 Trocar de capítulo sem sair do leitor (3), implementada
- US-227 Ir para uma porcentagem do texto (2), implementada
- US-228 Início mais curto (1), implementada
- US-229 "Revisar" na barra, com contador (3), implementada
- US-230 Biblioteca compacta, na ordem da última leitura (5), implementada

## Notas de implementação

- US-210: a barra (`ReaderControlBar`) e a folha "Mais ações" ficam em
  `src/app/(app)/leitor/[id]/reader-controls.tsx`; os gestos, em
  `src/hooks/use-reader-gestures.ts`, com a classificação pura em
  `src/lib/gestures.ts` (testada em `tests/gestures.test.ts`). O deslize antigo
  da página (45 px, sem checar vertical, borda nem seleção) foi substituído.
- US-213 e US-216: as opções "Esconder controles" (ligada por padrão) e
  "Vibrar ao mudar de seção" (desligada) são do aparelho, em `localStorage`,
  como o modo do play; não há migração. Com "Esconder controles" ligada,
  cabeçalho e rodapé ficam por cima do texto, e o quadro da página reserva a
  altura dos dois como margem: nenhuma linha fica embaixo deles. Com os
  controles fora da tela (depois de 4 s ou pelo botão "Tela cheia" do
  rodapé), o texto ocupa a altura toda e a página é refeita para a altura nova.
  Isso substitui o critério 5 da US-213 a pedido do leitor. As páginas de cada
  altura ficam guardadas, então alternar entre as duas não recalcula o texto;
  durante o Word Runner a página não muda de tamanho.
- US-217: na horizontal com até 500 px de altura, a barra vira uma linha só.

## Próximo passo de validação

Antes da US-211 e da US-212, usar o app por uma semana anotando cada vez que
foi preciso olhar para a barra para achar um botão. Se forem poucas vezes, a
US-213 e a US-215 sobem na ordem e os gestos podem esperar.
