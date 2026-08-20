import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  username: text("username").unique(),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  coverUrl: text("cover_url"),
  bio: text("bio"),
  city: text("city"),
  country: text("country"),
  age: integer("age"),
  gender: text("gender"),
  vehicleType: text("vehicle_type"),
  adventureLevel: text("adventure_level"),
  travelStyle: text("travel_style"),
  lookingFor: jsonb("looking_for").$type<string[]>().default([]),
  interests: jsonb("interests").$type<string[]>().default([]),
  followersCount: integer("followers_count").default(0).notNull(),
  followingCount: integer("following_count").default(0).notNull(),
  tripsCount: integer("trips_count").default(0).notNull(),
  isVerified: boolean("is_verified").default(false).notNull(),
  plan: text("plan").default("free").notNull(),
  planExpiresAt: timestamp("plan_expires_at"),
  dailySwipesCount: integer("daily_swipes_count").default(0).notNull(),
  lastSwipeResetAt: timestamp("last_swipe_reset_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const followsTable = pgTable("follows", {
  id: serial("id").primaryKey(),
  followerId: integer("follower_id").notNull().references(() => usersTable.id),
  followingId: integer("following_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
