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
export const PLACEMENT_TEXT = `Joaquim herdou a oficina do pai em 1974, quando Ouro Preto ainda tinha mais ladeiras de pedra do que turistas. Eram quatro bancadas de madeira escura, uma janela alta voltada para o norte e um cheiro de óleo fino que nunca saiu das paredes. O pai havia trabalhado ali por trinta e dois anos consertando relógios de bolso, e nos últimos tempos quase só relógios de parede, porque os de bolso tinham virado lembrança de família guardada em gaveta.

O trabalho exigia uma coisa que Joaquim demorou a aprender: paciência com o erro dos outros. Quase todo relógio que chegava à bancada tinha sido aberto antes por alguém com uma chave de fenda inadequada. As marcas ficavam na tampa, pequenos arranhões em forma de meia-lua, e Joaquim aprendeu a ler nelas a história do aparelho. Um relógio muito arranhado tinha passado por muitas mãos apressadas.

A primeira lição do pai foi sobre limpeza. Antes de diagnosticar qualquer defeito, desmontar e limpar. Nove em cada dez relógios parados, dizia ele, não estão quebrados: estão sujos. A poeira entra pelo eixo, mistura-se ao lubrificante velho e endurece até formar uma pasta que trava a engrenagem menor, aquela que quase ninguém consegue ver sem lupa. O conserto verdadeiro era quase sempre uma limpeza demorada, e o cliente costumava ficar decepcionado ao saber disso, porque queria uma peça nova.

A segunda lição levou mais tempo. Certa vez chegou um relógio de pêndulo que adiantava exatos quatro minutos por dia. Joaquim regulou a lentilha, ajustou o escape, trocou o cordão, e nada. Passou três semanas nisso. Foi o pai, já quase sem enxergar, quem perguntou onde o relógio ficava pendurado na casa da dona. Ficava sobre a lareira. O calor dilatava a haste do pêndulo durante a noite, e o relógio media o tempo de um jeito diferente conforme a temperatura da sala. Não havia defeito nenhum na máquina.

Joaquim contava essa história para todo aprendiz que passava pela oficina, sempre com a mesma frase no fim: o problema quase nunca está onde você está olhando. Ele dizia isso batendo de leve na bancada, como quem marca um compasso.

Nos anos noventa, os relógios de quartzo tomaram conta de tudo, e a oficina passou a receber menos consertos e mais avaliações. As pessoas queriam saber quanto valia o relógio do avô. Joaquim abria a tampa, olhava a máquina, dizia um número honesto e via a decepção na cara de quase todo mundo. O valor de mercado de um relógio comum, por mais antigo que fosse, raramente pagava o conserto. Ele passou a perguntar antes se a pessoa pretendia vender ou usar. Quando a resposta era usar, o conserto valia sempre a pena, e ele dizia isso com convicção.

A oficina fechou em 2011. Joaquim tinha sessenta e oito anos e as mãos já tremiam o suficiente para tornar arriscado o trabalho com as peças menores. Ele doou as bancadas para uma escola técnica em Mariana e ficou apenas com a caixa de ferramentas do pai, que continua em cima de um armário, envolta em um pano de algodão. Uma vez por ano ele a abre, limpa cada peça com óleo fino e guarda de novo. Não é nostalgia, explica. É que ferramenta parada também enferruja.`;

export const PLACEMENT_QUESTIONS: PlacementQuestion[] = [
  {
    prompt: "Segundo o pai de Joaquim, qual é a causa mais comum de um relógio parado?",
    choices: [
      "Uma peça interna quebrada pelo uso",
      "Sujeira endurecida travando a engrenagem",
      "A corda arrebentada dentro do tambor",
      "O desgaste natural do mostrador",
    ],
    answer: 1,
  },
  {
    prompt: "O que fazia o relógio de pêndulo adiantar quatro minutos por dia?",
    choices: [
      "A lentilha estava regulada na posição errada",
      "O escape precisava ser substituido",
      "O calor da lareira dilatava a haste do pêndulo",
      "O cordão original estava esticado demais",
    ],
    answer: 2,
  },
  {
    prompt: "Como Joaquim lia a história de um relógio antes mesmo de abri-lo?",
    choices: [
      "Pelo peso da máquina na mão",
      "Pelos arranhões em meia-lua na tampa",
      "Pelo número de série gravado no fundo",
      "Pelo estado da pulseira ou da corrente",
    ],
    answer: 1,
  },
  {
    prompt: "Por que Joaquim passou a perguntar se a pessoa pretendia vender ou usar o relógio?",
    choices: [
      "Porque cobrava preços diferentes em cada caso",
      "Porque o conserto compensava sempre que a intenção era usar",
      "Porque só aceitava consertar o que seria vendido",
      "Porque precisava saber se emitiria nota fiscal",
    ],
    answer: 1,
  },
  {
    prompt: "Por que Joaquim limpa a caixa de ferramentas do pai uma vez por ano?",
    choices: [
      "Porque pretende voltar a trabalhar com relógios",
      "Porque vai doá-la à escola técnica de Mariana",
      "Porque ferramenta parada também enferruja",
      "Porque é um pedido que o pai lhe fez",
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
    return "A compreensão ficou abaixo de 60%, então a sugestão é mais lenta que o ritmo medido: velocidade sem entendimento não é leitura.";
  }
  if (comprehension >= COMPREHENSION_CEILING) {
    return "A compreensão ficou alta, então ainda há folga para acelerar um pouco.";
  }
  return "A compreensão ficou no meio da faixa, então a sugestão acompanha o ritmo medido.";
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
