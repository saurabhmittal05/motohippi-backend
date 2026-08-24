import { Router, Request, Response } from "express";
import { authMiddleware } from "../lib/auth.js";
import { db, usersTable, paymentsTable } from "../lib/db/index.js";
import { eq, and } from "drizzle-orm";
import {
  createCashfreeOrder,
  getCashfreeOrder,
  verifyCashfreeWebhookSignature,
} from "../services/cashfree.service.js";

const router = Router();

export const PLANS: Record<string, { id: string; name: string; amount: number; durationDays: number; desc: string; perks: string[] }> = {
  free: {
    id: "free",
    name: "Free",
    amount: 0,
    durationDays: 30,
    desc: "Essential features for casual riders & travelers",
    perks: ["25 swipes/day", "Basic Matching", "Chat after Match"],
  },
  plus: {
    id: "plus",
    name: "Plus",
    amount: 299,
    durationDays: 30,
    desc: "Unlimited swipes & ad-free experience",
    perks: ["Unlimited Swipes", "Undo Swipe", "No Ads"],
  },
  gold: {
    id: "gold",
    name: "Gold",
    amount: 599,
    durationDays: 30,
    desc: "See who likes you & gold verified badge",
    perks: ["Everything in Plus", "See Who Likes You", "Verified Badge"],
  },
  platinum: {
    id: "platinum",
    name: "Platinum",
    amount: 999,
    durationDays: 30,
    desc: "VIP access & 24/7 priority support",
    perks: ["Everything in Gold", "VIP Support"],
  },
};

// 1. GET /api/payments/plans — List available membership plans
router.get("/payments/plans", (_req: Request, res: Response) => {
  res.json({
    plans: Object.values(PLANS),
  });
});

// 2. POST /api/payments/create-order — Create Cashfree Order for Plan
router.post("/payments/create-order", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as number;
    const { planId } = req.body;

    if (!planId || !PLANS[planId]) {
      res.status(400).json({ error: "Invalid planId selected" });
      return;
    }

    const selectedPlan = PLANS[planId];
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const timestamp = Date.now();
    const orderId = `order_mh_${timestamp}_usr${userId}`;
    const frontendBase = process.env.VITE_FRONTEND_URL || req.headers.origin || "https://www.motohippi.com";
    const returnUrl = `${frontendBase}/payment-status?order_id={order_id}`;
    const notifyUrl = process.env.CASHFREE_NOTIFY_URL || `${req.protocol}://${req.get("host")}/api/payments/webhook`;

    // Call Cashfree PG API
    const cfOrder = await createCashfreeOrder({
      orderId,
      orderAmount: selectedPlan.amount,
      orderCurrency: "INR",
      customerId: `usr_${userId}`,
      customerName: user.name,
      customerEmail: user.email,
      customerPhone: user.phone || "9999207570",
      returnUrl,
      notifyUrl,
    });

    // Save pending transaction in database
    await db.insert(paymentsTable).values({
      userId,
      orderId,
      cfOrderId: cfOrder.cf_order_id,
      planId: selectedPlan.id,
      amount: selectedPlan.amount,
      currency: "INR",
      status: "PENDING",
    });

    res.json({
      success: true,
      orderId,
      paymentSessionId: cfOrder.payment_session_id,
      amount: selectedPlan.amount,
      planName: selectedPlan.name,
    });
  } catch (err: any) {
    console.error("Create order failed:", err);
    res.status(500).json({ error: "Failed to create payment order", message: err?.message });
  }
});

// Helper function to upgrade user plan upon successful payment
async function completeUserPayment(orderId: string, cfData?: any) {
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.orderId, orderId)).limit(1);
  if (!payment) return null;

  if (payment.status !== "PAID") {
    const selectedPlan = PLANS[payment.planId];
    const durationDays = selectedPlan?.durationDays || 30;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    // Update payment record to PAID
    await db
      .update(paymentsTable)
      .set({
        status: "PAID",
        cfPaymentId: cfData?.payment_id || cfData?.cf_payment_id || payment.cfPaymentId,
        paymentMode: cfData?.payment_group || cfData?.payment_method || payment.paymentMode,
        rawWebhookData: cfData || payment.rawWebhookData,
        updatedAt: new Date(),
      })
      .where(eq(paymentsTable.id, payment.id));

    // Update user plan & planExpiresAt
    await db
      .update(usersTable)
      .set({
        plan: payment.planId,
        planExpiresAt: expiresAt,
        isVerified: true, // Automatically grant verified rider status for paid plans!
      })
      .where(eq(usersTable.id, payment.userId));
  }

  return payment;
}

// 3. GET /api/payments/verify/:orderId — Verify payment status
router.get("/payments/verify/:orderId", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const userId = (req as any).userId as number;

    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.orderId, orderId)).limit(1);
    if (!payment) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (payment.userId !== userId) {
      res.status(403).json({ error: "Unauthorized access to order" });
      return;
    }

    // Check live status from Cashfree
    let cfOrder: any = null;
    try {
      cfOrder = await getCashfreeOrder(orderId);
    } catch (cfErr) {
      console.warn("Could not fetch Cashfree status directly, relying on DB status:", cfErr);
    }

    if (cfOrder && cfOrder.order_status === "PAID") {
      await completeUserPayment(orderId, cfOrder);
    }

    // Fetch updated payment and user profile
    const [updatedPayment] = await db.select().from(paymentsTable).where(eq(paymentsTable.orderId, orderId)).limit(1);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    res.json({
      orderId: updatedPayment.orderId,
      status: updatedPayment.status,
      planId: updatedPayment.planId,
      amount: updatedPayment.amount,
      userPlan: user?.plan || "free",
      planExpiresAt: user?.planExpiresAt,
      isVerified: user?.isVerified,
    });
  } catch (err: any) {
    console.error("Verify payment error:", err);
    res.status(500).json({ error: "Failed to verify payment", message: err?.message });
  }
});

// 4. POST /api/payments/webhook — Cashfree Webhook Handler
router.post("/payments/webhook", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-webhook-signature"] as string;
    const timestamp = req.headers["x-webhook-timestamp"] as string;
    const rawBody = JSON.stringify(req.body);

    const isValid = verifyCashfreeWebhookSignature(rawBody, timestamp, signature);
    if (!isValid && process.env.NODE_ENV === "production") {
      console.error("Invalid Cashfree webhook signature");
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    const payload = req.body;
    const eventType = payload?.type;
    const orderData = payload?.data?.order;
    const paymentData = payload?.data?.payment;

    console.log(`Cashfree Webhook received: ${eventType}`, orderData?.order_id);

    if (eventType === "PAYMENT_SUCCESS_WEBHOOK" || paymentData?.payment_status === "SUCCESS") {
      const orderId = orderData?.order_id;
      if (orderId) {
        await completeUserPayment(orderId, paymentData);
      }
    }

    res.json({ status: "OK" });
  } catch (err: any) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Webhook error" });
  }
});

export default router;
