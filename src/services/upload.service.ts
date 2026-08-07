import { uploadImageToS3 } from "./s3.service.js";

export async function uploadMedia(dataStringOrBuffer: string, folder: string = "uploads") {
  const s3Url = await uploadImageToS3(dataStringOrBuffer, folder);
  return { url: s3Url };
}
