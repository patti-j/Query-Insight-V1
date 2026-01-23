import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const popularQueries = pgTable("popular_queries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  question: text("question").notNull().unique(),
  count: integer("count").notNull().default(1),
  lastUsed: timestamp("last_used").notNull().default(sql`now()`),
});

export const insertPopularQuerySchema = createInsertSchema(popularQueries).omit({
  id: true,
});

export type InsertPopularQuery = z.infer<typeof insertPopularQuerySchema>;
export type PopularQuery = typeof popularQueries.$inferSelect;
