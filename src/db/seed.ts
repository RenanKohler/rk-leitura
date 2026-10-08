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
    content: `A leitura profunda é o tipo de leitura em que a atenção fica inteira no texto por um período longo. Não é só decodificar palavras: é acompanhar um argumento até o fim, guardar o que veio antes e relacionar com o que vem depois.

Pesquisas em psicologia cognitiva associam esse tipo de leitura a ganhos de memória de trabalho e de compreensão. Quem lê com regularidade mantém melhor desempenho em tarefas que exigem manter várias informações na cabeça ao mesmo tempo.

A leitura de ficção tem um efeito adicional: ao acompanhar personagens com histórias diferentes da nossa, exercitamos a capacidade de imaginar outros pontos de vista. Isso é medido em testes de cognição social e aparece de forma consistente.

O ambiente digital trabalha contra esse hábito. Notificações, rolagem infinita e textos curtos treinam o oposto: trocar de assunto rápido. A leitura profunda funciona como contrapeso, reensinando o cérebro a sustentar foco.

Técnicas de leitura dinâmica ajudam quando usadas com critério. Aumentar o ritmo faz sentido em textos informativos e conhecidos; em material técnico ou denso, a velocidade precisa cair. O ponto não é ler rápido sempre, é ajustar o ritmo ao texto.

Ler também reduz estresse de forma mensurável. Poucos minutos de leitura concentrada baixam a frequência cardíaca e a tensão muscular mais do que várias outras atividades de descanso.

Para construir o hábito, o que funciona é a constância, não a duração. Quinze minutos por dia rendem mais do que duas horas em um sábado. Escolher textos que realmente interessam também importa mais do que seguir listas de leitura obrigatória.`,
  },
  {
    title: "Como funcionam as técnicas de leitura dinâmica",
    sourceUrl: "https://exemplo.com/leitura-dinamica",
    content: `Leitura dinâmica é um conjunto de técnicas para aumentar o ritmo sem perder compreensão. Parte das promessas do mercado é exagerada, mas há métodos com efeito real e explicável.

Tudo começa em como o olho processa texto. A leitura não é contínua: o olho salta em movimentos curtos chamados sacadas e para em pontos de fixação. Um leitor comum faz cerca de três fixações por segundo, cada uma cobrindo poucas palavras.

A primeira técnica é reduzir a subvocalização, a voz interna que pronuncia cada palavra. Ela ajuda em material difícil, mas limita a velocidade ao ritmo da fala, algo entre 150 e 250 palavras por minuto.

A segunda é ampliar o campo de visão útil. Em vez de fixar palavra por palavra, o leitor treinado percebe grupos de três a cinco palavras por fixação, cobrindo mais texto a cada salto.

A terceira é diminuir regressões, aquele hábito de voltar para reler o que já passou. Boa parte das regressões é automática e desnecessária; percebê-las já reduz bastante a frequência.

Usar um guia visual, como o dedo ou um marcador na tela, mantém o ritmo estável e evita que o olho vagueie. É o princípio por trás da apresentação palavra a palavra: o texto vai até o olho, em vez de o olho procurar o texto.

Nada disso substitui prática. Como qualquer habilidade motora e cognitiva, o ganho vem da repetição com material progressivamente mais difícil.`,
  },
  {
    title: "Atenção: o recurso mais escasso do dia",
    sourceUrl: "https://exemplo.com/atencao",
    content: `Atenção é o processo que seleciona o que entra na consciência e descarta o resto. Entender como ela funciona muda a forma de estudar, trabalhar e ler.

A psicologia cognitiva separa alguns tipos. A atenção seletiva escolhe um estímulo entre vários. A atenção sustentada mantém o foco ao longo do tempo. A atenção dividida tenta cobrir duas tarefas ao mesmo tempo, e é nesse ponto que a evidência é mais dura: o que chamamos de multitarefa costuma ser alternância rápida, com custo em erro e tempo.

O estado de fluxo descrito por Mihaly Csikszentmihalyi aparece quando a dificuldade da tarefa se equilibra com a habilidade de quem a executa. Ler produz fluxo com facilidade quando o texto interessa e está no nível certo.

Fatores físicos pesam mais do que se imagina. Privação de sono derruba a atenção sustentada de forma comparável à intoxicação alcoólica leve. Fome, desidratação e sedentarismo têm efeitos menores, porém consistentes.

O ambiente também decide. Ruído imprevisível, desordem visual e interrupções frequentes quebram o encadeamento. Um espaço simples e silencioso é mais eficiente do que qualquer técnica de força de vontade.

Trabalhar em blocos com pausas curtas, como propõe a técnica pomodoro, ajuda porque respeita o limite natural da atenção sustentada em vez de tentar vencê-lo.`,
  },
];

async function seed() {
  console.log("Populando o banco com dados de demonstração...");

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
    console.log(`Usuário ${DEMO_EMAIL} já existe. Nada a fazer.`);
    await getPool().end();
    return;
  }

  await db.insert(speedSettings).values({
    userId: user.id,
    baseWpm: 320,
    // Padrao de conta nova (PROD-16); a coluna ainda nasce desligada.
    eyeRest: true,
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
