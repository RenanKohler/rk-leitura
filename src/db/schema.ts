import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
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
    wordCount: integer("word_count").notNull().default(0),
    // Posicao salva para retomar a leitura de onde parou.
    progressIndex: integer("progress_index").notNull().default(0),
    // Ultima pagina ja trazida da origem. A importacao inicial e a pagina 1;
    // a continuacao busca sourceUrl com ?page=sourcePage+1.
    sourcePage: integer("source_page").notNull().default(1),
    // Nulo enquanto o texto esta na lista principal. Arquivar tira da lista
    // sem apagar: o historico de leitura continua contando.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("texts_user_created_idx").on(table.userId, table.createdAt.desc())]
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
     * Fuso do usuario, no formato IANA ("America/Sao_Paulo").
     *
     * Sem ele nao ha como dizer o que e "hoje": uma sessao das 22h em Sao
     * Paulo cai no dia seguinte em UTC, e a meta diaria e a sequencia de dias
     * contariam errado justamente no horario em que mais se le.
     */
    timezone: text("timezone").notNull().default("UTC"),
    /** Ultima segunda-feira em que o resumo da semana foi dispensado. */
    weeklySummarySeenOn: date("weekly_summary_seen_on"),
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

export type User = typeof users.$inferSelect;
export type Text = typeof texts.$inferSelect;
export type ReadingSession = typeof readingSessions.$inferSelect;
export type SpeedSettings = typeof speedSettings.$inferSelect;
export type ReadingGoal = typeof readingGoals.$inferSelect;
