import { Router } from "express";
import { authMiddleware } from "../lib/auth.js";
import { handleUpload } from "../controllers/upload.controller.js";

const router = Router();

router.post("/upload", authMiddleware, handleUpload);

export default router;
