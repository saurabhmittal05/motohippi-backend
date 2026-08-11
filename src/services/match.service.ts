import { db, usersTable, swipesTable, matchesTable, conversationsTable, messagesTable } from "../lib/db/index.js";
import { eq, and, or, sql } from "drizzle-orm";
import { formatUser } from "../routes/auth.js";

export async function handleSwipe(swiperId: number, targetId: number, action: string) {
  // Record the swipe action
  await db
    .insert(swipesTable)
    .values({ swiperId, targetId, action })
    .onConflictDoNothing();

  if (action !== "like" && action !== "superlike") {
    return { isMatch: false, status: "disliked" };
  }

  // Check if target user has already swiped right on swiperId
  const [theirSwipe] = await db
    .select()
    .from(swipesTable)
    .where(
      and(
        eq(swipesTable.swiperId, targetId),
        eq(swipesTable.targetId, swiperId),
        or(eq(swipesTable.action, "like"), eq(swipesTable.action, "superlike"))
      )
    )
    .limit(1);

  if (theirSwipe) {
    // Mutual match! Auto-accept and create conversation directly
    const [conv] = await db
      .insert(conversationsTable)
      .values({ user1Id: swiperId, user2Id: targetId })
      .returning();

    const [newMatch] = await db
      .insert(matchesTable)
      .values({
        user1Id: swiperId,
        user2Id: targetId,
        requesterId: swiperId,
        receiverId: targetId,
        status: "accepted",
        conversationId: conv.id,
        acceptedAt: new Date(),
      })
      .returning();

    const [matchedUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, targetId))
      .limit(1);

    return {
      isMatch: true,
      status: "accepted",
      match: {
        id: newMatch.id,
        user: formatUser(matchedUser),
        conversationId: conv.id,
        matchedAt: newMatch.matchedAt.toISOString(),
      },
    };
  }

  // Single-sided right swipe: Create PENDING match request for receiver's inbox
  const [existingMatch] = await db
    .select()
    .from(matchesTable)
    .where(
      or(
        and(eq(matchesTable.user1Id, swiperId), eq(matchesTable.user2Id, targetId)),
        and(eq(matchesTable.user1Id, targetId), eq(matchesTable.user2Id, swiperId))
      )
    )
    .limit(1);

  if (!existingMatch) {
    await db.insert(matchesTable).values({
      user1Id: swiperId,
      user2Id: targetId,
      requesterId: swiperId,
      receiverId: targetId,
      status: "pending",
    });
  }

  return { isMatch: false, status: "pending" };
}

export async function getPendingRequestsForUser(receiverId: number) {
  // Automatically backfill any historical right-swipes from swipesTable into matchesTable
  try {
    const unlinkedSwipes = await db
      .select()
      .from(swipesTable)
      .where(
        and(
          eq(swipesTable.targetId, receiverId),
          or(eq(swipesTable.action, "like"), eq(swipesTable.action, "superlike"))
        )
      );

    for (const swipe of unlinkedSwipes) {
      const [existingMatch] = await db
        .select()
        .from(matchesTable)
        .where(
          or(
            and(eq(matchesTable.user1Id, swipe.swiperId), eq(matchesTable.user2Id, swipe.targetId)),
            and(eq(matchesTable.user1Id, swipe.targetId), eq(matchesTable.user2Id, swipe.swiperId))
          )
        )
        .limit(1);

      if (!existingMatch) {
        await db.insert(matchesTable).values({
          user1Id: swipe.swiperId,
          user2Id: swipe.targetId,
          requesterId: swipe.swiperId,
          receiverId: swipe.targetId,
          status: "pending",
        });
      }
    }
  } catch (err) {
    console.error("⚠️ Pending swipe backfill check error:", err);
  }

  // Fetch pending match requests for receiver
  const pendingMatches = await db
    .select()
    .from(matchesTable)
    .where(
      and(
        eq(matchesTable.receiverId, receiverId),
        eq(matchesTable.status, "pending")
      )
    );

  const formatted = await Promise.all(
    pendingMatches.map(async (match) => {
      const [requester] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, match.requesterId!))
        .limit(1);

      if (!requester) return null;

      return {
        id: match.id,
        requester: formatUser(requester),
        matchedAt: match.matchedAt.toISOString(),
      };
    })
  );

  return formatted.filter(Boolean);
}

export async function acceptMatchRequest(receiverId: number, matchId: number) {
  const [match] = await db
    .select()
    .from(matchesTable)
    .where(
      and(
        eq(matchesTable.id, matchId),
        eq(matchesTable.receiverId, receiverId),
        eq(matchesTable.status, "pending")
      )
    )
    .limit(1);

  if (!match) {
    throw new Error("Pending match request not found");
  }

  const requesterId = match.requesterId!;

  // 1. Create 1-on-1 Conversation
  const [conv] = await db
    .insert(conversationsTable)
    .values({ user1Id: requesterId, user2Id: receiverId })
    .returning();

  // 2. Create initial welcome system message
  const [requester] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, requesterId))
    .limit(1);

  const initialText = `You matched with ${requester?.name || "a rider"}! Say Hi 🏍️`;
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    senderId: requesterId,
    content: initialText,
    messageType: "text",
  });

  await db
    .update(conversationsTable)
    .set({ lastMessage: initialText, lastMessageAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));

  // 3. Update Match Status to ACCEPTED
  await db
    .update(matchesTable)
    .set({
      status: "accepted",
      conversationId: conv.id,
      acceptedAt: new Date(),
    })
    .where(eq(matchesTable.id, matchId));

  return {
    success: true,
    conversationId: conv.id,
    requester: formatUser(requester),
  };
}

export async function declineMatchRequest(receiverId: number, matchId: number) {
  const [match] = await db
    .select()
    .from(matchesTable)
    .where(
      and(
        eq(matchesTable.id, matchId),
        eq(matchesTable.receiverId, receiverId)
      )
    )
    .limit(1);

  if (!match) {
    throw new Error("Match request not found");
  }

  await db
    .update(matchesTable)
    .set({ status: "declined" })
    .where(eq(matchesTable.id, matchId));

  return { success: true };
}
