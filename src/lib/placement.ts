/**
 * Teste de velocidade inicial.
 *
 * O texto e as perguntas sao fixos e versionados aqui, sem depender de modelo
 * de linguagem: o teste precisa funcionar em qualquer instalacao, inclusive
 * uma sem chave configurada, e a medida so vale se todo mundo ler o mesmo
 * texto.
 *
 * Funcoes puras, compartilhadas entre servidor e cliente.
 */

import { clamp, countWords, MAX_WPM, MIN_WPM } from "@/lib/reading";

/** Abaixo disso a compreensao nao sustenta o ritmo medido. */
export const COMPREHENSION_FLOOR = 60;

/** Acima disso o ritmo medido ainda tem folga. */
export const COMPREHENSION_CEILING = 80;

/** Leitura tao lenta que o cronometro mediu uma pausa, nao uma leitura. */
export const MAX_TEST_SECONDS = 30 * 60;

export interface PlacementQuestion {
  prompt: string;
  choices: string[];
  /** Indice da alternativa correta. */
  answer: number;
}

export const PLACEMENT_TITLE = "O relojoeiro de Ouro Preto";

/**
 * Texto do teste.
 *
 * Escrito para medir: frases de comprimento variado, vocabulario comum e
 * nenhuma informacao que o leitor possa ja saber - um texto sobre um assunto
 * conhecido mediria memoria, nao leitura.
 */
export const PLACEMENT_TEXT = `Joaquim herdou a oficina do pai em 1974, quando Ouro Preto ainda tinha mais ladeiras de pedra do que turistas. Eram quatro bancadas de madeira escura, uma janela alta voltada para o norte e um cheiro de oleo fino que nunca saiu das paredes. O pai havia trabalhado ali por trinta e dois anos consertando relogios de bolso, e nos ultimos tempos quase so relogios de parede, porque os de bolso tinham virado lembranca de familia guardada em gaveta.

O trabalho exigia uma coisa que Joaquim demorou a aprender: paciencia com o erro dos outros. Quase todo relogio que chegava a bancada tinha sido aberto antes por alguem com uma chave de fenda inadequada. As marcas ficavam na tampa, pequenos arranhoes em forma de meia-lua, e Joaquim aprendeu a ler nelas a historia do aparelho. Um relogio muito arranhado tinha passado por muitas maos apressadas.

A primeira licao do pai foi sobre limpeza. Antes de diagnosticar qualquer defeito, desmontar e limpar. Nove em cada dez relogios parados, dizia ele, nao estao quebrados: estao sujos. A poeira entra pelo eixo, mistura-se ao lubrificante velho e endurece ate formar uma pasta que trava a engrenagem menor, aquela que quase ninguem consegue ver sem lupa. O conserto verdadeiro era quase sempre uma limpeza demorada, e o cliente costumava ficar decepcionado ao saber disso, porque queria uma peca nova.

A segunda licao levou mais tempo. Certa vez chegou um relogio de pendulo que adiantava exatos quatro minutos por dia. Joaquim regulou a lentilha, ajustou o escape, trocou o cordao, e nada. Passou tres semanas nisso. Foi o pai, ja quase sem enxergar, quem perguntou onde o relogio ficava pendurado na casa da dona. Ficava sobre a lareira. O calor dilatava a haste do pendulo durante a noite, e o relogio media o tempo de um jeito diferente conforme a temperatura da sala. Nao havia defeito nenhum na maquina.

Joaquim contava essa historia para todo aprendiz que passava pela oficina, sempre com a mesma frase no fim: o problema quase nunca esta onde voce esta olhando. Ele dizia isso batendo de leve na bancada, como quem marca um compasso.

Nos anos noventa, os relogios de quartzo tomaram conta de tudo, e a oficina passou a receber menos consertos e mais avaliacoes. As pessoas queriam saber quanto valia o relogio do avo. Joaquim abria a tampa, olhava a maquina, dizia um numero honesto e via a decepcao na cara de quase todo mundo. O valor de mercado de um relogio comum, por mais antigo que fosse, raramente pagava o conserto. Ele passou a perguntar antes se a pessoa pretendia vender ou usar. Quando a resposta era usar, o conserto valia sempre a pena, e ele dizia isso com convicao.

A oficina fechou em 2011. Joaquim tinha sessenta e oito anos e as maos ja tremiam o suficiente para tornar arriscado o trabalho com as pecas menores. Ele doou as bancadas para uma escola tecnica em Mariana e ficou apenas com a caixa de ferramentas do pai, que continua em cima de um armario, envolta em um pano de algodao. Uma vez por ano ele a abre, limpa cada peca com oleo fino e guarda de novo. Nao e nostalgia, explica. E que ferramenta parada tambem enferruja.`;

export const PLACEMENT_QUESTIONS: PlacementQuestion[] = [
  {
    prompt: "Segundo o pai de Joaquim, qual e a causa mais comum de um relogio parado?",
    choices: [
      "Uma peca interna quebrada pelo uso",
      "Sujeira endurecida travando a engrenagem",
      "A corda arrebentada dentro do tambor",
      "O desgaste natural do mostrador",
    ],
    answer: 1,
  },
  {
    prompt: "O que fazia o relogio de pendulo adiantar quatro minutos por dia?",
    choices: [
      "A lentilha estava regulada na posicao errada",
      "O escape precisava ser substituido",
      "O calor da lareira dilatava a haste do pendulo",
      "O cordao original estava esticado demais",
    ],
    answer: 2,
  },
  {
    prompt: "Como Joaquim lia a historia de um relogio antes mesmo de abri-lo?",
    choices: [
      "Pelo peso da maquina na mao",
      "Pelos arranhoes em meia-lua na tampa",
      "Pelo numero de serie gravado no fundo",
      "Pelo estado da pulseira ou da corrente",
    ],
    answer: 1,
  },
  {
    prompt: "Por que Joaquim passou a perguntar se a pessoa pretendia vender ou usar o relogio?",
    choices: [
      "Porque cobrava precos diferentes em cada caso",
      "Porque o conserto compensava sempre que a intencao era usar",
      "Porque so aceitava consertar o que seria vendido",
      "Porque precisava saber se emitiria nota fiscal",
    ],
    answer: 1,
  },
  {
    prompt: "Por que Joaquim limpa a caixa de ferramentas do pai uma vez por ano?",
    choices: [
      "Porque pretende voltar a trabalhar com relogios",
      "Porque vai doa-la a escola tecnica de Mariana",
      "Porque ferramenta parada tambem enferruja",
      "Porque e um pedido que o pai lhe fez",
    ],
    answer: 2,
  },
];

export const PLACEMENT_WORDS = countWords(PLACEMENT_TEXT);

/** Palavras por minuto medidas na leitura do texto do teste. */
export function measuredWpm(durationMs: number, words = PLACEMENT_WORDS): number {
  const minutes = durationMs / 60_000;
  if (minutes <= 0) return 0;
  return Math.round(words / minutes);
}

/** Porcentagem de acertos, arredondada. */
export function scorePlacement(answers: number[]): number {
  const right = PLACEMENT_QUESTIONS.filter(
    (question, index) => answers[index] === question.answer
  );
  return Math.round((right.length / PLACEMENT_QUESTIONS.length) * 100);
}

/**
 * Velocidade sugerida a partir do que foi medido.
 *
 * Um ppm alto com compreensao baixa nao e uma leitura rapida: e uma leitura
 * que nao aconteceu. Por isso a sugestao desce abaixo do medido quando os
 * acertos ficam abaixo do piso, e so sobe quando sobra folga.
 */
export function suggestWpm(wpm: number, comprehension: number): number {
  const factor =
    comprehension < COMPREHENSION_FLOOR ? 0.8 : comprehension >= COMPREHENSION_CEILING ? 1.15 : 1;

  return clamp(Math.round((wpm * factor) / 10) * 10, MIN_WPM, MAX_WPM);
}

/** Frase que explica a sugestao, para a tela nao mostrar so um numero. */
export function suggestionReason(comprehension: number): string {
  if (comprehension < COMPREHENSION_FLOOR) {
    return "A compreensao ficou abaixo de 60%, entao a sugestao e mais lenta que o ritmo medido: velocidade sem entendimento nao e leitura.";
  }
  if (comprehension >= COMPREHENSION_CEILING) {
    return "A compreensao ficou alta, entao ainda ha folga para acelerar um pouco.";
  }
  return "A compreensao ficou no meio da faixa, entao a sugestao acompanha o ritmo medido.";
}

/**
 * Segundos minimos para o texto ter sido lido.
 *
 * Derivado do teto de velocidade do proprio leitor, nao de um numero fixo: um
 * piso de vinte segundos deixaria passar mil e quinhentos ppm neste texto, e
 * a medida seria de quem pulou para o fim, nao de quem leu.
 */
export function minSeconds(words = PLACEMENT_WORDS): number {
  return Math.ceil((words / MAX_WPM) * 60);
}

/** Verdadeiro quando a duracao medida e plausivel como leitura. */
export function plausibleDuration(durationMs: number, words = PLACEMENT_WORDS): boolean {
  const seconds = durationMs / 1000;
  return seconds >= minSeconds(words) && seconds <= MAX_TEST_SECONDS;
}
