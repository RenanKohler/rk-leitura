/** O que cada secao de "Estudar" recebe da pagina. */
export interface StudyProps {
  textId: string;
  title: string;
  language: string;
  /** Palavra atual da leitura: decide o que ja foi lido. */
  progressIndex: number;
  wordCount: number;
}
