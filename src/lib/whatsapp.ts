import { logger } from "./logger.js";

export interface InsuranceInquiryNotificationPayload {
  fullName: string;
  mobileNumber: string;
  email?: string | null;
  insuranceRequirement: string;
  manufacturer?: string | null;
  model?: string | null;
  yearOfPurchase?: string | null;
  kmsDriven?: string | null;
  city?: string | null;
  preferredTime?: string | null;
}

/**
 * Sends an instant WhatsApp lead notification using Meta Cloud API template `insurance_lead_alert`.
 */
export async function sendWhatsAppInquiryNotification(
  inquiry: InsuranceInquiryNotificationPayload
): Promise<{ success: boolean; data?: any; error?: string }> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "1285608071304631";
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const recipientNumber = process.env.WHATSAPP_RECIPIENT_NUMBER || "918700567381";

  if (!accessToken) {
    logger.warn("⚠️ WHATSAPP_ACCESS_TOKEN is not configured in .env. Skipping WhatsApp notification.");
    return { success: false, error: "WHATSAPP_ACCESS_TOKEN missing" };
  }

  const payload = {
    messaging_product: "whatsapp",
    to: recipientNumber,
    type: "template",
    template: {
      name: "insurance_lead_alert",
      language: {
        code: "en",
      },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: inquiry.fullName || "N/A" },
            { type: "text", text: inquiry.mobileNumber || "N/A" },
            { type: "text", text: inquiry.email || "N/A" },
            { type: "text", text: inquiry.insuranceRequirement || "N/A" },
            { type: "text", text: inquiry.manufacturer || "N/A" },
            { type: "text", text: inquiry.model || "N/A" },
            { type: "text", text: inquiry.yearOfPurchase || "N/A" },
            { type: "text", text: inquiry.kmsDriven || "N/A" },
            { type: "text", text: inquiry.city || "N/A" },
            { type: "text", text: inquiry.preferredTime || "Anytime" },
          ],
        },
      ],
    },
  };

  try {
    const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      logger.error({ status: res.status, data }, "❌ Meta WhatsApp API request failed");
      return { success: false, error: data?.error?.message || "WhatsApp API failed" };
    }

    logger.info(
      { recipientNumber, messageId: data?.messages?.[0]?.id },
      "📱 WhatsApp notification dispatched successfully via Meta Cloud API!"
    );
    return { success: true, data };
  } catch (err: any) {
    logger.error({ err }, "❌ Exception occurred while calling Meta WhatsApp Cloud API");
    return { success: false, error: err?.message || String(err) };
  }
}
