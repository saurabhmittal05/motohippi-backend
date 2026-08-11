import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const swipesTable = pgTable("swipes", {
  id: serial("id").primaryKey(),
  swiperId: integer("swiper_id").notNull().references(() => usersTable.id),
  targetId: integer("target_id").notNull().references(() => usersTable.id),
  action: text("action").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const matchesTable = pgTable("matches", {
  id: serial("id").primaryKey(),
  user1Id: integer("user1_id").notNull().references(() => usersTable.id),
  user2Id: integer("user2_id").notNull().references(() => usersTable.id),
  requesterId: integer("requester_id").references(() => usersTable.id),
  receiverId: integer("receiver_id").references(() => usersTable.id),
  status: text("status").default("pending").notNull(), // "pending" | "accepted" | "declined"
  conversationId: integer("conversation_id"),
  matchedAt: timestamp("matched_at").defaultNow().notNull(),
  acceptedAt: timestamp("accepted_at"),
});

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  location: text("location").notNull(),
  imageUrl: text("image_url"),
  attendeesCount: integer("attendees_count").default(0).notNull(),
  type: text("type").default("ride").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  imageUrl: text("image_url"),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
