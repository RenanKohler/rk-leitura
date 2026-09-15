import { sql } from "drizzle-orm";
import {
  boolean,
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("speed_settings_user_unique").on(table.userId)]
);

export type User = typeof users.$inferSelect;
export type Text = typeof texts.$inferSelect;
export type ReadingSession = typeof readingSessions.$inferSelect;
export type SpeedSettings = typeof speedSettings.$inferSelect;
