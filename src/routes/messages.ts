import { Router } from "express";
import { db } from "../lib/db/index.js";
import { conversationsTable, messagesTable, usersTable } from "../lib/db/index.js";
import { eq, sql, desc, and, lt } from "drizzle-orm";
import { authMiddleware } from "../lib/auth.js";
import { formatUser } from "./auth.js";
import { SendMessageBody } from "../lib/api-zod/index.js";
import { broadcastToUser } from "../services/ws.service.js";

const router = Router();

router.get("/conversations", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const conversations = await db.select().from(conversationsTable)
    .where(sql`${conversationsTable.user1Id} = ${userId} OR ${conversationsTable.user2Id} = ${userId}`)
    .orderBy(desc(conversationsTable.lastMessageAt))
    .limit(30);

  const formatted = (await Promise.all(conversations.map(async conv => {
    const otherUserId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;
    const [otherUser] = await db.select().from(usersTable).where(eq(usersTable.id, otherUserId)).limit(1);
    if (!otherUser) return null;
    const unreadCount = await db.select({ count: sql<number>`count(*)` }).from(messagesTable)
      .where(sql`${messagesTable.conversationId} = ${conv.id} AND ${messagesTable.senderId} != ${userId} AND ${messagesTable.isRead} = false`);
    return {
      id: conv.id, participant: formatUser(otherUser),
      lastMessage: conv.lastMessage, lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      unreadCount: Number(unreadCount[0]?.count ?? 0),
    };
  }))).filter(Boolean);
  res.json(formatted);
});

router.post("/conversations", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const { otherUserId } = req.body;
  if (!otherUserId) { res.status(400).json({ error: "otherUserId required" }); return; }
  const [existing] = await db.select().from(conversationsTable)
    .where(sql`(${conversationsTable.user1Id} = ${userId} AND ${conversationsTable.user2Id} = ${otherUserId}) OR (${conversationsTable.user1Id} = ${otherUserId} AND ${conversationsTable.user2Id} = ${userId})`)
    .limit(1);
  if (existing) { res.json(existing); return; }
  const [conv] = await db.insert(conversationsTable).values({ user1Id: userId, user2Id: otherUserId }).returning();
  res.status(201).json(conv);
});

router.get("/conversations/:conversationId/messages", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const conversationId = parseInt(req.params.conversationId, 10);
  const beforeId = req.query.beforeId ? parseInt(req.query.beforeId as string, 10) : null;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId)).limit(1);
  if (!conv || (conv.user1Id !== userId && conv.user2Id !== userId)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const whereClause = beforeId
    ? and(eq(messagesTable.conversationId, conversationId), lt(messagesTable.id, beforeId))
    : eq(messagesTable.conversationId, conversationId);

  const messages = await db.select().from(messagesTable)
    .where(whereClause)
    .orderBy(desc(messagesTable.id))
    .limit(limit);

  res.json(messages.map(m => ({
    id: m.id, content: m.content, senderId: m.senderId,
    messageType: m.messageType, createdAt: m.createdAt.toISOString(),
  })));
});

router.post("/conversations/:conversationId/messages", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const conversationId = parseInt(req.params.conversationId, 10);
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId)).limit(1);
  if (!conv || (conv.user1Id !== userId && conv.user2Id !== userId)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const result = SendMessageBody.safeParse(req.body);
  if (!result.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [message] = await db.insert(messagesTable).values({
    conversationId, senderId: userId,
    content: result.data.content, messageType: result.data.messageType ?? "text",
  }).returning();
  if (!message) { res.status(500).json({ error: "Failed to send message" }); return; }
  await db.update(conversationsTable).set({ lastMessage: result.data.content, lastMessageAt: new Date() }).where(eq(conversationsTable.id, conversationId));

  const outboundPayload = {
    type: "new_message",
    message: {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
      messageType: message.messageType,
      createdAt: message.createdAt.toISOString(),
    },
  };

  const receiverId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;
  broadcastToUser(userId, outboundPayload);
  broadcastToUser(receiverId, outboundPayload);

  res.status(201).json(outboundPayload.message);
});

export default router;
