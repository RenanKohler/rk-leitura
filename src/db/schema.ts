import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull().default("Leitor"),
    // Versao das sessoes emitidas. Trocar a senha ou "sair de todos os
    // aparelhos" incrementa, e todo token com versao anterior deixa de valer.
    sessionVersion: integer("session_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Case-insensitive: e-mail e sempre normalizado para minusculas na escrita,
    // o indice garante a unicidade mesmo se algo escapar.
    uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
  ]
);

export const texts = pgTable(
  "texts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // Nulo quando o texto foi colado manualmente em vez de importado.
    sourceUrl: text("source_url"),
    content: text("content").notNull(),
    /**
     * Conteudo como foi importado, guardado quando o leitor omite as
     * referencias de um texto ja salvo. E o que permite desfazer. Nulo no
     * caso comum, e volta a nulo quando o conteudo e editado.
     */
    originalContent: text("original_content"),
    // "markdown" quando o conteudo guarda marcas de formatacao a interpretar
    // na leitura; "plain" para os demais, inclusive todos os anteriores.
    format: text("format").notNull().default("plain"),
    // Idioma do texto (US-67): decide voz, dicionario e questionario.
    language: text("language").notNull().default("pt-BR"),
    wordCount: integer("word_count").notNull().default(0),
    // Posicao salva para retomar a leitura de onde parou.
    progressIndex: integer("progress_index").notNull().default(0),
    // Ultima pagina ja trazida da origem. A importacao inicial e a pagina 1;
    // a continuacao busca sourceUrl com ?page=sourcePage+1.
    sourcePage: integer("source_page").notNull().default(1),
    // Nulo enquanto o texto esta na lista principal. Arquivar tira da lista
    // sem apagar: o historico de leitura continua contando.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * Identidade da historia a que este capitulo pertence, quando o padrao de
     * capitulo foi reconhecido (US-37). Nulo para texto solto, que e a
     * maioria: a deteccao e heuristica e falhar nela nao pode virar erro.
     */
    seriesKey: text("series_key"),
    /** Numero do capitulo dentro da serie. Nulo junto com `seriesKey`. */
    chapter: integer("chapter"),
    /**
     * Nome da serie como ele deve aparecer na tela.
     *
     * A chave e comparavel, nao legivel: `titulo:a cabana no inverno` perdeu
     * caixa e acento. Sem esta coluna, o cartao da serie so teria o titulo do
     * primeiro capitulo para mostrar - que em um livro e "A chegada", nao o
     * nome do livro.
     */
    seriesTitle: text("series_title"),
    /**
     * Posicao na fila de leitura (US-56). Nulo quando o texto nao esta na
     * fila - que e o estado normal. Arquivar ou concluir tira da fila.
     */
    queuePosition: integer("queue_position"),
    // Importado sem pedido do leitor, por serie acompanhada ou feed (US-70,
    // US-71). Enquanto a leitura nao comecar, a biblioteca o marca como "Novo".
    autoImportedAt: timestamp("auto_imported_at", { withTimezone: true }),
    // Largado no meio (US-79): sai da biblioteca e da fila, as sessoes ficam.
    abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
    // Palavras que faltavam ao largar: a base do tempo economizado (US-81).
    abandonedWords: integer("abandoned_words"),
    // Maior marco (25, 50, 75) ja respondido em "isso ainda vale?" (US-80).
    checkpointAnswered: integer("checkpoint_answered").notNull().default(0),
    /** Autor, quando a importacao achou ou o leitor informou (US-152). */
    author: text("author"),
    /**
     * Secoes de navegacao aplicadas a um texto sem titulos (US-153). Ficam
     * fora do conteudo: a contagem de palavras e as posicoes nao mudam.
     */
    sections: jsonb("sections").$type<{ index: number; title: string }[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("texts_user_created_idx").on(table.userId, table.createdAt.desc()),
    // A biblioteca agrupa por serie na propria consulta; sem o indice, cada
    // pagina varreria a tabela inteira para montar os cartoes.
    index("texts_user_series_idx").on(table.userId, table.seriesKey, table.chapter),
  ]
);

export const readingSessions = pgTable(
  "reading_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    textId: uuid("text_id")
      .notNull()
      .references(() => texts.id, { onDelete: "cascade" }),
    wpm: integer("wpm").notNull().default(0),
    wordsRead: integer("words_read").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    /** Acertos do questionario, em porcentagem. Nulo quando nao houve. */
    comprehension: integer("comprehension"),
    /**
     * Sessao ouvida em voz alta (US-39).
     *
     * Conta no historico como qualquer leitura, mas nao cumpre o dia do
     * programa de treino: o ritmo ali e o da voz, nao o do olho.
     */
    narrated: boolean("narrated").notNull().default(false),
    // Tempo previsto quando a leitura veio de uma sugestao por tempo livre
    // (US-85); a duracao real ao lado dela mede o acerto da previsao.
    plannedMs: integer("planned_ms"),
    /**
     * Como a sessao foi lida: "runner" (Foco e Rolagem guiada), "narracao"
     * (voz do aparelho) ou "pagina" (virando paginas no proprio ritmo).
     * Separar o ritmo por modo e o que da sentido a media: 450 ppm narrados e
     * 450 ppm no runner nao medem a mesma coisa. `narrated` continua existindo
     * por compatibilidade e anda junto com "narracao".
     */
    mode: text("mode").notNull().default("runner"),
    /**
     * Posicoes (indice de palavra) em que o leitor freou ou recuou durante a
     * sessao (PROD-10). Nulo quando a tela nao mediu - sessoes antigas e as
     * gravadas por versoes do leitor sem a contagem. Serve a sugestao de
     * reduzir a velocidade em `lib/difficulty.ts`.
     */
    brakes: jsonb("brakes").$type<number[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("reading_sessions_user_created_idx").on(table.userId, table.createdAt.desc())]
);

export const speedSettings = pgTable(
  "speed_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    baseWpm: integer("base_wpm").notNull().default(300),
    // Sem uso desde o leitor unificado (o Word Runner mostra uma palavra por
    // vez). A coluna fica para uma migracao futura que a remova.
    wordsPerChunk: integer("words_per_chunk").notNull().default(1),
    highlightOpacity: real("highlight_opacity").notNull().default(0.35),
    // Sem uso desde o leitor unificado: nao ha mais modos (Foco, Rolagem,
    // Paginas). A coluna fica para uma migracao futura que a remova.
    readingMode: text("reading_mode").notNull().default("rsvp"),
    theme: text("theme").notNull().default("system"),
    // Tipografia da area de leitura. Guardada por nivel, nao em pixels: a
    // conversao para tamanho real e do CSS, e muda com a largura da tela.
    fontScale: integer("font_scale").notNull().default(3),
    fontFamily: text("font_family").notNull().default("sans"),
    lineHeightStep: integer("line_height_step").notNull().default(2),
    // Rampa de aceleracao no inicio da leitura.
    warmup: boolean("warmup").notNull().default(true),
    /**
     * Enfase nas primeiras letras de cada palavra (US-61). Opcao e nao
     * padrao: o apoio ajuda alguns leitores e atrapalha outros.
     */
    wordEmphasis: boolean("word_emphasis").notNull().default(false),
    // Ritmo dinamico do Word Runner (US-87). Ligado por padrao
    // porque inclui a pausa em pontuacao que o leitor ja tinha.
    adaptiveRhythm: boolean("adaptive_rhythm").notNull().default(true),
    // "Isso ainda vale?" a 25, 50 e 75% do texto (US-80). Desligado por padrao.
    askCheckpoints: boolean("ask_checkpoints").notNull().default(false),
    // Sem uso: a pausa de paragrafo faz parte do ritmo dinamico (US-94).
    paragraphPause: boolean("paragraph_pause").notNull().default(false),
    // Recuo ao retomar, escalonado pelo tempo parado (US-95).
    resumeRewind: boolean("resume_rewind").notNull().default(true),
    // Sem uso desde o leitor unificado (US-103 dependia da Rolagem).
    dimLines: boolean("dim_lines").notNull().default(false),
    // Aviso para descansar a vista a cada 20 minutos de leitura (US-104).
    eyeRest: boolean("eye_rest").notNull().default(false),
    /**
     * Fuso do usuario, no formato IANA ("America/Sao_Paulo").
     *
     * Sem ele nao ha como dizer o que e "hoje": uma sessao das 22h em Sao
     * Paulo cai no dia seguinte em UTC, e a meta diaria e a sequencia de dias
     * contariam errado justamente no horario em que mais se le.
     */
    timezone: text("timezone").notNull().default("UTC"),
    /** Ultima segunda-feira em que o resumo da semana foi dispensado. */
    weeklySummarySeenOn: date("weekly_summary_seen_on"),
    /**
     * Resultado do teste de velocidade inicial (US-45), em ppm. Nulo enquanto
     * o teste nao foi feito.
     */
    placementWpm: integer("placement_wpm"),
    /**
     * Quando o teste foi oferecido pela ultima vez - fazendo ou pulando. E o
     * que impede a tela inicial de insistir a cada visita.
     */
    placementSeenAt: timestamp("placement_seen_at", { withTimezone: true }),
    /**
     * Hora local do lembrete diario (US-43), de 0 a 23. Nulo quando o leitor
     * nao quer lembrete - que e o padrao.
     */
    reminderHour: integer("reminder_hour"),
    /** Ultimo dia em que o lembrete foi enviado, no fuso do leitor. */
    reminderSentOn: date("reminder_sent_on"),
    /**
     * Guia de primeiro uso do leitor ja visto. Por conta e nao por aparelho:
     * quem ja aprendeu os gestos no celular nao precisa do guia no computador.
     */
    readerTipsSeen: boolean("reader_tips_seen").notNull().default(false),
    /**
     * Permissao para enviar conteudo ao servico de IA (US-125). Nulo enquanto
     * a conta nao decidiu: o servidor recusa a chamada e a tela pergunta.
     */
    aiEnabled: boolean("ai_enabled"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("speed_settings_user_unique").on(table.userId)]
);

/**
 * Metas de leitura, com historico.
 *
 * Uma linha por meta vigente a partir de uma data. Guardar so o valor atual
 * faria a sequencia de dias ser reavaliada pela meta de hoje, e mudar a meta
 * reescreveria o passado - um dia cumprido viraria falha retroativa.
 */
export const readingGoals = pgTable(
  "reading_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "minutos" ou "palavras". */
    kind: text("kind").notNull().default("minutos"),
    target: integer("target").notNull(),
    /** Primeiro dia em que esta meta vale, no fuso do usuario. */
    startsOn: date("starts_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Uma meta por dia de vigencia: trocar a meta duas vezes no mesmo dia
    // substitui, em vez de acumular linhas que empatariam na consulta.
    uniqueIndex("reading_goals_user_start_unique").on(table.userId, table.startsOn),
  ]
);

/**
 * Questionarios de compreensao, em cache por texto e versao do conteudo.
 *
 * A chave inclui um resumo do conteudo porque a continuacao (US-23) anexa
 * partes novas: sem ela, o questionario ficaria preso a primeira parte do
 * conto para sempre. Com ela, anexar conteudo gera um questionario novo e o
 * antigo deixa de ser usado - sem apagar nada.
 */
export const comprehensionQuizzes = pgTable(
  "comprehension_quizzes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    textId: uuid("text_id")
      .notNull()
      .references(() => texts.id, { onDelete: "cascade" }),
    /** Impressao do conteudo que gerou estas perguntas. */
    contentKey: text("content_key").notNull(),
    /** Perguntas em JSON, no formato de `lib/quiz.ts`. */
    questions: text("questions").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("comprehension_quizzes_text_key_unique").on(table.textId, table.contentKey)]
);

/**
 * Trechos destacados durante a leitura.
 *
 * O intervalo e por indice de palavra, no mesmo sistema do `progressIndex`:
 * a marcacao sobrevive a troca de fonte, de modo e de tamanho de tela. A
 * continuacao (US-23) apenas anexa conteudo ao fim, entao os indices
 * existentes seguem validos; editar o conteudo nao garante isso, e por isso a
 * edicao apaga os destaques do texto.
 */
export const highlights = pgTable(
  "highlights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    textId: uuid("text_id")
      .notNull()
      .references(() => texts.id, { onDelete: "cascade" }),
    /** Primeira palavra do trecho. */
    startIndex: integer("start_index").notNull(),
    /** Primeira palavra depois do trecho: o intervalo e `[start, end)`. */
    endIndex: integer("end_index").notNull(),
    /** Comentario de quem leu. Nulo quando o destaque e so a marcacao. */
    note: text("note"),
    /**
     * Revisao espacada do destaque (PROD-4), com a mesma regra das palavras
     * (`lib/vocabulary.ts`). Nulo enquanto nunca foi revisado: nesse caso ele
     * entra na revisao um dia depois de criado.
     */
    reviewDueOn: date("review_due_on"),
    /** Intervalo atual, em dias; 0 enquanto nunca foi revisado. */
    reviewInterval: integer("review_interval").notNull().default(0),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    /**
     * Cartao de revisao gerado a partir do destaque (US-150). Com os dois
     * preenchidos, a revisao pergunta antes de mostrar o trecho.
     */
    cardPrompt: text("card_prompt"),
    cardAnswer: text("card_answer"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("highlights_text_start_idx").on(table.textId, table.startIndex),
    // A revisao do dia procura por conta e data, nao por texto.
    index("highlights_user_review_idx").on(table.userId, table.reviewDueOn),
  ]
);

/**
 * Etiquetas da conta.
 *
 * Unica por nome dobrado (sem acento, em minusculas): "Ficção" e "ficcao"
 * seriam duas etiquetas que a tela mostraria lado a lado como se fossem
 * diferentes.
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("tags_user_name_unique").on(
      table.userId,
      sql`translate(lower(${table.name}), 'áàâãäåéèêëíìîïóòôõöøúùûüçñýÿ', 'aaaaaaeeeeiiiioooooouuuucnyy')`
    ),
  ]
);

/** Vinculo entre texto e etiqueta. */
export const textTags = pgTable(
  "text_tags",
  {
    textId: uuid("text_id")
      .notNull()
      .references(() => texts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.textId, table.tagId] }),
    index("text_tags_tag_idx").on(table.tagId),
  ]
);

/**
 * Programa de treino de velocidade (US-47).
 *
 * Uma linha por programa, ativo ou nao. `previousWpm` guarda a velocidade de
 * antes porque abandonar precisa devolver o leitor onde ele estava - o
 * programa mexe na preferencia de velocidade enquanto dura.
 */
export const trainingPrograms = pgTable(
  "training_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 14 ou 30 dias. */
    length: integer("length").notNull(),
    /** Velocidade de partida, base de todos os alvos. */
    startWpm: integer("start_wpm").notNull(),
    /** Velocidade que volta a valer ao abandonar. */
    previousWpm: integer("previous_wpm").notNull(),
    startedOn: date("started_on").notNull(),
    /** Preenchido ao abandonar ou ao concluir; nulo enquanto esta em curso. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("training_programs_user_idx").on(table.userId, table.createdAt.desc())]
);

/**
 * Dias cumpridos de um programa.
 *
 * So existem linhas para os dias ja feitos: o alvo dos dias futuros e
 * derivado, nao guardado. Guardar antecipadamente faria a regra da
 * compreensao chegar tarde demais, porque o questionario costuma ser
 * respondido depois de a sessao terminar.
 */
export const trainingDays = pgTable(
  "training_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => trainingPrograms.id, { onDelete: "cascade" }),
    day: integer("day").notNull(),
    /** Alvo que valia quando o dia foi cumprido. */
    targetWpm: integer("target_wpm").notNull(),
    /** Sessao que cumpriu o dia; e dela que vem a compreensao. */
    sessionId: uuid("session_id").references(() => readingSessions.id, {
      onDelete: "set null",
    }),
    wpm: integer("wpm").notNull(),
    /** Dia de calendario no fuso do leitor: um por dia, no maximo. */
    onDay: date("on_day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("training_days_program_day_unique").on(table.programId, table.day)]
);

/**
 * Palavras consultadas durante a leitura (US-38).
 *
 * Uma linha por palavra, nao por consulta: consultar duas vezes atualiza a
 * definicao em vez de encher a lista com a mesma palavra. A chave ignora
 * caixa e acento, como o resto do app.
 */
export const savedWords = pgTable(
  "saved_words",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Palavra como ela aparece no texto. */
    word: text("word").notNull(),
    /** Forma de dicionario. */
    base: text("base").notNull(),
    /** Classe gramatical no uso daquela frase. */
    kind: text("kind").notNull().default(""),
    definition: text("definition").notNull(),
    /** Idioma da palavra: o mesmo que o do texto em que ela apareceu. */
    language: text("language").notNull().default("pt-BR"),
    /** Traducao para o portugues, quando a palavra e de outro idioma (US-69). */
    translation: text("translation"),
    /** Frase em que a palavra apareceu, mostrada na revisao (US-64). */
    context: text("context"),
    /** Proxima revisao, no fuso do usuario; nula nas salvas antes da revisao. */
    nextReviewOn: date("next_review_on"),
    /** Etapa na sequencia de intervalos de `lib/vocabulary.ts`. */
    reviewStep: integer("review_step").notNull().default(0),
    /**
     * Intervalo atual em dias (PROD-7). Nulo nas palavras revisadas so pelo
     * esquema antigo de etapas: ai o intervalo sai de `reviewStep`.
     */
    reviewInterval: integer("review_interval"),
    /** Marcada como aprendida: sai da revisao, continua na lista (US-66). */
    learnedAt: timestamp("learned_at", { withTimezone: true }),
    /**
     * Tres definicoes erradas e plausiveis, geradas na mesma consulta da
     * definicao (US-151). Nulo nas palavras salvas antes disso.
     */
    distractors: jsonb("distractors").$type<string[]>(),
    /** Texto em que a palavra foi encontrada; nulo se ele for apagado. */
    textId: uuid("text_id").references(() => texts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // O idioma entra na chave: "pan" em espanhol e em ingles sao palavras
    // diferentes, com definicoes diferentes.
    uniqueIndex("saved_words_user_language_word_unique").on(
      table.userId,
      table.language,
      sql`translate(lower(${table.word}), 'áàâãäåéèêëíìîïóòôõöøúùûüçñýÿ', 'aaaaaaeeeeiiiioooooouuuucnyy')`
    ),
  ]
);

/**
 * Inscricoes de notificacao push (US-43).
 *
 * Uma por navegador, nao por conta: a mesma pessoa pode querer o lembrete no
 * celular e nao no computador. O endpoint e unico porque e ele que o servico
 * de push usa como identidade.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    /** Chaves do navegador, usadas para cifrar a mensagem. */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
    index("push_subscriptions_user_idx").on(table.userId),
  ]
);

/**
 * Contagem do limitador de taxa, compartilhada entre instancias.
 *
 * Em funcoes serverless cada instancia tem a propria memoria, entao dez
 * tentativas espalhadas por dez instancias passavam como uma cada - o limite
 * efetivo era o limite vezes o numero de instancias.
 *
 * O armazenamento e o Postgres que a aplicacao ja usa, na mesma regiao: uma
 * ida e volta de poucos milissegundos em operacoes que acontecem uma vez por
 * login ou por importacao. Redis resolveria o mesmo problema ao custo de mais
 * um servico para manter.
 */
export const rateLimits = pgTable("rate_limits", {
  /** Acao mais identidade de quem chama: `login:203.0.113.7`. */
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  /** Quando a janela termina e a contagem recomeca. */
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

/**
 * Respostas dadas nas revisoes de palavras e destaques (PROD-7).
 *
 * Uma linha por resposta, e nao um contador na propria palavra: a retencao
 * dos ultimos 30 dias precisa saber quando cada resposta aconteceu. O item
 * nao tem chave estrangeira porque aponta para duas tabelas; apagar a
 * palavra deixa as respostas, que continuam valendo para a taxa.
 */
export const reviewAnswers = pgTable(
  "review_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "palavra" ou "destaque". */
    kind: text("kind").notNull(),
    itemId: uuid("item_id").notNull(),
    /** "errei", "dificil", "bom" ou "facil". */
    grade: text("grade").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("review_answers_user_created_idx").on(table.userId, table.kind, table.createdAt)]
);

export type User = typeof users.$inferSelect;
export type Text = typeof texts.$inferSelect;
export type ReadingSession = typeof readingSessions.$inferSelect;
export type SpeedSettings = typeof speedSettings.$inferSelect;
export type ReadingGoal = typeof readingGoals.$inferSelect;
export type ComprehensionQuiz = typeof comprehensionQuizzes.$inferSelect;
export type Highlight = typeof highlights.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type TrainingProgram = typeof trainingPrograms.$inferSelect;
export type SavedWord = typeof savedWords.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/**
 * Series acompanhadas (US-70).
 *
 * A verificacao periodica procura o capitulo seguinte ao ultimo importado.
 * Tres falhas seguidas da origem pausam o acompanhamento, para nao insistir
 * para sempre num site fora do ar.
 */
export const seriesFollows = pgTable(
  "series_follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seriesKey: text("series_key").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    failures: integer("failures").notNull().default(0),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("series_follows_user_series_unique").on(table.userId, table.seriesKey)]
);

/**
 * Feeds RSS ou Atom assinados (US-71).
 *
 * `seenUntil` e a data do item mais novo ja visto: a verificacao so importa o
 * que veio depois, e a primeira nao despeja o arquivo inteiro do site.
 */
export const feeds = pgTable(
  "feeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    seenUntil: timestamp("seen_until", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    failures: integer("failures").notNull().default(0),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("feeds_user_url_unique").on(table.userId, table.url)]
);

/**
 * Marcadores de posicao dentro de um texto (US-92).
 *
 * Diferente do destaque, e um ponto e nao um intervalo: serve para voltar a
 * um trecho de referencia sem mexer na posicao de leitura. Editar o texto nao
 * apaga o marcador; se ele ficar alem do fim, a lista o mostra como fora do
 * texto e deixa apagar.
 */
export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    textId: uuid("text_id")
      .notNull()
      .references(() => texts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("bookmarks_text_position_idx").on(table.textId, table.position)]
);

/**
 * Codigos de recuperacao de acesso (US-96).
 *
 * A alternativa a recuperacao por e-mail enquanto nao ha provedor (US-05).
 * Guardado so o hash: o codigo aparece uma vez, na geracao. Gerar um conjunto
 * novo apaga o anterior inteiro.
 */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("recovery_codes_user_idx").on(table.userId)]
);

/**
 * Uma linha por aparelho conectado (US-97).
 *
 * O token leva o id da linha. Desconectar um aparelho marca `revokedAt`, e a
 * proxima requisicao dele deixa de valer - sem mexer na versao da conta, que
 * derrubaria todos. Tokens emitidos antes desta tabela nao tem id e seguem
 * valendo ate expirar ou ate "sair de todos os aparelhos".
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // Gravado no maximo uma vez por hora: escrever a cada requisicao seria
    // uma escrita no banco por clique.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("auth_sessions_user_idx").on(table.userId)]
);

/**
 * Uso do modelo de linguagem, uma linha por chamada concluida (US-124).
 *
 * So contagens: nenhum trecho, pergunta ou resposta e gravado aqui. O modelo
 * e o que respondeu, que muda quando o fallback atua.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** Chamada feita pela Batches API, cobrada pela metade. */
    batch: boolean("batch").notNull().default(false),
    /** sucesso, recusa, tempo ou falha (US-141). */
    outcome: text("outcome").notNull().default("sucesso"),
    /** Texto de onde saiu o conteudo enviado; nulo no dicionario (US-144). */
    textId: uuid("text_id").references(() => texts.id, { onDelete: "set null" }),
    /** Palavras do texto enviadas na chamada (US-144). */
    wordsSent: integer("words_sent").notNull().default(0),
    /** Tempo ate o primeiro trecho da resposta, nas chamadas com streaming (US-145). */
    firstTokenMs: integer("first_token_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ai_usage_created_idx").on(table.createdAt, table.feature)]
);

/**
 * Resultados gerados pelo modelo e guardados para nao pagar duas vezes:
 * explicacoes, resumos, descricoes de nomes, sinopses e sinteses.
 *
 * A chave ja carrega a impressao do conteudo que gerou o resultado; quando o
 * texto muda, a chave muda e o resultado antigo deixa de ser encontrado.
 */
export const aiResults = pgTable(
  "ai_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    textId: uuid("text_id").references(() => texts.id, { onDelete: "cascade" }),
    /** explicacao, resumo, capitulo, nomes, sinopse, sintese. */
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_results_user_kind_key_unique").on(table.userId, table.kind, table.key),
    index("ai_results_text_kind_idx").on(table.textId, table.kind),
  ]
);

/**
 * Perguntas feitas a um texto e as respostas (US-147). A posicao e a de
 * leitura no momento da pergunta; a impressao do conteudo diz se o texto
 * mudou desde entao.
 */
export const askTurns = pgTable(
  "ask_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    textId: uuid("text_id")
      .notNull()
      .references(() => texts.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    /** Resposta com as citacoes, no formato que a folha mostra. */
    answer: jsonb("answer").notNull(),
    position: integer("position").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ask_turns_text_created_idx").on(table.userId, table.textId, table.createdAt)]
);

/**
 * Lotes de definicoes enviados a Message Batches (US-139). Um por conta por
 * vez; as palavras do lote ficam listadas para o resultado voltar a elas.
 */
export const aiBatches = pgTable(
  "ai_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    batchId: text("batch_id").notNull(),
    /** processando, concluido. */
    status: text("status").notNull().default("processando"),
    wordIds: jsonb("word_ids").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [index("ai_batches_user_status_idx").on(table.userId, table.status)]
);
