import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { parseToken } from "../lib/auth.js";
import { db, conversationsTable, messagesTable } from "../lib/db/index.js";
import { eq, sql } from "drizzle-orm";

interface UserSocket extends WebSocket {
  userId?: number;
  isAlive?: boolean;
}

const userSockets = new Map<number, Set<UserSocket>>();

export function initWebSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    
    // Only handle WebSocket connections on /ws endpoint
    if (url.pathname !== "/ws" && url.pathname !== "/api/ws") {
      return;
    }

    const token = url.searchParams.get("token");
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const userId = parseToken(token);
    if (!userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const userWs = ws as UserSocket;
      userWs.userId = userId;
      userWs.isAlive = true;
      wss.emit("connection", userWs, request);
    });
  });

  wss.on("connection", (ws: UserSocket) => {
    const userId = ws.userId;
    if (!userId) {
      ws.close(1008, "User not authenticated");
      return;
    }

    // Register active user socket connection
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(ws);

    console.log(`⚡ WebSocket connected: User ${userId}`);

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", async (rawMessage) => {
      try {
        const payload = JSON.parse(rawMessage.toString());
        await handleIncomingFrame(ws, userId, payload);
      } catch (err) {
        console.error("❌ WebSocket frame error:", err);
      }
    });

    ws.on("close", () => {
      const userSet = userSockets.get(userId);
      if (userSet) {
        userSet.delete(ws);
        if (userSet.size === 0) {
          userSockets.delete(userId);
        }
      }
      console.log(`🔌 WebSocket disconnected: User ${userId}`);
    });
  });

  // Heartbeat ping interval to prune stale connections
  const interval = setInterval(() => {
    for (const [, socketSet] of userSockets) {
      for (const ws of socketSet) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });

  return wss;
}

async function handleIncomingFrame(ws: UserSocket, senderId: number, payload: any) {
  if (payload.type === "send_message") {
    const { conversationId, content } = payload;
    if (!conversationId || !content || typeof content !== "string" || !content.trim()) {
      return;
    }

    // 1. Verify user membership in conversation
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1);

    if (!conv || (conv.user1Id !== senderId && conv.user2Id !== senderId)) {
      ws.send(JSON.stringify({ type: "error", message: "Not a member of this conversation" }));
      return;
    }

    // 2. Persist message into PostgreSQL
    const [message] = await db
      .insert(messagesTable)
      .values({
        conversationId,
        senderId,
        content: content.trim(),
        messageType: "text",
      })
      .returning();

    // 3. Update conversation last_message preview
    await db
      .update(conversationsTable)
      .set({
        lastMessage: content.trim(),
        lastMessageAt: new Date(),
      })
      .where(eq(conversationsTable.id, conversationId));

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

    // 4. Real-Time Broadcast to both participants over open WebSockets
    const receiverId = conv.user1Id === senderId ? conv.user2Id : conv.user1Id;
    broadcastToUser(senderId, outboundPayload);
    broadcastToUser(receiverId, outboundPayload);
  }
}

export function broadcastToUser(userId: number, data: any) {
  const socketSet = userSockets.get(userId);
  if (!socketSet) return;
  const jsonString = JSON.stringify(data);
  for (const socket of socketSet) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(jsonString);
    }
  }
}
