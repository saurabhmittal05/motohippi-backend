import { Router } from "express";
import { db } from "../lib/db/index.js";
import { usersTable } from "../lib/db/index.js";
import { eq } from "drizzle-orm";
import { hashPassword, generateToken, authMiddleware } from "../lib/auth.js";
import { SignupBody, LoginBody } from "../lib/api-zod/index.js";
import { sendMail } from "../lib/email.js";

const router = Router();

// ── OTP store (in-memory; replace with Redis for multi-instance) ──────────────
interface OtpEntry {
  code: string;
  expires: number;
  userId: number;
}
const otpStore = new Map<string, OtpEntry>();

setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of otpStore) {
      if (entry.expires < now) otpStore.delete(key);
    }
  },
  10 * 60 * 1000,
);

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail(email: string, code: string): Promise<void> {
  console.log("reaching...");
  await sendMail({
    to: email,
    subject: "Your MotoHippi verification code",
    templateName: "otp-verification",
    variables: {
      title: "Verify your email",
      code,
      email,
    },
  }).catch(() => {
    console.log("❌ Error sending OTP email");
  });
}

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

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
router.post("/auth/signup", async (req, res) => {
  const result = SignupBody.safeParse(req.body);
  if (!result.success) {
    res
      .status(400)
      .json({ error: "Invalid input", details: result.error.flatten() });
    return;
  }
  const { name, email, password, phone } = result.data;

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (existing.length > 0) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      name,
      email,
      passwordHash: hashPassword(password),
      phone: phone ?? null,
    })
    .returning();
  if (!user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }

  const token = generateToken(user.id);
  const code = generateOtp();
  otpStore.set(email, {
    code,
    expires: Date.now() + 10 * 60 * 1000,
    userId: user.id,
  });
  await sendOtpEmail(email, code).catch(() => {});

  res
    .status(201)
    .json({ token, user: formatUser(user), emailVerificationSent: true });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post("/auth/login", async (req, res) => {
  try {
    const result = LoginBody.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const { email, password } = result.data;
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (!user || user.passwordHash !== hashPassword(password)) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = generateToken(user.id);
    res.status(200).json({
      token,
      user: formatUser(user),
      requiresVerification: !user.isVerified,
    });
  } catch (err: any) {
    console.error("❌ Login route error:", err);
    res
      .status(500)
      .json({ error: "Internal server error", message: err?.message });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post("/auth/logout", (_req, res) => {
  res.json({ message: "Logged out" });
});

// ── POST /api/auth/send-otp ───────────────────────────────────────────────────
router.post("/auth/send-otp", authMiddleware, async (req, res) => {
  const userId = (req as any).userId as number;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.isVerified) {
    res.json({ message: "Already verified" });
    return;
  }

  const existing = otpStore.get(user.email);
  if (existing && existing.expires - Date.now() > 9 * 60 * 1000) {
    res.json({ message: "OTP already sent recently" });
    return;
  }

  const code = generateOtp();
  otpStore.set(user.email, {
    code,
    expires: Date.now() + 10 * 60 * 1000,
    userId: user.id,
  });
  await sendOtpEmail(user.email, code).catch(() => {});
  res.json({ message: "OTP sent" });
});

// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────
router.post("/auth/verify-otp", authMiddleware, async (req, res) => {
  const userId = (req as any).userId as number;
  const { code } = req.body;
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code is required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const entry = otpStore.get(user.email);
  if (!entry) {
    res.status(400).json({ error: "No OTP found. Please request a new code." });
    return;
  }
  if (Date.now() > entry.expires) {
    otpStore.delete(user.email);
    res
      .status(400)
      .json({ error: "OTP has expired. Please request a new code." });
    return;
  }
  if (entry.code !== code.trim()) {
    res.status(400).json({ error: "Invalid code. Please try again." });
    return;
  }

  await db
    .update(usersTable)
    .set({ isVerified: true })
    .where(eq(usersTable.id, userId));
  otpStore.delete(user.email);

  const token = generateToken(userId);
  const updatedUser = { ...formatUser(user), isVerified: true };
  res.json({ message: "Email verified", token, user: updatedUser });
});

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
    res.redirect(`${frontendUrl}/login?error=google_failed`);
  }
});

export default router;
