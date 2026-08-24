import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  orderId: text("order_id").notNull().unique(),
  cfOrderId: text("cf_order_id"),
  planId: text("plan_id").notNull(),
  amount: integer("amount").notNull(), // amount in INR
  currency: text("currency").default("INR").notNull(),
  status: text("status").default("PENDING").notNull(), // PENDING, PAID, FAILED, CANCELLED
  cfPaymentId: text("cf_payment_id"),
  paymentMode: text("payment_mode"),
  rawWebhookData: jsonb("raw_webhook_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Payment = typeof paymentsTable.$inferSelect;
