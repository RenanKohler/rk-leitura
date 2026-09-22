import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
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
    wordsPerChunk: integer("words_per_chunk").notNull().default(1),
    highlightOpacity: real("highlight_opacity").notNull().default(0.35),
    // "rsvp" (uma palavra por vez) ou "flow" (texto corrido com destaque).
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("highlights_text_start_idx").on(table.textId, table.startIndex)]
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
