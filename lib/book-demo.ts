import "server-only";

// Shared core for public "Book a Demo" lead capture — used by BOTH the in-app
// server action (app/actions/book-demo.ts, same-origin form) and the public HTTP
// API (app/api/book-demo/route.ts, for the yourpulse.io marketing site).
//
// Security recipe mirrors app/actions/signup.ts requestSignup: honeypot, per-IP +
// per-phone rate limiting via the shared hms_auth_rate_hit RPC, disposable-email
// rejection, strict validation + length caps, IP capture, service-role write.

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_RE, PHONE_RE } from "@/lib/validation";
import { normalizeEmail, isDisposableEmailDomain } from "@/lib/email-normalize";
import { isSupportedCountry, DEFAULT_COUNTRY } from "@/lib/country-config";
import { DEMO_LEAD_SOURCE } from "@/lib/lead-sources";
import { sendDemoRequestNotification } from "@/lib/email";

const IP_HOURLY_LIMIT = 10; // demo requests per IP per hour
const PHONE_HOURLY_LIMIT = 3; // per phone per hour (dedupe rapid resubmits)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // 24h HH:MM

export interface BookDemoInput {
  contactName?: string;
  businessName?: string;
  phone?: string;
  email?: string;
  city?: string;
  propertyCount?: string | number;
  preferredDate?: string;
  preferredTime?: string;
  timezone?: string;
  message?: string;
  // Honeypot — real users leave it empty. Deliberately NOT named website/url.
  contactRef2?: string;
}

export type BookDemoResult = { success?: boolean; error?: string };

function cap(value: unknown, max: number): string {
  return (typeof value === "string" ? value : value == null ? "" : String(value)).trim().slice(0, max);
}

async function requestContext(): Promise<{ ip: string; country: string }> {
  try {
    const h = await headers();
    const ip =
      h.get("x-vercel-forwarded-for") ||
      h.get("x-real-ip") ||
      h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
      "unknown";
    const geo = (h.get("x-vercel-ip-country") || "").toUpperCase();
    const country = isSupportedCountry(geo) ? geo : DEFAULT_COUNTRY;
    return { ip, country };
  } catch {
    return { ip: "unknown", country: DEFAULT_COUNTRY };
  }
}

export async function processBookDemo(input: BookDemoInput): Promise<BookDemoResult> {
  // Honeypot tripped → look successful, save nothing.
  if (input?.contactRef2) return { success: true };

  const contactName = cap(input?.contactName, 100);
  const businessName = cap(input?.businessName, 150);
  const phoneDigits = cap(input?.phone, 32).replace(/\D/g, "");
  const city = cap(input?.city, 100) || null;
  const emailRaw = cap(input?.email, 254).toLowerCase();

  // Number of properties → CRM branch_count (integer, clamped). Blank/invalid = 1.
  const branchCount = Math.min(999, Math.max(1, Math.floor(Number(input?.propertyCount)) || 1));

  // Preferred slot: ISO date (not past) + exact 24h time in the visitor's IANA
  // zone — surfaced in notes + email with the zone spelled out.
  const preferredDate = DATE_RE.test(cap(input?.preferredDate, 10)) ? cap(input?.preferredDate, 10) : "";
  const validDate = preferredDate && preferredDate >= new Date().toISOString().slice(0, 10) ? preferredDate : "";
  const preferredTime = TIME_RE.test(cap(input?.preferredTime, 5)) ? cap(input?.preferredTime, 5) : "";
  const timezone = cap(input?.timezone, 64).replace(/[^A-Za-z0-9_+/-]/g, "");
  const whenParts: string[] = [];
  if (validDate) whenParts.push(validDate);
  if (preferredTime) whenParts.push(`at ${preferredTime}`);
  let availability = whenParts.join(" ");
  if (availability && timezone) availability += ` (${timezone})`;

  const rawMessage = cap(input?.message, 1000);
  const notes = [availability ? `Preferred demo time: ${availability}` : "", rawMessage].filter(Boolean).join("\n\n") || null;
  const message = rawMessage || null;

  // Required fields + format (helpful errors for real users).
  if (!contactName) return { error: "Please enter your name." };
  if (!businessName) return { error: "Please enter your business name." };
  if (!PHONE_RE.test(phoneDigits)) return { error: "Please enter a valid phone number." };
  if (emailRaw && !EMAIL_RE.test(emailRaw)) return { error: "Please enter a valid email address, or leave it blank." };

  // Disposable email → look successful, save nothing.
  if (emailRaw && isDisposableEmailDomain(emailRaw)) return { success: true };
  const email = emailRaw ? normalizeEmail(emailRaw) : null;

  try {
    const admin = createAdminClient();
    const { ip, country } = await requestContext();

    // Per-IP ceiling first, unconditionally — fails closed.
    const { data: ipOk, error: ipErr } = await admin.rpc("hms_auth_rate_hit", {
      p_bucket: `demo:ip:${ip}`,
      p_limit: IP_HOURLY_LIMIT,
    });
    if (ipErr || ipOk === false) return { error: "Too many requests right now. Please try again in a little while." };

    // Per-phone ceiling — a rapid resubmit looks successful but isn't re-saved.
    const { data: phoneOk } = await admin.rpc("hms_auth_rate_hit", {
      p_bucket: `demo:phone:${phoneDigits}`,
      p_limit: PHONE_HOURLY_LIMIT,
    });
    if (phoneOk === false) return { success: true };

    const { error: insErr } = await admin.from("hms_platform_leads").insert({
      business_name: businessName,
      owner_name: contactName,
      phone: phoneDigits,
      email,
      city,
      branch_count: branchCount,
      notes,
      source: DEMO_LEAD_SOURCE,
      status: "new",
      ip_address: ip === "unknown" ? null : ip,
    });
    if (insErr) {
      console.error("[book-demo] lead insert failed:", insErr.message);
      return { error: "Something went wrong. Please try again." };
    }

    await sendDemoRequestNotification({ contactName, businessName, phone: phoneDigits, email, city, message, country, propertyCount: branchCount, availability: availability || null });

    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[book-demo] processBookDemo failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
}
