import { Request, Response } from "express";
import * as uploadService from "../services/upload.service.js";

export async function handleUpload(req: Request, res: Response) {
  try {
    const { image, file, folder } = req.body || {};
    const inputData = image || file;

    if (!inputData || typeof inputData !== "string") {
      res.status(400).json({ error: "Missing image or file string parameter" });
      return;
    }

    const result = await uploadService.uploadMedia(inputData, folder || "uploads");
    res.status(200).json(result);
  } catch (err: any) {
    console.error("❌ Upload controller error:", err);
    res.status(500).json({ error: "Failed to upload image to S3", message: err?.message });
  }
}
