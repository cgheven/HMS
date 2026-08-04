import "server-only";
import { Resend } from "resend";
import { pktTodayDateString } from "@/lib/pkt-time";

const resend = new Resend(process.env.RESEND_API_KEY);

// Verified sender — configure RESEND_FROM_EMAIL in env (must match a verified Resend domain)
const FROM = process.env.RESEND_FROM_EMAIL ?? "Pulse HMS <noreply@yourpulse.io>";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hostel.yourpulse.io";

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
          <!-- Mirrors the app sidebar lockup: badge, then "Pulse" over the tagline
               in gold caps. Deliberately NOT the combined wordmark asset, which
               bakes the tagline into the artwork and so printed it twice.
               logo-mark-email.png is generated from logo-mark.jpg with its rounded
               shape cut into the alpha channel and the sidebar's gold ring baked
               in — the source JPEG has WHITE corners, which the sidebar hides with
               rounded-lg + overflow-hidden but which leak through in email, where
               border-radius on an img is unreliable and Outlook ignores it. Hence
               no border-radius here: the shape lives in the asset.
               The mark is decorative (empty alt) because the wordmark beside it is
               real text, so a client blocking images still renders the full brand
               rather than a broken-image icon. -->
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="padding-right:11px;vertical-align:middle;">
              <img src="${SITE_URL}/logo-mark-email.png" alt="" width="38" height="38"
                   style="width:38px;height:38px;display:block;border:0;" />
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:16px;font-weight:700;color:#EEF2FF;line-height:1.1;letter-spacing:-0.2px;">Pulse</div>
              <div style="font-size:10px;font-weight:600;color:#c9963a;letter-spacing:1.6px;margin-top:4px;text-transform:uppercase;">Pulse of Your Business</div>
            </td>
          </tr></table>
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

// ─── Platform invoice: issue + payment reminders (client-facing) ─────────────
// These are the only emails in this file that go to a PAYING CUSTOMER rather
// than to a hostel owner about their own tenants, so they carry a deliberate
// safety valve: set CLIENT_INVOICE_TEST_EMAIL and every one of them is
// redirected to that address instead of the real client. Leave it unset in
// production. Nothing else in this file is gated this way because nothing else
// can dun a customer for money.

interface ClientInvoiceEmailData {
  clientEmail: string;
  clientName: string;
  periodLabel: string;
  amount: number;
  dueDate: string;
  invoiceUrl: string;
  /** Days overdue; 0 or less means not yet due. Drives the tone of the copy. */
  daysOverdue: number;
  isReminder: boolean;
  /** The same breakdown the PDF shows, rendered inline. Deliberately NOT sent as
   *  an attachment: attachments are a spam-filter signal on a dunning email and
   *  a download-then-open detour on a phone, and invoiceUrl already serves the
   *  PDF for anyone who wants to print or file it. */
  lines: { label: string; value: string; muted?: boolean; credit?: boolean }[];
}

function formatPkr(n: number): string {
  return `Rs. ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

function lineRow(l: { label: string; value: string; muted?: boolean; credit?: boolean }): string {
  const color = l.credit ? "#34d399" : l.muted ? "#a1a1aa" : "#e5e5e5";
  return `<tr>
    <td style="padding:7px 0;border-bottom:1px solid #232326;font-size:13px;color:${l.muted ? "#a1a1aa" : "#d4d4d8"};">${esc(l.label)}</td>
    <td style="padding:7px 0;border-bottom:1px solid #232326;font-size:13px;color:${color};font-weight:${l.muted ? "400" : "600"};text-align:right;white-space:nowrap;">${esc(l.value)}</td>
  </tr>`;
}

export async function sendClientInvoiceEmail(
  data: ClientInvoiceEmailData
): Promise<{ redirectedTo?: string }> {
  const testOverride = process.env.CLIENT_INVOICE_TEST_EMAIL?.trim();
  const recipient = testOverride || data.clientEmail;

  const overdue = data.daysOverdue > 0;
  const heading = data.isReminder
    ? overdue
      ? `Payment overdue — ${data.periodLabel}`
      : `Payment reminder — ${data.periodLabel}`
    : `Your invoice for ${data.periodLabel}`;

  const lead = data.isReminder
    ? overdue
      ? `This invoice is <strong style="color:#fb7185;">${data.daysOverdue} day${data.daysOverdue === 1 ? "" : "s"} overdue</strong>. If you've already paid, please ignore this message.`
      : `A quick reminder that this invoice is due on <strong style="color:#f59e0b;">${esc(data.dueDate)}</strong>.`
    : `Thank you for using Pulse. Here is your invoice for <strong style="color:#f59e0b;">${esc(data.periodLabel)}</strong>.`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">${esc(heading)}</h2>
    <p style="margin:0 0 22px;font-size:14px;color:#a1a1aa;">Assalam o Alaikum ${esc(data.clientName)}, ${lead}</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;">
      ${data.lines.map(lineRow).join("")}
      <tr>
        <td style="padding:14px 0 0;font-size:14px;font-weight:700;color:#fff;">Total due</td>
        <td style="padding:14px 0 0;font-size:19px;font-weight:700;color:#f59e0b;text-align:right;white-space:nowrap;">${formatPkr(data.amount)}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:4px 0 0;font-size:12px;color:${overdue ? "#fb7185" : "#71717a"};">
          ${overdue ? `Was due ${esc(data.dueDate)}` : `Due ${esc(data.dueDate)}`}
        </td>
      </tr>
    </table>

    <p style="margin:24px 0 0;">
      <a href="${data.invoiceUrl}" style="display:inline-block;background:#f59e0b;color:#0f0f11;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Download PDF Invoice</a>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#71717a;">
      Questions about this invoice? Just reply to the person who set up your account.
    </p>
  `;

  const subject = data.isReminder
    ? overdue
      ? `Overdue: ${formatPkr(data.amount)} — Pulse invoice ${data.periodLabel}`
      : `Reminder: ${formatPkr(data.amount)} due ${data.dueDate} — Pulse invoice ${data.periodLabel}`
    : `Pulse invoice ${data.periodLabel} — ${formatPkr(data.amount)}`;

  const { error } = await resend.emails.send({
    from: FROM,
    to: recipient,
    subject: testOverride ? `[TEST → ${data.clientEmail}] ${subject}` : subject,
    html: baseHtml(heading, body),
  });
  if (error) throw new Error(`Resend: ${error.message}`);

  return testOverride ? { redirectedTo: recipient } : {};
}

// ─── Complaint submitted (owner notification) ────────────────────────────────
// Fired from the public QR complaint form. Every field originates from an
// unauthenticated submission, so it all goes through esc() — and the
// description additionally needs its newlines converted, since tenants type
// multi-line complaints that would otherwise collapse into one run-on line.

interface ComplaintEmailData {
  ownerEmail: string;
  hostelName: string;
  tenantName: string;
  phone: string;
  roomNumber?: string | null;
  category: string;
  description: string;
}

const COMPLAINT_CATEGORY_LABELS: Record<string, string> = {
  kitchen: "Kitchen / Food",
  staff: "Staff",
  cleanliness: "Cleanliness",
  maintenance: "Maintenance",
  security: "Security",
  other: "Other",
};

export async function sendComplaintEmail(data: ComplaintEmailData): Promise<void> {
  const categoryLabel = COMPLAINT_CATEGORY_LABELS[data.category] ?? data.category;
  const descriptionHtml = esc(data.description).replace(/\r?\n/g, "<br>");

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">New Complaint Submitted</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">A member raised a complaint at <strong style="color:#f59e0b;">${esc(data.hostelName)}</strong>.</p>

    <div style="margin:0 0 20px;padding:10px 14px;background:#1c1917;border:1px solid #3f2d17;border-radius:8px;">
      <div style="font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.5px;">${esc(categoryLabel)}</div>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Member", esc(data.tenantName))}
      ${row("Phone", esc(data.phone))}
      ${data.roomNumber ? row("Room", esc(data.roomNumber)) : ""}
    </table>

    <p style="margin:20px 0 6px;font-size:13px;font-weight:600;color:#e5e5e5;">Complaint</p>
    <div style="padding:12px 14px;background:#0f0f11;border:1px solid #27272a;border-radius:8px;font-size:13px;color:#e5e5e5;line-height:1.6;">
      ${descriptionHtml}
    </div>

    <p style="margin:24px 0 0;">
      <a href="${SITE_URL}/complaints" style="display:inline-block;background:#f59e0b;color:#0f0f11;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Open Complaints</a>
    </p>
  `;

  // resend.emails.send resolves with { error } instead of throwing, so an
  // unverified domain or bad key would otherwise look like a successful send.
  const { error } = await resend.emails.send({
    from: FROM,
    to: data.ownerEmail,
    subject: `New ${categoryLabel.toLowerCase()} complaint from ${data.tenantName} — ${data.hostelName}`,
    html: baseHtml("New Complaint", body),
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}

// ─── Onboarding form submitted (SuperAdmin notification) ─────────────────────
// Fired when a prospect completes the setup wizard at /onboarding/<token>.
// Every value here is unauthenticated user input, so it all goes through esc()
// before it reaches the HTML.

interface OnboardingSubmittedEmailData {
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  branches: { name: string; city: string; area: string; total_capacity: string }[];
  partnerCount: number;
  acRate: string;
  securityDeposit: string;
  noticeDays: string;
}

const ONBOARDING_NOTIFY_TO =
  process.env.ONBOARDING_NOTIFY_EMAIL ?? "musabkhan.queries@gmail.com";

export async function sendOnboardingSubmittedEmail(
  data: OnboardingSubmittedEmailData
): Promise<void> {
  const branchRows = data.branches
    .map((b, i) => {
      const location = [b.area, b.city].filter(Boolean).join(", ");
      return `<tr>
        <td style="padding:8px 0;border-top:1px solid #27272a;font-size:13px;color:#e5e5e5;">
          <span style="color:#f59e0b;font-weight:600;">${i + 1}.</span>
          <span style="font-weight:600;">${esc(b.name)}</span>
          ${location ? `<span style="color:#a1a1aa;"> — ${esc(location)}</span>` : ""}
          ${b.total_capacity ? `<span style="color:#71717a;"> · ${esc(b.total_capacity)} beds</span>` : ""}
        </td>
      </tr>`;
    })
    .join("");

  const n = data.branches.length;
  const creates = [
    "1 owner login",
    `${n} branch${n === 1 ? "" : "es"}`,
    `${n} pricing config${n === 1 ? "" : "s"}`,
    ...(data.partnerCount > 0 ? [`${data.partnerCount} partner login${data.partnerCount === 1 ? "" : "s"}`] : []),
  ].join(" · ");

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">New Hostel Setup Submitted</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">
      <strong style="color:#f59e0b;">${esc(data.ownerName)}</strong> completed the onboarding form and is ready to provision.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Owner", esc(data.ownerName))}
      ${row("Email", esc(data.ownerEmail))}
      ${row("WhatsApp", esc(data.ownerPhone))}
      ${row("AC per unit", `Rs. ${esc(data.acRate)}`)}
      ${row("Deposit", `Rs. ${esc(data.securityDeposit)}`)}
      ${row("Notice period", `${esc(data.noticeDays)} days`)}
    </table>

    <p style="margin:24px 0 4px;font-size:13px;font-weight:600;color:#e5e5e5;">
      Branches (${n})
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${branchRows}</table>

    <div style="margin:24px 0 0;padding:12px 14px;background:#1c1917;border:1px solid #3f2d17;border-radius:8px;">
      <div style="font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">
        Provisioning will create
      </div>
      <div style="font-size:13px;color:#e5e5e5;">${esc(creates)}</div>
    </div>

    <p style="margin:24px 0 0;">
      <a href="${SITE_URL}/super-admin/onboarding" style="display:inline-block;background:#f59e0b;color:#0f0f11;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Review &amp; Provision</a>
    </p>
  `;

  await resend.emails.send({
    from: FROM,
    to: ONBOARDING_NOTIFY_TO,
    subject: `New hostel setup — ${data.ownerName} (${n} branch${n === 1 ? "" : "es"})`,
    html: baseHtml("New Hostel Setup", body),
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
