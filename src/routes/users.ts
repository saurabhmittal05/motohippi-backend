import { Router } from "express";
import { authMiddleware } from "../lib/auth.js";
import * as userController from "../controllers/user.controller.js";

const router = Router();

router.get("/users/me", authMiddleware, userController.getMyProfile);
router.patch("/users/me", authMiddleware, userController.updateMyProfile);
router.get("/users/search", authMiddleware, userController.searchRiders);
router.get("/users/:id", authMiddleware, userController.getUserProfile);
router.post("/users/:id/follow", authMiddleware, userController.followUser);
router.post("/users/:id/unfollow", authMiddleware, userController.unfollowUser);

export default router;
