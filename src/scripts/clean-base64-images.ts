import { db, usersTable } from "../lib/db/index.js";
import { uploadImageToS3 } from "../services/s3.service.js";
import { like, or, eq } from "drizzle-orm";

async function cleanBase64Images() {
  console.log("🔍 Scanning for base64 image strings in database...");

  const usersWithBase64 = await db
    .select()
    .from(usersTable)
    .where(
      or(
        like(usersTable.avatarUrl, "data:%"),
        like(usersTable.coverUrl, "data:%")
      )
    );

  console.log(`Found ${usersWithBase64.length} users with base64 images.`);

  for (const user of usersWithBase64) {
    console.log(`Processing user ID ${user.id} (${user.name})...`);
    let newAvatarUrl = user.avatarUrl;
    let newCoverUrl = user.coverUrl;

    if (user.avatarUrl && user.avatarUrl.startsWith("data:")) {
      try {
        newAvatarUrl = await uploadImageToS3(user.avatarUrl, "avatars");
        console.log(`  ✅ Avatar uploaded to S3: ${newAvatarUrl}`);
      } catch (err) {
        console.error(`  ❌ Failed to upload avatar for user ${user.id}:`, err);
      }
    }

    if (user.coverUrl && user.coverUrl.startsWith("data:")) {
      try {
        newCoverUrl = await uploadImageToS3(user.coverUrl, "covers");
        console.log(`  ✅ Cover uploaded to S3: ${newCoverUrl}`);
      } catch (err) {
        console.error(`  ❌ Failed to upload cover for user ${user.id}:`, err);
      }
    }

    await db
      .update(usersTable)
      .set({
        avatarUrl: newAvatarUrl,
        coverUrl: newCoverUrl,
      })
      .where(eq(usersTable.id, user.id));
  }

  console.log("✨ All base64 images converted to clean S3 URLs!");
  process.exit(0);
}

cleanBase64Images().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
