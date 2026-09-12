import { Router } from "express";
import { db } from "../lib/db/index.js";
import { insurancePlansTable, insurancePoliciesTable, insuranceInquiriesTable } from "../lib/db/index.js";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../lib/auth.js";
import { PurchaseInsuranceBody } from "../lib/api-zod/index.js";
import { sendMail } from "../lib/email.js";
import { sendWhatsAppInquiryNotification } from "../lib/whatsapp.js";
import crypto from "crypto";

const router = Router();

function formatPlan(p: typeof insurancePlansTable.$inferSelect) {
  return {
    id: p.id, name: p.name, type: p.type, provider: p.provider,
    premium: parseFloat(p.premium),
    coverage: p.coverage ? parseFloat(p.coverage) : null,
    features: (p.features as string[]) || [],
    duration: p.duration, rating: p.rating ? parseFloat(p.rating) : null,
  };
}

router.get("/insurance/plans", authMiddleware, async (req, res) => {
  const type = req.query.type as string;
  const plans = type
    ? await db.select().from(insurancePlansTable).where(eq(insurancePlansTable.type, type)).limit(50)
    : await db.select().from(insurancePlansTable).limit(50);
  res.json(plans.map(formatPlan));
});

router.get("/insurance/policies", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const policies = await db.select().from(insurancePoliciesTable).where(eq(insurancePoliciesTable.userId, userId));
  res.json(policies.map(p => ({
    id: p.id, planName: p.planName, type: p.type, status: p.status,
    policyNumber: p.policyNumber, premium: parseFloat(p.premium),
    coverage: p.coverage ? parseFloat(p.coverage) : null,
    provider: p.provider,
    startedAt: p.startedAt.toISOString(), expiresAt: p.expiresAt.toISOString(),
  })));
});

router.post("/insurance/policies", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const result = PurchaseInsuranceBody.safeParse(req.body);
  if (!result.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { planId } = result.data;
  const [plan] = await db.select().from(insurancePlansTable).where(eq(insurancePlansTable.id, planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  const [policy] = await db.insert(insurancePoliciesTable).values({
    userId, planId, planName: plan.name, type: plan.type,
    policyNumber: `MH${Date.now()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    premium: plan.premium, coverage: plan.coverage, provider: plan.provider, expiresAt,
  }).returning();
  if (!policy) { res.status(500).json({ error: "Failed to create policy" }); return; }
  res.status(201).json({
    id: policy.id, planName: policy.planName, type: policy.type, status: policy.status,
    policyNumber: policy.policyNumber, premium: parseFloat(policy.premium),
    coverage: policy.coverage ? parseFloat(policy.coverage) : null,
    provider: policy.provider,
    startedAt: policy.startedAt.toISOString(), expiresAt: policy.expiresAt.toISOString(),
  });
});

// ── Public Insurance Inquiry Submission ──────────────────────────────────────
router.post("/insurance/inquiry", async (req, res) => {
  try {
    const {
      vehicleCategory,
      insuranceRequirement,
      manufacturer,
      model,
      yearOfPurchase,
      kmsDriven,
      city,
      fullName,
      mobileNumber,
      email,
      preferredTime,
    } = req.body || {};

    if (!fullName || !mobileNumber) {
      res.status(400).json({ error: "Full Name and Mobile Number are required." });
      return;
    }

    const [inquiry] = await db
      .insert(insuranceInquiriesTable)
      .values({
        vehicleCategory: vehicleCategory || "car",
        insuranceRequirement: insuranceRequirement || "New Insurance",
        manufacturer: manufacturer || null,
        model: model || null,
        yearOfPurchase: yearOfPurchase || null,
        kmsDriven: kmsDriven || null,
        city: city || null,
        fullName,
        mobileNumber,
        email: email || null,
        preferredTime: preferredTime || null,
      })
      .returning();

    // Send email notification to admin email configured in environment
    const adminEmail = process.env.INSURANCE_ADMIN_EMAIL || "rinkusingh805764@gmail.com";
    const subject = `🚗 New Insurance Lead: ${fullName} (${vehicleCategory === "bike" ? "Bike" : "Car"})`;

    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <div style="background-color: #070A0F; padding: 24px; text-align: center; border-bottom: 3px solid #10B981;">
          <h1 style="color: #ffffff; margin: 0; font-size: 22px; text-transform: uppercase; letter-spacing: 1px;">MotoHippi Insurance Request</h1>
          <p style="color: #10B981; margin: 6px 0 0 0; font-size: 14px; font-weight: 600;">New Customer Lead Submitted</p>
        </div>
        <div style="padding: 24px; color: #334155; line-height: 1.6;">
          <h3 style="color: #0f172a; margin-top: 0; font-size: 18px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px;">Customer Information</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <tr><td style="padding: 8px 12px; font-weight: 600; color: #64748b; width: 40%;">Full Name</td><td style="padding: 8px 12px; color: #0f172a; font-weight: 600;">${fullName}</td></tr>
            <tr style="background-color: #f8fafc;"><td style="padding: 8px 12px; font-weight: 600; color: #64748b;">Mobile Number</td><td style="padding: 8px 12px; color: #0f172a; font-weight: 700;"><a href="tel:${mobileNumber}" style="color: #10B981; text-decoration: none;">${mobileNumber}</a></td></tr>
            <tr><td style="padding: 8px 12px; font-weight: 600; color: #64748b;">Email Address</td><td style="padding: 8px 12px; color: #0f172a;">${email || "Not Provided"}</td></tr>
            <tr style="background-color: #f8fafc;"><td style="padding: 8px 12px; font-weight: 600; color: #64748b;">Preferred Call Time</td><td style="padding: 8px 12px; color: #0f172a;">${preferredTime || "Anytime"}</td></tr>
            <tr><td style="padding: 8px 12px; font-weight: 600; color: #64748b;">City</td><td style="padding: 8px 12px; color: #0f172a;">${city || "Not Specified"}</td></tr>
          </table>

          <h3 style="color: #0f172a; margin-top: 0; font-size: 18px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px;">Vehicle & Plan Requirements</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 12px; font-weight: 600; color: #64748b; width: 40%;">Vehicle Category</td><td style="padding: 8px 12px; color: #0f172a; text-transform: capitalize; font-weight: 600;">${vehicleCategory === "bike" ? "🏍️ Two-Wheeler / Bike" : "🚘 Car"}</td></tr>
            <tr style="background-color: #f8fafc;"><td style="padding: 8px 12px; font-weight: 600; color: #64748b;">Insurance Type</td><td style="padding: 8px 12px; color: #0f172a;">${insuranceRequirement}</td></tr>
            <tr><td style="padding: 8px 12px; font-weight: 600; color: #64748b;">Manufacturer</td><td style="padding: 8px 12px; color: #0f172a;">${manufacturer || "Not Selected"}</td></tr>
            <tr style="background-color: #f8fafc;"><td style="padding: 8px 12px; font-weight: 600; color: #64748b;">Model</td><td style="padding: 8px 12px; color: #0f172a;">${model || "Not Selected"}</td></tr>
            <tr><td style="padding: 8px 12px; font-weight: 600; color: #64748b;">Year of Purchase</td><td style="padding: 8px 12px; color: #0f172a;">${yearOfPurchase || "Not Selected"}</td></tr>
            <tr style="background-color: #f8fafc;"><td style="padding: 8px 12px; font-weight: 600; color: #64748b;">Kilometers Driven</td><td style="padding: 8px 12px; color: #0f172a;">${kmsDriven || "Not Selected"}</td></tr>
          </table>
        </div>
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; color: #64748b; font-size: 12px;">
          Received at ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST • Inquiry ID #${inquiry?.id || "N/A"}
        </div>
      </div>
    `;

    // Asynchronously send email without blocking quick HTTP response
    sendMail({
      to: adminEmail,
      subject,
      html,
    }).catch((mailErr) => {
      console.error("⚠️ Error sending insurance inquiry notification email:", mailErr);
    });

    // Asynchronously dispatch WhatsApp Cloud API lead notification
    sendWhatsAppInquiryNotification({
      fullName,
      mobileNumber,
      email: email || null,
      insuranceRequirement: insuranceRequirement || "New Insurance",
      manufacturer: manufacturer || null,
      model: model || null,
      yearOfPurchase: yearOfPurchase || null,
      kmsDriven: kmsDriven || null,
      city: city || null,
      preferredTime: preferredTime || null,
    }).catch((waErr) => {
      console.error("⚠️ Error sending WhatsApp inquiry notification:", waErr);
    });

    res.status(201).json({
      success: true,
      message: "Insurance inquiry submitted successfully",
      inquiryId: inquiry?.id,
    });
  } catch (err: any) {
    console.error("❌ Insurance inquiry submission failed:", err);
    res.status(500).json({ error: "Failed to submit insurance inquiry", message: err?.message || String(err) });
  }
});

export default router;

