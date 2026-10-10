# Backlog: rk-leitura, aprendizado assistido

## Visão geral

Proposta de stories para transformar a leitura no rk-leitura em estudo:
cartões de memorização gerados pela IA com os pontos e conceitos principais de
um texto, uma revisão diária única e ferramentas de estudo sobre o texto
(glossário, fichamento, perguntas-guia). A análise partiu do `main` no commit
`6d528cd`. A numeração continua a de `docs/backlog-ia.md`, da US-155 à US-170.

## Premissas

- O que já existe e não é refeito aqui:
  - revisão espaçada de palavras (US-64, US-116) e de destaques (US-114);
  - cartões gerados a partir dos destaques (US-150), guardados no próprio
    destaque;
  - questionário do texto e checagem por sessão (US-133, US-149);
  - perguntas de lacuna sem IA (US-113);
  - explicação de frase (US-127) e perguntas ao texto (US-128).
- As regras da integração com a IA continuam valendo: consentimento por conta
  (US-125), cota diária por função (US-72), registro de uso e de falhas
  (US-124, US-141), histórico de envios (US-144) e a exclusão do que a IA gerou
  (US-143).
- Regra de não revelar o que vem depois: em texto não concluído, toda geração
  sobre o texto inteiro usa só o trecho até a posição de leitura. A regra fica
  na montagem do pedido e é coberta por teste, como nas US-128 e US-149.
- Exceção decidida na aprovação: os cartões de estudo (US-155 e US-157) são
  gerados a partir do texto completo, para terem o contexto inteiro. A regra
  passa da geração para a exibição: só aparecem, e só entram na revisão,
  cartões cujo trecho de origem já foi lido. Os demais ficam disponíveis apenas
  no teste de conhecimento prévio (US-170), que o leitor abre por escolha.
- Cartões novos (US-155 e seguintes) ficam numa tabela própria, separada dos
  cartões de destaque da US-150. A revisão unificada (US-161) mostra os dois.
- Os intervalos de revisão seguem `src/lib/vocabulary.ts`, os mesmos de
  palavras e destaques.
- Proposta de cota diária nova, `estudo`, de 30 gerações por dia, para cartões,
  glossário, fichamento e perguntas-guia. É ponto de partida, a revisar com os
  dados da US-141.
- Nenhuma story pede provedor ou dependência nova.
- Velocidade de referência: 20 a 25 pontos por sprint de 2 semanas.

## Papéis

- **Leitor:** usuário autenticado que mantém a biblioteca e lê os textos.
- **Leitor que estuda:** leitor que usa os textos como material de estudo e
  quer reter conceitos ao longo das semanas.
- **Leitor de textos longos:** lê livros e documentos extensos, em várias
  sessões.

## Resumo

| Épico | Stories | Pontos | Must | Should | Could |
| --- | --- | --- | --- | --- | --- |
| Cartões de estudo | 7 | 20 | 4 | 3 | 0 |
| Revisão e retenção | 4 | 13 | 2 | 1 | 1 |
| Estudo do texto com IA | 5 | 20 | 1 | 1 | 3 |
| **Total** | **16** | **53** | **7 (44%)** | **5 (31%)** | **4 (25%)** |

Could fica acima da faixa de 10 a 20% porque três das quatro stories Could são
formas alternativas de estudar o mesmo texto (perguntas-guia, explicar com as
próprias palavras, analogias). Vale entregar uma e medir o uso antes das
outras.

## Épico: Cartões de estudo

### US-155: Gerar cartões com os pontos e conceitos principais de um texto

**Épico:** Cartões de estudo
**Prioridade:** Must
**Story points:** 5
**Status:** Proposta

Como leitor que estuda, eu quero que a IA crie cartões de memorização com os
pontos e conceitos principais do texto, para que eu revise o essencial sem
precisar montar os cartões à mão.

**Critérios de aceitação**
1. Dado um texto com pelo menos 300 palavras, quando toco "Criar cartões de
   estudo" em "Estudar", então a IA gera de 5 a 30 cartões a partir do texto
   completo. Cada cartão traz frente, verso, tipo ("conceito" ou "ponto
   principal") e o trecho de origem com a posição.
2. Dado um texto não concluído, quando os cartões gerados aparecem, então só
   são mostrados os cartões cujo trecho de origem termina até a posição de
   leitura, com a contagem "N cartões de trechos ainda não lidos". Um teste da
   regra de exibição verifica que nenhum cartão de trecho não lido aparece fora
   do teste de conhecimento prévio (US-170).
3. Dado os cartões gerados, quando os reviso, então posso editar a frente e o
   verso, descartar cada um ou descartar todos, antes de tocar "Salvar
   cartões".
4. Dado que o trecho de origem de um cartão não aparece literalmente no texto,
   quando a resposta é validada, então esse cartão é descartado antes de chegar
   à tela.
5. Dado que a IA está desligada, sem chave ou sem cota, quando abro "Estudar",
   então o botão aparece desativado com o motivo, e a opção de criar cartão à
   mão (US-159) continua disponível.

**Notas técnicas:** tabela nova `study_cards` (conta, texto, frente, verso,
tipo, posição de origem, agendamento de revisão). Sonnet, uma chamada por
geração, na cota `estudo`. Texto acima de 200 mil caracteres vai em trechos
distribuídos, como no questionário (`quizSample`). Os cartões de trechos não
lidos são salvos junto e passam a aparecer, e a entrar na revisão, conforme a
leitura avança; não há nova geração por causa disso.

### US-156: Revisar os cartões de estudo com repetição espaçada

**Épico:** Cartões de estudo
**Prioridade:** Must
**Story points:** 3
**Status:** Proposta

Como leitor que estuda, eu quero revisar os cartões ao longo dos dias, com
intervalos que crescem conforme acerto, para que os conceitos fiquem na memória
e não só no texto.

**Critérios de aceitação**
1. Dado cartões salvos de trechos já lidos, quando abro a revisão de um texto,
   então vejo a frente;
   depois de tocar "Mostrar resposta", vejo o verso e as notas "Errei",
   "Difícil", "Bom" e "Fácil".
2. Dado que marco "Errei", quando a nota é gravada, então o cartão volta para o
   intervalo de 1 dia; com as outras notas, o intervalo segue
   `src/lib/vocabulary.ts`.
3. Dado um cartão revisado, quando toco "Ver no texto", então o leitor abre na
   posição de origem do cartão.
4. Dado que não há cartão vencido hoje, quando abro a revisão, então vejo
   "Nenhum cartão para hoje." e a data da próxima revisão.

**Notas técnicas:** as notas entram em `review_answers` com o tipo `cartao`,
como já acontece com palavras e destaques.

### US-158: Criar um cartão a partir de um trecho selecionado

**Épico:** Cartões de estudo
**Prioridade:** Must
**Story points:** 3
**Status:** Proposta

Como leitor que estuda, eu quero selecionar um trecho durante a leitura e pedir
um cartão sobre ele, para que eu guarde o que achei importante no momento em
que li.

**Critérios de aceitação**
1. Dado um trecho selecionado no leitor, quando toco "Criar cartão", então a
   IA propõe frente e verso tirados só desse trecho, e eu posso editar antes de
   salvar.
2. Dado o pedido, quando ele é montado, então leva o trecho selecionado e o
   parágrafo anterior, nada depois do trecho.
3. Dado um trecho com mais de 300 palavras, quando toco "Criar cartão", então
   vejo "Selecione um trecho menor, de até 300 palavras." e nada é enviado.
4. Dado que a IA está indisponível, quando toco "Criar cartão", então o
   formulário abre com o trecho no verso e a frente vazia, para eu completar à
   mão.

**Notas técnicas:** Haiku, na cota `estudo`. Usa a mesma seleção que hoje cria
destaques.

### US-170: Testar o conhecimento prévio antes de ler

**Épico:** Cartões de estudo
**Prioridade:** Must
**Story points:** 3
**Status:** Proposta

Como leitor que estuda, eu quero responder aos cartões de trechos que ainda
não li, para que eu saiba o que já conheço do assunto e onde prestar mais
atenção na leitura.

**Critérios de aceitação**
1. Dado cartões de trechos ainda não lidos, quando toco "Testar conhecimento
   prévio" em "Estudar", então vejo esses cartões, um por vez, com o aviso
   "Estes cartões são de partes que você ainda não leu."
2. Dado um cartão do teste, quando toco "Mostrar resposta", então marco "Já
   sabia" ou "Não sabia", e ao fim vejo quantos já sabia, em número e
   porcentagem.
3. Dado um cartão respondido no teste, quando a leitura passa pelo trecho dele,
   então ele entra na revisão normal com vencimento no dia seguinte, e a
   resposta do teste não altera o intervalo.
4. Dado que todos os cartões são de trechos já lidos, quando abro "Estudar",
   então a opção aparece desativada com "Nenhum cartão de trecho não lido."

**Notas técnicas:** o teste fica fora da revisão espaçada e das estatísticas de
retenção (US-162). O resultado do teste aparece em "Estudar" ao lado da
retenção, como "Conhecimento prévio: N%".

### US-157: Escolher o tipo de cartão gerado

**Épico:** Cartões de estudo
**Prioridade:** Should
**Story points:** 2
**Status:** Proposta

Como leitor que estuda, eu quero escolher entre cartões de pergunta e resposta
e cartões de lacuna, para que a revisão combine com o tipo de conteúdo que
estou estudando.

**Critérios de aceitação**
1. Dado a tela de gerar cartões, quando escolho "Lacuna", então cada cartão é
   uma frase do texto com um termo-chave escondido, e o verso é o termo.
2. Dado um cartão de lacuna, quando a resposta é validada, então a frase sem a
   lacuna aparece literalmente no texto; se não aparecer, o cartão é descartado.
3. Dado que não escolho tipo, quando gero, então vêm cartões de pergunta e
   resposta, como na US-155.

### US-159: Criar um cartão à mão

**Épico:** Cartões de estudo
**Prioridade:** Should
**Story points:** 2
**Status:** Proposta

Como leitor, eu quero criar cartões sem a IA, para que eu estude mesmo com os
recursos de IA desligados ou sem cota.

**Critérios de aceitação**
1. Dado "Estudar" de um texto, quando toco "Novo cartão", preencho frente e
   verso e salvo, então o cartão entra na revisão com vencimento no dia
   seguinte.
2. Dado frente ou verso vazio, quando tento salvar, então vejo "Preencha a
   frente e o verso." e nada é gravado.
3. Dado frente ou verso com mais de 500 caracteres, quando tento salvar, então
   vejo "Use até 500 caracteres em cada lado."

### US-160: Exportar os cartões para o Anki

**Épico:** Cartões de estudo
**Prioridade:** Should
**Story points:** 2
**Status:** Proposta

Como leitor que estuda, eu quero exportar os cartões de um texto ou de todos os
textos num arquivo que o Anki importa, para que eu revise onde já mantenho
meus baralhos.

**Critérios de aceitação**
1. Dado cartões salvos, quando toco "Exportar para o Anki", então baixo um
   arquivo `.txt` separado por tabulação, com frente, verso e uma etiqueta com
   o título do texto.
2. Dado frente ou verso com tabulação ou quebra de linha, quando exporto, então
   esses caracteres são substituídos para não quebrar as colunas.
3. Dado nenhum cartão, quando abro a exportação, então o botão fica desativado
   com "Nenhum cartão para exportar."

**Notas técnicas:** o formato `.apkg` exige SQLite empacotado e uma
dependência nova; o texto separado por tabulação é importado direto pelo Anki.

## Épico: Revisão e retenção

### US-161: Fazer a revisão do dia num só lugar

**Épico:** Revisão e retenção
**Prioridade:** Must
**Story points:** 5
**Status:** Proposta

Como leitor que estuda, eu quero revisar palavras, destaques e cartões
vencidos numa única sessão, para que eu não precise passar por três telas para
cumprir a revisão do dia.

**Critérios de aceitação**
1. Dado itens vencidos hoje, quando abro "Revisar", então vejo a contagem por
   tipo e uma sessão que intercala palavras, destaques e cartões.
2. Dado o painel inicial, quando há itens vencidos, então ele mostra
   "Revisão do dia: N itens" com atalho para a sessão.
3. Dado que interrompo a sessão, quando volto no mesmo dia, então ela continua
   do próximo item não revisado.
4. Dado nenhum item vencido, quando abro "Revisar", então vejo "Revisão em dia."
   e quantos itens vencem amanhã.

**Notas técnicas:** as revisões separadas de palavras e destaques continuam
existindo. A sessão é limitada a 50 itens por vez, com os mais atrasados
primeiro.

### US-169: Refazer o questionário de um texto depois de alguns dias

**Épico:** Revisão e retenção
**Prioridade:** Must
**Story points:** 3
**Status:** Proposta

Como leitor que estuda, eu quero responder de novo o questionário de um texto
7 e 30 dias depois de concluir, para que eu saiba o que ainda lembro dele.

**Critérios de aceitação**
1. Dado um texto concluído com questionário respondido há 7 dias, quando abro a
   revisão do dia, então o questionário aparece como item "Recordar: título".
2. Dado que respondo, quando a nota é gravada, então ela aparece ao lado da
   nota original no histórico do texto, sem entrar na média de compreensão do
   treino.
3. Dado o mesmo texto, quando passam 30 dias da conclusão, então o questionário
   volta uma última vez.
4. Dado um texto sem questionário guardado, quando ele completa 7 dias, então
   nada aparece; nenhum questionário novo é gerado para isso.

**Notas técnicas:** usa o questionário já guardado em `comprehension_quizzes`,
sem chamada ao modelo. As alternativas são reembaralhadas.

### US-162: Ver a retenção de cada texto

**Épico:** Revisão e retenção
**Prioridade:** Should
**Story points:** 3
**Status:** Proposta

Como leitor que estuda, eu quero ver quanto acerto dos cartões de cada texto,
para que eu saiba quais textos preciso reler.

**Critérios de aceitação**
1. Dado um texto com pelo menos 10 revisões de cartão, quando abro "Estudar",
   então vejo a porcentagem de acertos nos últimos 30 dias e o número de cartões
   maduros (intervalo de 21 dias ou mais).
2. Dado a lista "Você", quando há textos com retenção abaixo de 60%, então eles
   aparecem em "Para reler", com a porcentagem.
3. Dado um texto com menos de 10 revisões, quando abro "Estudar", então vejo
   "Poucas revisões para medir." em vez da porcentagem.

**Notas técnicas:** acerto é qualquer nota diferente de "Errei".

### US-163: Receber um lembrete quando houver revisão pendente

**Épico:** Revisão e retenção
**Prioridade:** Could
**Story points:** 2
**Status:** Proposta

Como leitor que estuda, eu quero um lembrete no horário que escolhi quando
houver itens para revisar, para que a revisão não acumule.

**Critérios de aceitação**
1. Dado o lembrete de revisão ligado em Ajustes e 5 ou mais itens vencidos,
   quando chega o horário escolhido, então recebo a notificação "N itens para
   revisar hoje."
2. Dado menos de 5 itens vencidos, quando chega o horário, então nenhuma
   notificação é enviada.
3. Dado que já fiz a revisão do dia, quando chega o horário, então nenhuma
   notificação é enviada.

**Notas técnicas:** usa a infraestrutura de push e a rotina de lembretes
existentes (US-43).

## Épico: Estudo do texto com IA

### US-164: Gerar o glossário de conceitos do texto

**Épico:** Estudo do texto com IA
**Prioridade:** Must
**Story points:** 5
**Status:** Proposta

Como leitor que estuda, eu quero uma lista dos termos e conceitos do texto com
a definição no sentido em que o texto os usa, para que eu consulte o
vocabulário técnico sem sair da leitura.

**Critérios de aceitação**
1. Dado um texto com pelo menos 500 palavras lidas, quando toco "Glossário" em
   "Estudar", então vejo até 30 termos em ordem alfabética, cada um com uma
   definição de até 30 palavras e a primeira posição em que aparece.
2. Dado um termo do glossário, quando toco nele, então o leitor abre na
   primeira ocorrência.
3. Dado um termo do glossário, quando toco "Virar cartão", então ele vira um
   cartão de estudo (termo na frente, definição no verso), sem nova chamada.
4. Dado um texto não concluído, quando o glossário é gerado, então só entram
   termos que aparecem até a posição de leitura.
5. Dado que reabro o glossário sem ter avançado 1.000 palavras, quando ele
   aparece, então vem do que foi guardado, sem nova chamada.

**Notas técnicas:** Sonnet, cota `estudo`. Guardado em `ai_results` com a
impressão do conteúdo e a faixa de 1.000 palavras da posição na chave. Termo
que não aparece literalmente no texto é descartado na validação.

### US-165: Gerar um fichamento do texto

**Épico:** Estudo do texto com IA
**Prioridade:** Should
**Story points:** 5
**Status:** Proposta

Como leitor que estuda, eu quero um fichamento com a ideia central, os
argumentos, as evidências e as conclusões do texto, cada item com o trecho de
origem, para que eu tenha um material de estudo confiável sobre o que li.

**Critérios de aceitação**
1. Dado um texto concluído, quando toco "Fichamento", então vejo as seções
   "Ideia central", "Argumentos", "Evidências" e "Conclusões", com até 6 itens
   cada.
2. Dado um item do fichamento, quando toco na citação dele, então o leitor abre
   no trecho citado.
3. Dado um texto não concluído, quando abro "Fichamento", então vejo "Disponível
   ao concluir o texto." e nada é enviado.
4. Dado o fichamento pronto, quando toco "Exportar", então baixo um arquivo
   Markdown com as seções e as citações, no mesmo formato da exportação de
   destaques.

**Notas técnicas:** usa Citations da API, como a US-128. Guardado em
`ai_results` com a impressão do conteúdo.

### US-166: Receber perguntas-guia antes de ler uma seção

**Épico:** Estudo do texto com IA
**Prioridade:** Could
**Story points:** 3
**Status:** Proposta

Como leitor que estuda, eu quero ver 2 ou 3 perguntas sobre a próxima seção
antes de começar a lê-la, para que eu leia procurando as respostas.

**Critérios de aceitação**
1. Dado um texto com seções (títulos ou US-153) e a opção ligada, quando chego
   ao início de uma seção, então vejo até 3 perguntas sobre ela, com
   "Começar a ler".
2. Dado que termino a seção, quando passo para a seguinte, então as perguntas
   anteriores aparecem de novo com "Ver no texto" para cada uma.
3. Dado um texto sem seções, quando abro a opção, então ela aparece desativada
   com "Este texto não tem seções."

**Notas técnicas:** é a única story que envia texto à frente da posição de
leitura: a seção inteira, a pedido do leitor. A opção começa desligada, e o
aviso de consentimento diz isso. Haiku, cota `estudo`.

### US-167: Explicar o texto com as próprias palavras e receber apontamentos

**Épico:** Estudo do texto com IA
**Prioridade:** Could
**Story points:** 5
**Status:** Proposta

Como leitor que estuda, eu quero escrever o que entendi de uma seção e receber
apontamentos do que ficou de fora ou divergiu do texto, para que eu descubra
lacunas na minha compreensão.

**Critérios de aceitação**
1. Dado uma seção lida, quando escrevo de 30 a 300 palavras e toco "Conferir",
   então recebo até 4 apontamentos, cada um com o trecho do texto que o
   sustenta.
2. Dado a resposta, quando ela aparece, então não traz nota nem porcentagem, e
   nada entra nas estatísticas de compreensão.
3. Dado um texto com menos de 30 palavras, quando toco "Conferir", então vejo
   "Escreva pelo menos 30 palavras." e nada é enviado.

**Notas técnicas:** a ausência de nota é o que separa esta story do item
"perguntas abertas com correção por IA", que está no Won't Have do backlog
principal. Sonnet, cota `estudo`.

### US-168: Pedir uma analogia para um cartão que errei

**Épico:** Estudo do texto com IA
**Prioridade:** Could
**Story points:** 2
**Status:** Proposta

Como leitor que estuda, eu quero pedir uma analogia ou um exemplo quando erro
um cartão, para que o conceito fique mais fácil de lembrar.

**Critérios de aceitação**
1. Dado que marquei "Errei" num cartão, quando toco "Explicar de outro jeito",
   então recebo uma analogia de até 50 palavras.
2. Dado a analogia, quando toco "Guardar no cartão", então ela passa a aparecer
   no verso.
3. Dado que a cota acabou, quando toco a opção, então vejo a mensagem de cota e
   a revisão continua.

**Notas técnicas:** Haiku, cota `estudo`. Envia só a frente, o verso e o trecho
de origem do cartão.

## Fora do escopo (Won't Have)

- **Gerar cartões automaticamente ao importar:** gera custo para textos que
  talvez nunca sejam estudados. A geração é sempre a pedido.
- **Sincronizar com o AnkiWeb:** não há API pública. A exportação em texto
  (US-160) cobre o uso.
- **Nota para respostas escritas pelo leitor:** a correção de resposta livre
  varia entre execuções. A US-167 dá apontamentos sem nota.
- **Imagens e diagramas gerados para os cartões:** a API do Claude não gera
  imagens.
- **Baralhos compartilhados entre leitores:** mudaria o modelo de privacidade;
  todas as consultas são restritas ao dono.
- **Plano de estudo com datas de prova:** exige calendário e metas por
  assunto, fora do objetivo de leitura do app.

## Sugestão de MVP

**Sprint 1 (22 pontos, Must)**
- US-155 Gerar cartões dos pontos e conceitos principais (5)
- US-156 Revisar os cartões com repetição espaçada (3)
- US-170 Testar o conhecimento prévio antes de ler (3)
- US-158 Criar cartão a partir de um trecho selecionado (3)
- US-161 Revisão do dia num só lugar (5)
- US-169 Refazer o questionário depois de alguns dias (3)

**Sprint 2 (19 pontos)**
- US-164 Glossário de conceitos (5, Must)
- US-157 Tipo de cartão (2)
- US-159 Cartão à mão (2)
- US-160 Exportar para o Anki (2)
- US-162 Retenção por texto (3)
- US-165 Fichamento (5)

**Depois, conforme o uso medido (12 pontos, Could)**
- US-163 Lembrete de revisão (2)
- US-166 Perguntas-guia (3)
- US-167 Explicar com as próprias palavras (5)
- US-168 Analogia para cartão errado (2)
