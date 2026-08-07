import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

const region = process.env.AWS_REGION || "ap-south-1";
const bucketName = process.env.AWS_S3_BUCKET_NAME || "motohippi";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

let s3Client: S3Client | null = null;

if (accessKeyId && secretAccessKey) {
  s3Client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * Uploads an image (Base64 data string or buffer) to AWS S3 and returns the public HTTPS URL.
 */
export async function uploadImageToS3(
  inputData: string,
  folder: string = "uploads"
): Promise<string> {
  // If input is already an external HTTPS/HTTP URL, return as-is
  if (inputData.startsWith("http://") || inputData.startsWith("https://")) {
    return inputData;
  }

  if (!s3Client) {
    console.warn("⚠️ AWS S3 credentials missing. Returning original input.");
    return inputData;
  }

  try {
    let buffer: Buffer;
    let contentType = "image/jpeg";
    let extension = "jpg";

    if (inputData.startsWith("data:")) {
      const matches = inputData.match(/^data:([a-zA-Z0-9-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        contentType = matches[1];
        const base64Data = matches[2];
        buffer = Buffer.from(base64Data, "base64");
        if (contentType.includes("png")) extension = "png";
        else if (contentType.includes("webp")) extension = "webp";
        else if (contentType.includes("gif")) extension = "gif";
      } else {
        buffer = Buffer.from(inputData, "base64");
      }
    } else {
      buffer = Buffer.from(inputData, "base64");
    }

    const filename = `${folder}/${Date.now()}_${crypto.randomBytes(8).toString("hex")}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: filename,
      Body: buffer,
      ContentType: contentType,
    });

    await s3Client.send(command);

    return `https://${bucketName}.s3.${region}.amazonaws.com/${filename}`;
  } catch (err) {
    console.error("❌ AWS S3 Upload Error:", err);
    throw err;
  }
}
