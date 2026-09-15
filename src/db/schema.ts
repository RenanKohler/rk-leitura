import { pgTable, text, timestamp, uuid, integer, real } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default("Reader"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const texts = pgTable("texts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sourceUrl: text("source_url").notNull(),
  content: text("content").notNull(),
  wordCount: integer("word_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const words = pgTable("words", {
  id: uuid("id").primaryKey().defaultRandom(),
  textId: uuid("text_id").notNull().references(() => texts.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  word: text("word").notNull(),
  startTime: real("start_time").notNull(),
  endTime: real("end_time").notNull(),
  isKnown: integer("is_known").default(0).notNull(),
});

export const readingSessions = pgTable("reading_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  textId: uuid("text_id").notNull().references(() => texts.id, { onDelete: "cascade" }),
  wpm: integer("wpm").notNull().default(0),
  wordsRead: integer("words_read").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  completed: integer("completed").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const speedSettings = pgTable("speed_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  baseWpm: integer("base_wpm").notNull().default(300),
  wordsPerChunk: integer("words_per_chunk").notNull().default(4),
  highlightOpacity: real("highlight_opacity").notNull().default(0.3),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
