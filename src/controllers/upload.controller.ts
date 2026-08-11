import { Request, Response } from "express";
import * as uploadService from "../services/upload.service.js";

const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB limit

export async function handleUpload(req: Request, res: Response) {
  try {
    const { image, file, folder } = req.body || {};
    const inputData = image || file;

    if (!inputData || typeof inputData !== "string") {
      res.status(400).json({ error: "Missing image or file string parameter" });
      return;
    }

    // Estimate binary size from base64 string
    const base64Data = inputData.includes(",") ? inputData.split(",")[1] : inputData;
    const estimatedSizeBytes = (base64Data.length * 3) / 4;

    if (estimatedSizeBytes > MAX_FILE_SIZE_BYTES) {
      res.status(400).json({
        error: "File size exceeds 3 MB limit",
        message: `The uploaded image is ${(estimatedSizeBytes / (1024 * 1024)).toFixed(1)} MB. Maximum allowed size is 3 MB.`,
      });
      return;
    }

    const result = await uploadService.uploadMedia(inputData, folder || "uploads");
    res.status(200).json(result);
  } catch (err: any) {
    console.error("❌ Upload controller error:", err);
    res.status(500).json({ error: "Failed to upload image to S3", message: err?.message });
  }
}
