import { Router } from "express";
import { db } from "../lib/db/index.js";
import { usersTable, groupsTable, postsTable, matchesTable, conversationsTable, messagesTable, eventsTable } from "../lib/db/index.js";
import { eq, sql, desc, ne, and, or } from "drizzle-orm";
import { authMiddleware } from "../lib/auth.js";
import { formatUser } from "./auth.js";

const router = Router();

router.get("/dashboard", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;

  const [matchCount] = await db.select({ count: sql<number>`count(*)` }).from(matchesTable)
    .where(sql`${matchesTable.user1Id} = ${userId} OR ${matchesTable.user2Id} = ${userId}`);
  const [convCount] = await db.select({ count: sql<number>`count(*)` }).from(conversationsTable)
    .where(sql`${conversationsTable.user1Id} = ${userId} OR ${conversationsTable.user2Id} = ${userId}`);
  const [unreadCount] = await db.select({ count: sql<number>`count(*)` })
    .from(messagesTable)
    .innerJoin(conversationsTable, eq(messagesTable.conversationId, conversationsTable.id))
    .where(
      and(
        or(eq(conversationsTable.user1Id, userId), eq(conversationsTable.user2Id, userId)),
        ne(messagesTable.senderId, userId),
        eq(messagesTable.isRead, false)
      )
    );

  const suggestedRiders = await db.select().from(usersTable).where(ne(usersTable.id, userId)).limit(6);
  const nearbyEvents = await db.select().from(eventsTable).orderBy(desc(eventsTable.createdAt)).limit(4);
  const featuredGroups = await db.select().from(groupsTable).orderBy(desc(groupsTable.membersCount)).limit(4);
  const trendingPosts = await db.select().from(postsTable).orderBy(desc(postsTable.likesCount)).limit(4);

  const formattedPosts = (await Promise.all(trendingPosts.map(async post => {
    const [author] = await db.select().from(usersTable).where(eq(usersTable.id, post.authorId)).limit(1);
    if (!author) return null;
    return {
      id: post.id, content: post.content, imageUrl: post.imageUrl, videoUrl: post.videoUrl,
      author: formatUser(author), likesCount: post.likesCount, commentsCount: post.commentsCount,
      isLiked: false, hashtags: (post.hashtags as string[]) || [],
      location: post.location, createdAt: post.createdAt ? new Date(post.createdAt).toISOString() : new Date().toISOString(),
    };
  }))).filter(Boolean);

  res.json({
    stats: {
      totalMatches: Number(matchCount?.count ?? 0),
      groupsCount: Number(convCount?.count ?? 0),
      unreadMessages: Number(unreadCount?.count ?? 0),
    },
    suggestedRiders: suggestedRiders.map(formatUser),
    nearbyEvents: nearbyEvents.map(e => ({
      id: e.id, title: e.title, date: e.date, location: e.location,
      imageUrl: e.imageUrl, attendeesCount: e.attendeesCount, type: e.type,
    })),
    featuredGroups: featuredGroups.map(g => ({
      id: g.id, name: g.name, description: g.description, logoUrl: g.logoUrl,
      coverUrl: g.coverUrl, type: g.type, membersCount: g.membersCount,
      category: g.category, city: g.city, createdById: g.createdById,
      isMember: false, createdAt: g.createdAt ? new Date(g.createdAt).toISOString() : new Date().toISOString(),
    })),
    trendingPosts: formattedPosts,
  });
});

export default router;
