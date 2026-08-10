import { Router } from "express";
import { usersTable } from "../lib/db/index.js";
import { db } from "../lib/db/index.js";
import { eq } from "drizzle-orm";
import { hashPassword, generateToken } from "../lib/auth.js";
import * as authController from "../controllers/auth.controller.js";

const router = Router();

// ── User formatter (shared across routes) ────────────────────────────────────
export function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    bio: user.bio,
    city: user.city,
    country: user.country,
    age: user.age,
    gender: user.gender,
    vehicleType: user.vehicleType,
    adventureLevel: user.adventureLevel,
    travelStyle: user.travelStyle,
    lookingFor: (user.lookingFor as string[]) || [],
    interests: (user.interests as string[]) || [],
    followersCount: user.followersCount,
    followingCount: user.followingCount,
    tripsCount: user.tripsCount,
    isVerified: user.isVerified,
    createdAt: user.createdAt
      ? new Date(user.createdAt).toISOString()
      : new Date().toISOString(),
  };
}

// ── Auth routes ─────────────────────────────────────────────────────────────
router.post("/auth/signup", authController.handleSignup);
router.post("/auth/login", authController.handleLogin);
router.post("/auth/logout", authController.handleLogout);
router.post("/auth/send-otp", authController.handleSendOtp);
router.post("/auth/verify-otp", authController.handleVerifyOtp);
router.post("/auth/forgot-password", authController.handleForgotPassword);
router.post("/auth/reset-password", authController.handleResetPassword);

// ── GET /api/auth/google ──────────────────────────────────────────────────────
router.get("/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    const frontendUrl = process.env.FRONTEND_URL ?? "";
    res.redirect(`${frontendUrl}/login?error=google_not_configured`);
    return;
  }
  const appUrl = process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`;
  const redirectUri = `${appUrl}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// ── GET /api/auth/google/callback ─────────────────────────────────────────────
router.get("/auth/google/callback", async (req, res) => {
  const { code, error } = req.query;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const frontendUrl = process.env.FRONTEND_URL ?? "";

  if (error || !code || !clientId || !clientSecret) {
    res.redirect(`${frontendUrl}/login?error=google_failed`);
    return;
  }

  try {
    const appUrl =
      process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${appUrl}/api/auth/google/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenRes.json()) as any;
    if (!tokens.access_token) throw new Error("No access token");

    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );
    const profile = (await profileRes.json()) as any;
    const { email, name, picture } = profile;
    if (!email) throw new Error("No email from Google");

    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (!user) {
      const [created] = await db
        .insert(usersTable)
        .values({
          name: name || email.split("@")[0],
          email,
          passwordHash: hashPassword(crypto.randomUUID()),
          avatarUrl: picture || null,
          isVerified: true,
        })
        .returning();
      if (!created) throw new Error("Failed to create Google user");
      user = created;
    } else if (!user.isVerified) {
      await db
        .update(usersTable)
        .set({ isVerified: true })
        .where(eq(usersTable.id, user.id));
      user = { ...user, isVerified: true };
    }

    const token = generateToken(user.id);
    res.redirect(`${frontendUrl}/login?token=${token}&verified=true`);
  } catch (err) {
    console.error("Google OAuth error:", err);
    res.redirect(`${frontendUrl}/login?error=google_error`);
  }
});

export default router;
