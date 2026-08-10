import { db, usersTable } from "../lib/db/index.js";
import { eq } from "drizzle-orm";
import { hashPassword, generateToken } from "../lib/auth.js";
import { sendMail } from "../lib/email.js";
import { formatUser } from "../routes/auth.js";

interface OtpEntry {
  code: string;
  expires: number;
  userId: number;
}
export const otpStore = new Map<string, OtpEntry>();

interface PendingRegistration {
  name: string;
  email: string;
  passwordHash: string;
  phone?: string | null;
  code: string;
  expires: number;
}
export const pendingRegistrations = new Map<string, PendingRegistration>();

interface PasswordResetEntry {
  code: string;
  expires: number;
  userId: number;
}
export const passwordResetStore = new Map<string, PasswordResetEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of otpStore) {
    if (entry.expires < now) otpStore.delete(key);
  }
  for (const [key, entry] of pendingRegistrations) {
    if (entry.expires < now) pendingRegistrations.delete(key);
  }
  for (const [key, entry] of passwordResetStore) {
    if (entry.expires < now) passwordResetStore.delete(key);
  }
}, 10 * 60 * 1000);

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
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

export async function signupUser(data: { name: string; email: string; password: string; phone?: string | null }) {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, data.email))
    .limit(1);

  if (existing.length > 0) {
    throw new Error("Email already registered");
  }

  const code = generateOtp();
  pendingRegistrations.set(data.email, {
    name: data.name,
    email: data.email,
    passwordHash: hashPassword(data.password),
    phone: data.phone ?? null,
    code,
    expires: Date.now() + 10 * 60 * 1000,
  });

  sendOtpEmail(data.email, code).catch(() => {});
  return { email: data.email, emailVerificationSent: true, message: "OTP sent to email" };
}

export async function loginUser(email: string, pass: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user || user.passwordHash !== hashPassword(pass)) {
    throw new Error("Invalid credentials");
  }

  const token = generateToken(user.id);
  return {
    token,
    user: formatUser(user),
    requiresVerification: !user.isVerified,
  };
}

export async function verifyOtp(email?: string, userId?: number | null, code?: string) {
  if (!code || typeof code !== "string") {
    throw new Error("code is required");
  }

  if (email && pendingRegistrations.has(email)) {
    const pending = pendingRegistrations.get(email)!;
    if (Date.now() > pending.expires) {
      pendingRegistrations.delete(email);
      throw new Error("OTP has expired. Please request a new code.");
    }
    if (pending.code !== code.trim()) {
      throw new Error("Invalid code. Please try again.");
    }

    const [newUser] = await db
      .insert(usersTable)
      .values({
        name: pending.name,
        email: pending.email,
        passwordHash: pending.passwordHash,
        phone: pending.phone ?? null,
        isVerified: true,
      })
      .returning();

    pendingRegistrations.delete(email);

    if (!newUser) throw new Error("Failed to create user");

    const token = generateToken(newUser.id);
    return { token, user: formatUser(newUser) };
  }

  let targetUserId = userId;
  if (!targetUserId && email) {
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (dbUser) targetUserId = dbUser.id;
  }

  if (!targetUserId) throw new Error("No pending verification found for this email.");

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId)).limit(1);
  if (!user) throw new Error("User not found");

  const entry = otpStore.get(user.email);
  if (!entry) throw new Error("No OTP found. Please request a new code.");
  if (Date.now() > entry.expires) {
    otpStore.delete(user.email);
    throw new Error("OTP has expired. Please request a new code.");
  }
  if (entry.code !== code.trim()) throw new Error("Invalid code. Please try again.");

  await db.update(usersTable).set({ isVerified: true }).where(eq(usersTable.id, targetUserId));
  otpStore.delete(user.email);

  const token = generateToken(targetUserId);
  return { token, user: { ...formatUser(user), isVerified: true } };
}

export async function requestPasswordReset(email: string) {
  if (!email || !email.trim()) {
    throw new Error("Email is required");
  }
  const cleanEmail = email.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, cleanEmail))
    .limit(1);

  if (!user) {
    // Return generic success to avoid email enumeration
    return { message: "If an account exists with this email, a reset code has been sent." };
  }

  const code = generateOtp();
  passwordResetStore.set(cleanEmail, {
    code,
    expires: Date.now() + 10 * 60 * 1000,
    userId: user.id,
  });

  await sendMail({
    to: cleanEmail,
    subject: "Reset your MotoHippi password",
    templateName: "password-reset",
    variables: {
      title: "Reset Your Password",
      code,
      email: cleanEmail,
    },
  }).catch((err) => {
    console.error("❌ Error sending password reset email:", err);
  });

  return { message: "If an account exists with this email, a reset code has been sent." };
}

export async function resetPasswordWithOtp(email: string, code: string, newPassword: string) {
  if (!email || !code || !newPassword) {
    throw new Error("Email, code, and new password are required");
  }
  if (newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }

  const cleanEmail = email.trim().toLowerCase();
  const entry = passwordResetStore.get(cleanEmail);

  if (!entry) {
    throw new Error("No password reset request found for this email or code expired.");
  }
  if (Date.now() > entry.expires) {
    passwordResetStore.delete(cleanEmail);
    throw new Error("Reset code has expired. Please request a new code.");
  }
  if (entry.code !== code.trim()) {
    throw new Error("Invalid verification code. Please try again.");
  }

  const newPasswordHash = hashPassword(newPassword);

  await db
    .update(usersTable)
    .set({ passwordHash: newPasswordHash })
    .where(eq(usersTable.id, entry.userId));

  passwordResetStore.delete(cleanEmail);

  return { message: "Password updated successfully! You can now log in." };
}
