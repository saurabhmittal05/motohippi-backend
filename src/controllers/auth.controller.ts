import { Request, Response } from "express";
import * as authService from "../services/auth.service.js";
import { SignupBody, LoginBody } from "../lib/api-zod/index.js";
import { parseToken } from "../lib/auth.js";

export async function handleSignup(req: Request, res: Response) {
  try {
    const result = SignupBody.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: "Invalid input", details: result.error.flatten() });
      return;
    }
    const response = await authService.signupUser(result.data);
    res.status(200).json(response);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Registration failed" });
  }
}

export async function handleLogin(req: Request, res: Response) {
  try {
    const result = LoginBody.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const response = await authService.loginUser(result.data.email, result.data.password);
    res.status(200).json(response);
  } catch (err: any) {
    res.status(401).json({ error: err?.message || "Login failed" });
  }
}

export async function handleLogout(_req: Request, res: Response) {
  res.json({ message: "Logged out" });
}

export async function handleSendOtp(req: Request, res: Response) {
  try {
    const bodyEmail = req.body?.email as string | undefined;
    let targetEmail: string | null = bodyEmail ?? null;
    let userId: number | null = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const parsedId = parseToken(authHeader.slice(7));
      if (parsedId) userId = parsedId;
    }

    if (!targetEmail) {
      res.status(400).json({ error: "Email is required to send OTP" });
      return;
    }

    const pending = authService.pendingRegistrations.get(targetEmail);
    if (pending) {
      if (pending.expires - Date.now() > 9 * 60 * 1000) {
        res.json({ message: "OTP already sent recently" });
        return;
      }
      const code = authService.generateOtp();
      pending.code = code;
      pending.expires = Date.now() + 10 * 60 * 1000;
      authService.pendingRegistrations.set(targetEmail, pending);
      authService.sendOtpEmail(targetEmail, code).catch(() => {});
      res.json({ message: "OTP sent" });
      return;
    }

    const existingOtp = authService.otpStore.get(targetEmail);
    if (existingOtp && existingOtp.expires - Date.now() > 9 * 60 * 1000) {
      res.json({ message: "OTP already sent recently" });
      return;
    }

    const code = authService.generateOtp();
    if (userId) {
      authService.otpStore.set(targetEmail, {
        code,
        expires: Date.now() + 10 * 60 * 1000,
        userId,
      });
    }
    authService.sendOtpEmail(targetEmail, code).catch(() => {});
    res.json({ message: "OTP sent" });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to send OTP", message: err?.message });
  }
}

export async function handleVerifyOtp(req: Request, res: Response) {
  try {
    const { code, email: bodyEmail } = req.body;
    let userId: number | null = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const parsedId = parseToken(authHeader.slice(7));
      if (parsedId) userId = parsedId;
    }

    const result = await authService.verifyOtp(bodyEmail, userId, code);
    res.json({ message: "Email verified", ...result });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Verification failed" });
  }
}
