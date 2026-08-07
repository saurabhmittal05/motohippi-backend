import { Request, Response } from "express";
import * as userService from "../services/user.service.js";
import { UpdateMyProfileBody } from "../lib/api-zod/index.js";

export async function getMyProfile(req: Request, res: Response) {
  try {
    const userId = (req as any).userId as number;
    const profile = await userService.getProfileById(userId);
    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch profile", message: err?.message });
  }
}

export async function updateMyProfile(req: Request, res: Response) {
  try {
    const userId = (req as any).userId as number;
    const result = UpdateMyProfileBody.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: "Invalid input", details: result.error.flatten() });
      return;
    }
    const updated = await userService.updateProfile(userId, result.data);
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update profile", message: err?.message });
  }
}

export async function getUserProfile(req: Request, res: Response) {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }
    const profile = await userService.getProfileById(targetId);
    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch profile", message: err?.message });
  }
}

export async function searchRiders(req: Request, res: Response) {
  try {
    const userId = (req as any).userId as number;
    const query = (req.query.q as string) || "";
    const users = await userService.searchUsers(query, userId);
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: "Search failed", message: err?.message });
  }
}

export async function followUser(req: Request, res: Response) {
  try {
    const followerId = (req as any).userId as number;
    const followingId = parseInt(req.params.id, 10);
    if (isNaN(followingId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }
    const result = await userService.followUser(followerId, followingId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Failed to follow user" });
  }
}

export async function unfollowUser(req: Request, res: Response) {
  try {
    const followerId = (req as any).userId as number;
    const followingId = parseInt(req.params.id, 10);
    if (isNaN(followingId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }
    const result = await userService.unfollowUser(followerId, followingId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Failed to unfollow user" });
  }
}
