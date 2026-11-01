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
| **Total** | **8** | **22** | **3 (38%)** | **3 (38%)** | **2 (25%)** |

Must ficou com os três pedidos centrais da sessão: virar página deslizando,
ajustar a velocidade deslizando e esconder os controles. A US-210 é Should,
mas vem primeiro, porque reduz o custo das outras.

## Épico: Controles e gestos

### US-210: Separar a barra de controles e os gestos do leitor

**Épico:** Controles e gestos
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta
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
**Status:** Proposta
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
**Status:** Proposta
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
**Status:** Proposta
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
**Status:** Proposta
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
**Status:** Proposta
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
**Status:** Proposta
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
**Status:** Proposta
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

## Sugestão de entrega

Total: 8 stories, 22 pontos, 1 sprint.

**Sprint 1 (22 pontos)**
- US-210 Separar barra e gestos do leitor (3)
- US-211 Virar a página deslizando (3)
- US-212 Ajustar a velocidade deslizando (3)
- US-213 Esconder os controles durante a leitura (3)
- US-215 Ações ao alcance do polegar (2)
- US-217 Ler com o celular deitado (4)
- US-214 Alternar Word Runner e Guia (2)
- US-216 Vibrar ao mudar de seção (2)

## Próximo passo de validação

Antes da US-211 e da US-212, usar o app por uma semana anotando cada vez que
foi preciso olhar para a barra para achar um botão. Se forem poucas vezes, a
US-213 e a US-215 sobem na ordem e os gestos podem esperar.
