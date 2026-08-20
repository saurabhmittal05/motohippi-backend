import { Router } from "express";
import { db } from "../lib/db/index.js";
import { usersTable, swipesTable, matchesTable } from "../lib/db/index.js";
import { eq, ne, sql } from "drizzle-orm";
import { authMiddleware } from "../lib/auth.js";
import { formatUser } from "./auth.js";
import { SwipeBody } from "../lib/api-zod/index.js";
import * as matchService from "../services/match.service.js";
import * as matchController from "../controllers/match.controller.js";

const router = Router();

router.get("/discover/candidates", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const swiped = await db.select({ targetId: swipesTable.targetId }).from(swipesTable).where(eq(swipesTable.swiperId, userId));
  const swipedIds = swiped.map(s => s.targetId);

  const baseWhere = swipedIds.length > 0
    ? sql`${usersTable.id} != ${userId} AND ${usersTable.id} NOT IN (${sql.join(swipedIds.map(id => sql`${id}`), sql`, `)})`
    : ne(usersTable.id, userId);

  const candidates = await db.select().from(usersTable).where(baseWhere).limit(20);
  const result = candidates.map((user) => ({
    id: user.id,
    name: user.name,
    age: user.age ?? 25,
    city: user.city ?? "Mumbai",
    country: user.country,
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    vehicleType: user.vehicleType ?? "motorcycle",
    vehicles: [],
    adventureLevel: user.adventureLevel ?? "intermediate",
    travelStyle: user.travelStyle,
    interests: (user.interests as string[]) || [],
    lookingFor: (user.lookingFor as string[]) || [],
    bio: user.bio,
    distanceKm: Math.floor(Math.random() * 200) + 5,
    isVerified: user.isVerified,
  }));
  res.json(result);
});

router.post("/discover/swipe", authMiddleware, async (req, res) => {
  const swiperId = (req as any).userId;
  const result = SwipeBody.safeParse(req.body);
  if (!result.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { targetUserId, action } = result.data;

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, swiperId)).limit(1);
    if (user) {
      const userPlan = user.plan || "free";
      if (userPlan === "free") {
        const now = new Date();
        const lastReset = user.lastSwipeResetAt ? new Date(user.lastSwipeResetAt) : new Date(0);
        const hoursPassed = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

        let count = user.dailySwipesCount ?? 0;
        if (hoursPassed >= 24) {
          count = 0;
          await db.update(usersTable)
            .set({ dailySwipesCount: 0, lastSwipeResetAt: now })
            .where(eq(usersTable.id, swiperId));
        }

        const maxLimit = parseInt(process.env.DAILY_SWIPE_LIMIT || "25", 10);
        if (count >= maxLimit) {
          res.status(403).json({
            error: `Daily swipe limit reached (${count}/${maxLimit}). Upgrade to Plus for unlimited swipes!`,
            code: "SWIPE_LIMIT_REACHED",
            dailySwipesCount: count,
            maxDailySwipes: maxLimit,
          });
          return;
        }

        await db.update(usersTable)
          .set({ dailySwipesCount: count + 1 })
          .where(eq(usersTable.id, swiperId));
      }
    }

    const swipeResult = await matchService.handleSwipe(swiperId, targetUserId, action);
    res.json(swipeResult);
  } catch (err: any) {
    res.status(500).json({ error: "Swipe processing failed", message: err?.message });
  }
});

router.post("/discover/undo-swipe", authMiddleware, async (req, res) => {
  const swiperId = (req as any).userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, swiperId)).limit(1);
    if (!user || user.plan === "free") {
      res.status(403).json({ error: "Undo swipe is a Plus/Gold/Platinum feature. Upgrade to unlock!" });
      return;
    }
    const [lastSwipe] = await db.select().from(swipesTable)
      .where(eq(swipesTable.swiperId, swiperId))
      .orderBy(sql`${swipesTable.createdAt} DESC`)
      .limit(1);
    if (lastSwipe) {
      await db.delete(swipesTable).where(eq(swipesTable.id, lastSwipe.id));
    }
    res.json({ success: true, message: "Last swipe undone!" });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to undo swipe", message: err?.message });
  }
});

router.get("/discover/matches", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const userMatches = await db.select().from(matchesTable)
    .where(
      sql`(${matchesTable.user1Id} = ${userId} OR ${matchesTable.user2Id} = ${userId}) AND ${matchesTable.status} = 'accepted'`
    )
    .limit(50);

  const result = (await Promise.all(userMatches.map(async (m) => {
    const otherUserId = m.user1Id === userId ? m.user2Id : m.user1Id;
    const [otherUser] = await db.select().from(usersTable).where(eq(usersTable.id, otherUserId)).limit(1);
    if (!otherUser) return null;
    return {
      id: m.id,
      user: formatUser(otherUser),
      conversationId: m.conversationId,
      matchedAt: m.matchedAt.toISOString(),
    };
  }))).filter(Boolean);
  res.json(result);
});

// ── Match Request Endpoints ───────────────────────────────────────────────────
router.get("/matches/pending", authMiddleware, matchController.getPendingRequests);
router.post("/matches/:id/accept", authMiddleware, matchController.acceptRequest);
router.post("/matches/:id/decline", authMiddleware, matchController.declineRequest);

export default router;
