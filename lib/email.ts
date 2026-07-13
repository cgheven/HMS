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

// ─── Lead follow-up digest (SuperAdmin + sales rep notification) ──────────────
// Sent daily by the /api/cron/lead-followups job and on-demand from the
// SuperAdmin leads page ("Send Follow-up Email"). Routing (who gets which leads,
// and who gets CC'd) lives in sendGroupedFollowUpDigests below — this function
// only renders and sends a single email to a single recipient.

interface LeadFollowUpDigestItem {
  business_name: string;
  owner_name: string;
  phone: string;
  next_follow_up_date: string | null;
  sales_rep?: { name: string } | null;
}

export async function sendLeadFollowUpDigest(
  recipientEmail: string,
  leads: LeadFollowUpDigestItem[],
  options?: { cc?: string; greetingName?: string }
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

  const greeting = options?.greetingName ? `Hi ${esc(options.greetingName)}, ` : "";

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Daily Follow-up Digest</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#a1a1aa;">
      ${greeting}${leads.length} lead${leads.length !== 1 ? "s" : ""} ${leads.length !== 1 ? "need" : "needs"} follow-up.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <p style="margin:24px 0 0;">
      <a href="${SITE_URL}/super-admin/leads" style="display:inline-block;background:#f59e0b;color:#0f0f11;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Open Leads Pipeline</a>
    </p>
  `;

  await resend.emails.send({
    from: FROM,
    to: recipientEmail,
    cc: options?.cc,
    subject: `${leads.length} lead follow-up${leads.length !== 1 ? "s" : ""} pending`,
    html: baseHtml("Follow-up Digest", body),
  });
}

// ─── Grouped follow-up digest dispatch ─────────────────────────────────────────
// Splits a mixed batch of leads by who's actually responsible for the follow-up:
// each ACTIVE sales rep with pending leads gets their own email (their assigned
// leads only), CC'd to the SuperAdmin digest address for delivery confirmation.
// Unassigned leads — and any rep who's deactivated or has no login email on
// file — fall back into the SuperAdmin's own email so nothing is silently
// dropped, and a deactivated rep never keeps receiving lead PII by email after
// setSalesRepActive(false) (which only revokes their portal session, not this).

interface FollowUpDigestLead extends LeadFollowUpDigestItem {
  assigned_to: string | null;
  sales_rep?: { id: string; name: string; email: string | null; is_active: boolean } | null;
}

export async function sendGroupedFollowUpDigests(
  leads: FollowUpDigestLead[],
  adminEmail: string
): Promise<{ sentCount: number; recipientCount: number }> {
  const byRep = new Map<string, { rep: { id: string; name: string; email: string | null; is_active: boolean }; leads: FollowUpDigestLead[] }>();
  const adminBucket: FollowUpDigestLead[] = [];

  for (const lead of leads) {
    if (lead.assigned_to && lead.sales_rep) {
      const existing = byRep.get(lead.sales_rep.id);
      if (existing) existing.leads.push(lead);
      else byRep.set(lead.sales_rep.id, { rep: lead.sales_rep, leads: [lead] });
    } else {
      adminBucket.push(lead);
    }
  }

  const sends: Promise<void>[] = [];
  let recipientCount = 0;

  for (const { rep, leads: repLeads } of byRep.values()) {
    if (rep.email && rep.is_active) {
      sends.push(sendLeadFollowUpDigest(rep.email, repLeads, { cc: adminEmail, greetingName: rep.name }));
      recipientCount += 1;
    } else {
      // Deactivated (portal-locked-out reps must not keep getting lead PII by
      // email either) or no login email on file — surface it to the admin
      // instead of silently skipping the reminder. sendLeadFollowUpDigest
      // already labels each row with "Rep: {name}" when sales_rep is present.
      adminBucket.push(...repLeads);
    }
  }

  if (adminBucket.length > 0) {
    sends.push(sendLeadFollowUpDigest(adminEmail, adminBucket));
    recipientCount += 1;
  }

  await Promise.all(sends);
  return { sentCount: leads.length, recipientCount };
}
