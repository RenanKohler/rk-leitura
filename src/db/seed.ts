import "../lib/load-env";
import { hashSync } from "bcryptjs";
import { db, getPool } from "./index";
import { readingSessions, speedSettings, texts, users } from "./schema";
import { countWords } from "../lib/reading";

const DEMO_EMAIL = "leitor@exemplo.com";
const DEMO_PASSWORD = "demo1234";

const DEMO_TEXTS = [
  {
    title: "Por que a leitura profunda continua importando",
    sourceUrl: "https://exemplo.com/leitura-profunda",
    content: `A leitura profunda e o tipo de leitura em que a atencao fica inteira no texto por um periodo longo. Nao e so decodificar palavras: e acompanhar um argumento ate o fim, guardar o que veio antes e relacionar com o que vem depois.

Pesquisas em psicologia cognitiva associam esse tipo de leitura a ganhos de memoria de trabalho e de compreensao. Quem le com regularidade mantem melhor desempenho em tarefas que exigem manter varias informacoes na cabeca ao mesmo tempo.

A leitura de ficcao tem um efeito adicional: ao acompanhar personagens com historias diferentes da nossa, exercitamos a capacidade de imaginar outros pontos de vista. Isso e medido em testes de cognicao social e aparece de forma consistente.

O ambiente digital trabalha contra esse habito. Notificacoes, rolagem infinita e textos curtos treinam o oposto: trocar de assunto rapido. A leitura profunda funciona como contrapeso, reensinando o cerebro a sustentar foco.

Tecnicas de leitura dinamica ajudam quando usadas com criterio. Aumentar o ritmo faz sentido em textos informativos e conhecidos; em material tecnico ou denso, a velocidade precisa cair. O ponto nao e ler rapido sempre, e ajustar o ritmo ao texto.

Ler tambem reduz estresse de forma mensuravel. Poucos minutos de leitura concentrada baixam a frequencia cardiaca e a tensao muscular mais do que varias outras atividades de descanso.

Para construir o habito, o que funciona e a constancia, nao a duracao. Quinze minutos por dia rendem mais do que duas horas em um sabado. Escolher textos que realmente interessam tambem importa mais do que seguir listas de leitura obrigatoria.`,
  },
  {
    title: "Como funcionam as tecnicas de leitura dinamica",
    sourceUrl: "https://exemplo.com/leitura-dinamica",
    content: `Leitura dinamica e um conjunto de tecnicas para aumentar o ritmo sem perder compreensao. Parte das promessas do mercado e exagerada, mas ha metodos com efeito real e explicavel.

Tudo comeca em como o olho processa texto. A leitura nao e continua: o olho salta em movimentos curtos chamados sacadas e para em pontos de fixacao. Um leitor comum faz cerca de tres fixacoes por segundo, cada uma cobrindo poucas palavras.

A primeira tecnica e reduzir a subvocalizacao, a voz interna que pronuncia cada palavra. Ela ajuda em material dificil, mas limita a velocidade ao ritmo da fala, algo entre 150 e 250 palavras por minuto.

A segunda e ampliar o campo de visao util. Em vez de fixar palavra por palavra, o leitor treinado percebe grupos de tres a cinco palavras por fixacao, cobrindo mais texto a cada salto.

A terceira e diminuir regressoes, aquele habito de voltar para reler o que ja passou. Boa parte das regressoes e automatica e desnecessaria; percebe-las ja reduz bastante a frequencia.

Usar um guia visual, como o dedo ou um marcador na tela, mantem o ritmo estavel e evita que o olho vagueie. E o principio por tras da apresentacao palavra a palavra: o texto vai ate o olho, em vez de o olho procurar o texto.

Nada disso substitui pratica. Como qualquer habilidade motora e cognitiva, o ganho vem da repeticao com material progressivamente mais dificil.`,
  },
  {
    title: "Atencao: o recurso mais escasso do dia",
    sourceUrl: "https://exemplo.com/atencao",
    content: `Atencao e o processo que seleciona o que entra na consciencia e descarta o resto. Entender como ela funciona muda a forma de estudar, trabalhar e ler.

A psicologia cognitiva separa alguns tipos. A atencao seletiva escolhe um estimulo entre varios. A atencao sustentada mantem o foco ao longo do tempo. A atencao dividida tenta cobrir duas tarefas ao mesmo tempo, e e nesse ponto que a evidencia e mais dura: o que chamamos de multitarefa costuma ser alternancia rapida, com custo em erro e tempo.

O estado de fluxo descrito por Mihaly Csikszentmihalyi aparece quando a dificuldade da tarefa se equilibra com a habilidade de quem a executa. Ler produz fluxo com facilidade quando o texto interessa e esta no nivel certo.

Fatores fisicos pesam mais do que se imagina. Privacao de sono derruba a atencao sustentada de forma comparavel a intoxicacao alcoolica leve. Fome, desidratacao e sedentarismo tem efeitos menores, porem consistentes.

O ambiente tambem decide. Ruido imprevisivel, desordem visual e interrupcoes frequentes quebram o encadeamento. Um espaco simples e silencioso e mais eficiente do que qualquer tecnica de forca de vontade.

Trabalhar em blocos com pausas curtas, como propoe a tecnica pomodoro, ajuda porque respeita o limite natural da atencao sustentada em vez de tentar vence-lo.`,
  },
];

async function seed() {
  console.log("Populando o banco com dados de demonstracao...");

  const [user] = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      passwordHash: hashSync(DEMO_PASSWORD, 12),
      name: "Leitor Demo",
    })
    .onConflictDoNothing()
    .returning();

  if (!user) {
    console.log(`Usuario ${DEMO_EMAIL} ja existe. Nada a fazer.`);
    await getPool().end();
    return;
  }

  await db.insert(speedSettings).values({
    userId: user.id,
    baseWpm: 320,
    wordsPerChunk: 1,
    readingMode: "rsvp",
  });

  const created = [];
  for (const item of DEMO_TEXTS) {
    const [text] = await db
      .insert(texts)
      .values({
        userId: user.id,
        title: item.title,
        sourceUrl: item.sourceUrl,
        content: item.content,
        wordCount: countWords(item.content),
      })
      .returning();
    created.push(text);
    console.log(`  texto: ${text.title} (${text.wordCount} palavras)`);
  }

  // Sessoes com datas espalhadas nos ultimos dias, para o historico nao ficar
  // todo agrupado em "Hoje".
  const now = Date.now();
  for (let i = 0; i < 6; i += 1) {
    const text = created[i % created.length]!;
    const wordsRead = Math.round(text.wordCount * (0.4 + Math.random() * 0.6));
    const wpm = 240 + Math.round(Math.random() * 160);
    const durationMs = Math.round((wordsRead / wpm) * 60_000);

    await db.insert(readingSessions).values({
      userId: user.id,
      textId: text.id,
      wpm,
      wordsRead,
      durationMs,
      completed: wordsRead >= text.wordCount * 0.95,
      createdAt: new Date(now - i * 26 * 60 * 60 * 1000),
    });
  }

  console.log(`\nPronto. Entre com ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  await getPool().end();
}

seed().catch(async (error) => {
  console.error("Falha ao popular o banco:", error);
  process.exit(1);
});
