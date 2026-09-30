/**
 * Texto de boas-vindas que toda conta nova recebe na biblioteca (PROD-5).
 *
 * Uma conta vazia nao tinha o que abrir: para experimentar o leitor era
 * preciso antes achar um artigo e importar. Este texto curto resolve as duas
 * coisas de uma vez - da o que ler e explica os gestos do leitor enquanto se
 * le. Ao contrario das strings de interface, vai com acentos: e conteudo de
 * leitura, e passa pelo dicionario e pela voz como qualquer outro texto.
 *
 * Modulo puro, sem banco, para o teste conferir o tamanho e o vocabulario.
 */

export const WELCOME_TITLE = "Boas-vindas ao Leitura";

export const WELCOME_CONTENT = [
  "Este é um texto curto para você experimentar o leitor. Leva uns dois minutos, e dá para voltar a ele quando quiser.",
  "O texto abre em páginas, como um livro. Para virar a página, deslize o dedo para o lado ou use as setas do rodapé.",
  "Quando quiser ler mais rápido, toque no botão de play. Ele inicia o Word Runner: as palavras aparecem uma de cada vez no centro da tela, e a frase inteira fica logo embaixo, para você não perder o fio. A velocidade é a que está em Ajustes e pode mudar a qualquer momento.",
  "Para pausar, toque na palavra do Word Runner. A leitura para exatamente onde você está.",
  "Quer começar de outro ponto? Toque em qualquer palavra da página, e a leitura segue a partir dela.",
  "Durante o Word Runner, os botões Voltar a frase e Avançar a frase levam ao começo da frase anterior ou da seguinte. Eles ajudam quando a atenção escapa por um instante.",
  "Encontrou uma palavra desconhecida? Toque e segure sobre ela para ver o significado. Você pode salvá-la e revisar depois, em Palavras.",
  "O progresso fica salvo sozinho. Pode fechar o aplicativo no meio de uma frase: na próxima vez, a leitura continua do mesmo lugar, neste ou em outro aparelho.",
  "Para trazer seus próprios textos, toque no botão de mais, na barra de navegação. Dá para colar um link, colar um texto ou escolher um arquivo em PDF, EPUB, Word, Markdown ou texto simples.",
  "Quando terminar este texto, ele sai da lista principal e vai para os arquivados. Boa leitura!",
].join("\n\n");
