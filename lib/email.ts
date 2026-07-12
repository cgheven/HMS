import "server-only";
import { Resend } from "resend";
import { pktTodayDateString } from "@/lib/pkt-time";

const resend = new Resend(process.env.RESEND_API_KEY);

// Verified sender — configure RESEND_FROM_EMAIL in env (must match a verified Resend domain)
const FROM = process.env.RESEND_FROM_EMAIL ?? "Pulse HMS <noreply@yourpulse.io>";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hms.yourpulse.io";

// Escape user-supplied content before embedding in HTML to prevent injection
function esc(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function baseHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#0f0f11;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e5e5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#18181b;border-radius:12px;border:1px solid #27272a;overflow:hidden;">
        <tr><td style="background:#1c1917;border-bottom:1px solid #27272a;padding:20px 28px;">
          <span style="font-size:18px;font-weight:700;color:#f59e0b;letter-spacing:-0.3px;">Pulse HMS</span>
        </td></tr>
        <tr><td style="padding:28px;">
          ${body}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #27272a;font-size:11px;color:#52525b;">
          This is an automated notification from Pulse HMS. Do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:#71717a;width:140px;vertical-align:top;">${esc(label)}</td>
    <td style="padding:6px 0;font-size:13px;color:#e5e5e5;font-weight:500;">${value}</td>
  </tr>`;
}

// ─── Application submitted (owner notification) ───────────────────────────────

interface ApplicationEmailData {
  ownerEmail: string;
  hostelName: string;
  applicantName: string;
  phone: string;
  email?: string | null;
  cnic?: string | null;
  packageTier: string;
  roomPreference?: string | null;
  moveInDate?: string | null;
  notes?: string | null;
}

const TIER_LABELS: Record<string, string> = {
  space_only: "Space Only",
  space_food: "Space + Breakfast & Dinner",
  space_food_ac: "Space + Food + AC",
  space_3meals: "Space + 3 Meals Daily",
  space_meals_cooler: "Space + Meals + Cooler",
};

export async function sendApplicationEmail(data: ApplicationEmailData): Promise<void> {
  const tierLabel = TIER_LABELS[data.packageTier] ?? data.packageTier;
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">New Application Received</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">A new tenant application was submitted for <strong style="color:#f59e0b;">${esc(data.hostelName)}</strong>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Name", esc(data.applicantName))}
      ${row("Phone", esc(data.phone))}
      ${data.email ? row("Email", esc(data.email)) : ""}
      ${data.cnic ? row("CNIC", esc(data.cnic)) : ""}
      ${row("Package", esc(tierLabel))}
      ${data.roomPreference ? row("Room Preference", esc(data.roomPreference)) : ""}
      ${data.moveInDate ? row("Move-in Date", esc(data.moveInDate)) : ""}
      ${data.notes ? row("Notes", esc(data.notes)) : ""}
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#71717a;">Log in to Pulse HMS to review and approve this application.</p>
  `;

  await resend.emails.send({
    from: FROM,
    to: data.ownerEmail,
    subject: `New application from ${data.applicantName} — ${data.hostelName}`,
    html: baseHtml("New Application", body),
  });
}

// ─── Waitlist joined (owner notification) ────────────────────────────────────

interface WaitlistEmailData {
  ownerEmail: string;
  hostelName: string;
  name: string;
  phone: string;
}

export async function sendWaitlistEmail(data: WaitlistEmailData): Promise<void> {
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">New Waitlist Signup</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">Someone joined the waitlist for <strong style="color:#f59e0b;">${esc(data.hostelName)}</strong>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Name", esc(data.name))}
      ${row("Phone", esc(data.phone))}
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#71717a;">Log in to Pulse HMS to view the full waitlist.</p>
  `;

  await resend.emails.send({
    from: FROM,
    to: data.ownerEmail,
    subject: `New waitlist signup — ${data.hostelName}`,
    html: baseHtml("Waitlist Signup", body),
  });
}

// ─── Lead follow-up digest (SuperAdmin notification) ──────────────────────────
// Sent daily by the /api/cron/lead-followups job and on-demand from the
// SuperAdmin leads page ("Send Follow-up Email").

interface LeadFollowUpDigestItem {
  business_name: string;
  owner_name: string;
  phone: string;
  next_follow_up_date: string | null;
  sales_rep?: { name: string } | null;
}

export async function sendLeadFollowUpDigest(
  recipientEmail: string,
  leads: LeadFollowUpDigestItem[]
): Promise<void> {
  const todayStr = pktTodayDateString();

  const rows = leads
    .map((l) => {
      // Three-state, not binary — a lead due later this week (e.g. sent via the
      // "Due This Week" filter) must never render as "today" or "overdue".
      const isOverdue = !!l.next_follow_up_date && l.next_follow_up_date < todayStr;
      const isDueToday = l.next_follow_up_date === todayStr;
      const suffix = isOverdue ? " · overdue" : isDueToday ? " · today" : "";
      const dateLabel = l.next_follow_up_date ? `${l.next_follow_up_date}${suffix}` : "—";
      const dateColor = isOverdue ? "#fb7185" : isDueToday ? "#f59e0b" : "#a1a1aa";
      return `<tr>
        <td style="padding:10px 0;border-top:1px solid #27272a;font-size:13px;color:#e5e5e5;vertical-align:top;">
          <div style="font-weight:600;">${esc(l.business_name)}</div>
          <div style="color:#a1a1aa;font-size:12px;margin-top:2px;">${esc(l.owner_name)} · ${esc(l.phone)}</div>
          ${l.sales_rep ? `<div style="color:#71717a;font-size:11px;margin-top:2px;">Rep: ${esc(l.sales_rep.name)}</div>` : ""}
        </td>
        <td style="padding:10px 0;border-top:1px solid #27272a;font-size:12px;font-weight:600;color:${dateColor};text-align:right;white-space:nowrap;vertical-align:top;">
          ${esc(dateLabel)}
        </td>
      </tr>`;
    })
    .join("");

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Daily Follow-up Digest</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#a1a1aa;">
      ${leads.length} lead${leads.length !== 1 ? "s" : ""} ${leads.length !== 1 ? "need" : "needs"} follow-up.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <p style="margin:24px 0 0;">
      <a href="${SITE_URL}/super-admin/leads" style="display:inline-block;background:#f59e0b;color:#0f0f11;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Open Leads Pipeline</a>
    </p>
  `;

  await resend.emails.send({
    from: FROM,
    to: recipientEmail,
    subject: `${leads.length} lead follow-up${leads.length !== 1 ? "s" : ""} pending`,
    html: baseHtml("Follow-up Digest", body),
  });
}
