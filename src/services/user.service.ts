import { db, usersTable, followsTable } from "../lib/db/index.js";
import { eq, and, sql, or, ilike } from "drizzle-orm";
import { formatUser } from "../routes/auth.js";
import { uploadImageToS3 } from "./s3.service.js";

export async function getProfileById(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return null;
  return formatUser(user);
}

export async function updateProfile(userId: number, updateData: Record<string, any>) {
  const payload = { ...updateData };

  // Upload Base64 avatarUrl / coverUrl to AWS S3
  if (payload.avatarUrl && payload.avatarUrl.startsWith("data:")) {
    const s3Url = await uploadImageToS3(payload.avatarUrl, "avatars");
    if (s3Url.startsWith("data:")) {
      throw new Error("Failed to upload avatar to AWS S3. Please verify S3 credentials.");
    }
    payload.avatarUrl = s3Url;
  }

  if (payload.coverUrl && payload.coverUrl.startsWith("data:")) {
    const s3Url = await uploadImageToS3(payload.coverUrl, "covers");
    if (s3Url.startsWith("data:")) {
      throw new Error("Failed to upload cover photo to AWS S3. Please verify S3 credentials.");
    }
    payload.coverUrl = s3Url;
  }

  const [updatedUser] = await db
    .update(usersTable)
    .set(payload)
    .where(eq(usersTable.id, userId))
    .returning();

  if (!updatedUser) return null;
  return formatUser(updatedUser);
}

export async function searchUsers(query: string, currentUserId: number) {
  if (!query || query.trim() === "") return [];

  const results = await db
    .select()
    .from(usersTable)
    .where(
      or(
        ilike(usersTable.name, `%${query}%`),
        ilike(usersTable.username, `%${query}%`),
        ilike(usersTable.city, `%${query}%`)
      )
    )
    .limit(20);

  return results.map(formatUser);
}

export async function followUser(followerId: number, followingId: number) {
  if (followerId === followingId) {
    throw new Error("Cannot follow yourself");
  }

  const existing = await db
    .select()
    .from(followsTable)
    .where(and(eq(followsTable.followerId, followerId), eq(followsTable.followingId, followingId)))
    .limit(1);

  if (existing.length > 0) return { alreadyFollowing: true };

  await db.insert(followsTable).values({ followerId, followingId });
  await db.update(usersTable).set({ followingCount: sql`${usersTable.followingCount} + 1` }).where(eq(usersTable.id, followerId));
  await db.update(usersTable).set({ followersCount: sql`${usersTable.followersCount} + 1` }).where(eq(usersTable.id, followingId));

  return { success: true };
}

export async function unfollowUser(followerId: number, followingId: number) {
  await db
    .delete(followsTable)
    .where(and(eq(followsTable.followerId, followerId), eq(followsTable.followingId, followingId)));

  await db.update(usersTable).set({ followingCount: sql`GREATEST(0, ${usersTable.followingCount} - 1)` }).where(eq(usersTable.id, followerId));
  await db.update(usersTable).set({ followersCount: sql`GREATEST(0, ${usersTable.followersCount} - 1)` }).where(eq(usersTable.id, followingId));

  return { success: true };
}
