import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { logger } from "./logger.js";

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  templateName?: string; // e.g. "otp-verification" or "welcome"
  templatePath?: string; // optional absolute or relative path to a custom .html file
  variables?: Record<string, string | number | boolean>;
  html?: string; // fallback raw HTML content
  text?: string; // optional plain text body
  from?: string;
}

let transporterInstance: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  if (!transporterInstance) {
    transporterInstance = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  return transporterInstance;
}

/**
 * Resolves the absolute path to an HTML template file.
 */
async function resolveTemplatePath(templateNameOrPath: string): Promise<string | null> {
  if (path.isAbsolute(templateNameOrPath)) {
    try {
      await fs.access(templateNameOrPath);
      return templateNameOrPath;
    } catch {
      return null;
    }
  }

  const fileName = templateNameOrPath.endsWith(".html")
    ? templateNameOrPath
    : `${templateNameOrPath}.html`;

  const cwd = process.cwd();
  const candidatePaths = [
    path.join(cwd, "src", "templates", "emails", fileName),
    path.join(cwd, "dist", "templates", "emails", fileName),
    path.join(cwd, "templates", "emails", fileName),
    path.resolve(templateNameOrPath),
  ];

  for (const candidate of candidatePaths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue checking next candidate
    }
  }

  return null;
}

/**
 * Reads an HTML template file and replaces {{key}} variables.
 */
export async function renderEmailTemplate(
  templateNameOrPath: string,
  variables: Record<string, string | number | boolean> = {}
): Promise<string> {
  const filePath = await resolveTemplatePath(templateNameOrPath);
  if (!filePath) {
    throw new Error(`Email template not found: "${templateNameOrPath}"`);
  }

  let htmlContent = await fs.readFile(filePath, "utf-8");

  const defaultVars: Record<string, string | number | boolean> = {
    appName: "MotoHippi",
    currentYear: new Date().getFullYear(),
    ...variables,
  };

  for (const [key, value] of Object.entries(defaultVars)) {
    const placeholderRegex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    htmlContent = htmlContent.replace(placeholderRegex, String(value));
  }

  return htmlContent;
}

/**
 * Generic sendMail utility function.
 */
export async function sendMail(options: SendMailOptions): Promise<{ success: boolean; messageId?: string }> {
  const { to, subject, templateName, templatePath, variables = {}, html, text, from } = options;

  const defaultFromUser = process.env.FROM_EMAIL ?? process.env.SMTP_USER ?? "noreply@motohippi.com";
  const fromAddress = from ?? `MotoHippi <${defaultFromUser}>`;

  let finalHtml = html ?? "";

  // If a template is specified, render it
  const targetTemplate = templatePath || templateName;
  if (targetTemplate) {
    try {
      const mergedVars = { title: subject, ...variables };
      finalHtml = await renderEmailTemplate(targetTemplate, mergedVars);
    } catch (err: any) {
      logger.error({ err, targetTemplate }, "Failed to render email template");
      if (!html) {
        throw err;
      }
    }
  }

  const transporter = getTransporter();

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: Array.isArray(to) ? to.join(", ") : to,
        subject,
        html: finalHtml,
        text,
      });

      logger.info({ messageId: info.messageId, to, subject }, "📧 Email sent successfully via Nodemailer");
      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      logger.error({ err, to, subject }, "❌ Nodemailer sendMail failed");
    }
  }

  // Fallback: console output when SMTP is not configured or fails
  const recipient = Array.isArray(to) ? to.join(", ") : to;
  logger.warn(
    `\n🔑 [EMAIL FALLBACK] To: ${recipient} | Subject: "${subject}"` +
    (variables.code ? ` | Code: ${variables.code}` : "") +
    `\n`
  );

  return { success: false };
}
