import { Request, Response } from "express";
import * as matchService from "../services/match.service.js";

export async function getPendingRequests(req: Request, res: Response) {
  try {
    const userId = (req as any).userId as number;
    const requests = await matchService.getPendingRequestsForUser(userId);
    res.json(requests);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch pending requests", message: err?.message });
  }
}

export async function acceptRequest(req: Request, res: Response) {
  try {
    const userId = (req as any).userId as number;
    const matchId = parseInt(req.params.id, 10);
    if (isNaN(matchId)) {
      res.status(400).json({ error: "Invalid match ID" });
      return;
    }

    const result = await matchService.acceptMatchRequest(userId, matchId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Failed to accept match request" });
  }
}

export async function declineRequest(req: Request, res: Response) {
  try {
    const userId = (req as any).userId as number;
    const matchId = parseInt(req.params.id, 10);
    if (isNaN(matchId)) {
      res.status(400).json({ error: "Invalid match ID" });
      return;
    }

    const result = await matchService.declineMatchRequest(userId, matchId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Failed to decline match request" });
  }
}
