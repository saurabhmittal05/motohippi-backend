import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { parseToken } from "../lib/auth.js";
import { db, conversationsTable, messagesTable } from "../lib/db/index.js";
import { eq, sql } from "drizzle-orm";
import { uploadMedia } from "./upload.service.js";

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
    if (url.pathname !== "/ws") {
      socket.destroy();
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

    wss.handleUpgrade(request, socket, head, (ws: UserSocket) => {
      ws.userId = userId;
      ws.isAlive = true;
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: UserSocket) => {
    const userId = ws.userId;
    if (!userId) return;

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(ws);

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (data: string) => {
      try {
        const payload = JSON.parse(data.toString());
        handleIncomingFrame(ws, userId, payload);
      } catch (err) {
        console.error("Failed to parse WebSocket frame:", err);
      }
    });

    ws.on("close", () => {
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          userSockets.delete(userId);
        }
      }
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      const userWs = ws as UserSocket;
      if (userWs.isAlive === false) return userWs.terminate();
      userWs.isAlive = false;
      userWs.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });

  return wss;
}

async function handleIncomingFrame(ws: UserSocket, senderId: number, payload: any) {
  if (payload.type === "send_message") {
    const { conversationId, content, messageType } = payload;
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

    let finalContent = content.trim();
    let msgType = messageType || "text";

    // 2. Intercept base64 images and enforce AWS S3 storage
    if (finalContent.startsWith("data:image/") || (msgType === "image" && !finalContent.startsWith("http"))) {
      try {
        const uploadRes = await uploadMedia(finalContent, "chat_images");
        if (uploadRes?.url && uploadRes.url.startsWith("http")) {
          finalContent = uploadRes.url;
          msgType = "image";
        } else {
          ws.send(JSON.stringify({ type: "error", message: "Failed to upload image to AWS S3" }));
          return;
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: "error", message: err?.message || "Failed to upload image to AWS S3" }));
        return;
      }
    }

    // 3. Persist message into PostgreSQL
    const [message] = await db
      .insert(messagesTable)
      .values({
        conversationId,
        senderId,
        content: finalContent,
        messageType: msgType,
      })
      .returning();

    const lastMsgPreview = msgType === "image" ? "📷 Photo" : finalContent;

    // 4. Update conversation last_message preview
    await db
      .update(conversationsTable)
      .set({
        lastMessage: lastMsgPreview,
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
