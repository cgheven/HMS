import "server-only";
import { Resend } from "resend";
import { pktTodayDateString } from "@/lib/pkt-time";
import { siteUrl } from "@/lib/site-url";

// Resend's constructor THROWS on a falsy key, at MODULE level. This module is
// now in the import graph of all three payment-recording server actions (via
// lib/payment-notifications.ts), so a throw here would 500 them before any of
// their own code runs — a missing env var would fail a collection, not just a
// notification. Degrade to a placeholder instead: every send then returns
// { data: null, error } and no-ops silently, which is the correct behaviour for
// an environment that is deliberately not wired for mail.
const RESEND_KEY = process.env.RESEND_API_KEY;
if (!RESEND_KEY) {
  console.error("[email] RESEND_API_KEY is not set — every email send will no-op.");
}
const resend = new Resend(RESEND_KEY || "re_00000000_0000000000000000000000");

// Verified sender — configure RESEND_FROM_EMAIL in env (must match a verified Resend domain)
const FROM = process.env.RESEND_FROM_EMAIL ?? "Pulse HMS <noreply@yourpulse.io>";
const SITE_URL = siteUrl();

// Escape user-supplied content before embedding in HTML to prevent injection.
// The apostrophe is escaped too: without it this is safe in a double-quoted
// attribute and silently unsafe in a single-quoted one, and which of those a
// future template uses is not something the escaper should have an opinion on.
function esc(s: string | null | undefined): string {
  if (!s) return "—";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
               logo-mark-email-v2.png is generated from logo-mark.jpg with the
               sidebar's rounded shape and amber border baked in, on an OPAQUE
               #1c1917 background matching the header row it sits on.
               Opaque, not transparent, on purpose: a transparent PNG takes
               whatever colour the client paints behind it, so the same asset
               rendered dark on desktop and WHITE on Gmail mobile. Baking the
               background in removes the client from the decision entirely.
               No border-radius here either — Outlook ignores it on an img, so
               the shape lives in the asset.
               The -v2 suffix is deliberate: Gmail proxies and caches images by
               URL, so re-uploading the same filename would keep serving the old
               transparent copy to every inbox that had already seen it.
               The mark is decorative (empty alt) because the wordmark beside it is
               real text, so a client blocking images still renders the full brand
               rather than a broken-image icon. -->
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="padding-right:11px;vertical-align:middle;">
              <img src="${SITE_URL}/logo-mark-email-v2.png" alt="" width="38" height="38"
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
  /** invoice = first send · reminder = chasing · receipt = we have been paid. */
  kind: "invoice" | "reminder" | "receipt";
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

  const isReceipt = data.kind === "receipt";
  const isReminder = data.kind === "reminder";
  // A paid invoice is never overdue, whatever the due date says.
  const overdue = !isReceipt && data.daysOverdue > 0;

  const heading = isReceipt
    ? `Payment received — ${data.periodLabel}`
    : isReminder
    ? overdue
      ? `Payment overdue — ${data.periodLabel}`
      : `Payment reminder — ${data.periodLabel}`
    : `Your invoice for ${data.periodLabel}`;

  const lead = isReceipt
    ? `we have received your payment for <strong style="color:#f59e0b;">${esc(data.periodLabel)}</strong>. Thank you.`
    : isReminder
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
        <td style="padding:14px 0 0;font-size:14px;font-weight:700;color:#fff;">${isReceipt ? "Total paid" : "Total due"}</td>
        <td style="padding:14px 0 0;font-size:19px;font-weight:700;color:${isReceipt ? "#4ade80" : "#f59e0b"};text-align:right;white-space:nowrap;">${formatPkr(data.amount)}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:4px 0 0;font-size:12px;color:${overdue ? "#fb7185" : "#71717a"};">
          ${isReceipt ? "Paid in full — nothing further is due." : overdue ? `Was due ${esc(data.dueDate)}` : `Due ${esc(data.dueDate)}`}
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

  const subject = isReceipt
    ? `Payment received — Pulse invoice ${data.periodLabel}`
    : isReminder
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

// ─── Negative checkout feedback (owner notification) ─────────────────────────
// Fired the moment a departing tenant marks anything "Poor" or answers "No" to
// the recommend question. See migration 161: whether it fires is decided by the
// GENERATED needs_attention column, never recomputed here, so the dashboard
// tile's count and this email can never disagree about what counts as negative.
//
// This is the highest-risk email in the product: `comment` is free text from an
// unauthenticated submitter. React is not involved anywhere in this file, so
// esc() is the ONLY thing between that text and the owner's mail client.

interface FeedbackAlertEmailData {
  ownerEmail: string;
  hostelName: string;
  tenantName: string;
  phone?: string | null;
  roomNumber?: string | null;
  checkedOut?: string | null;
  triggers: string[];
  answers: { label: string; value: string; text: string }[];
  comment?: string | null;
}

// A bare CR or LF inside a header value starts a new header — an injected Bcc
// is one "\r\nBcc:" away. Every value interpolated into `subject:` goes through
// this first. The tenant's comment never reaches the subject at all.
function hdr(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

// A switch, not an object lookup. `COLORS[a.value]` on a plain object inherits
// Object.prototype, so a value of "constructor" or "toString" returns something
// truthy and non-colour-shaped that would then be interpolated straight into a
// style attribute — the one place in this file where data reaches an attribute
// rather than a text node. The allowlist in the feedback action makes that
// unreachable today; this makes it unreachable by construction.
function answerColor(value: string): string {
  switch (value) {
    case "poor":
    case "no":
      return "#f43f5e";
    case "fair":
    case "maybe":
      return "#f59e0b";
    case "excellent":
    case "yes":
      return "#10b981";
    case "no_meals":
    case "no_roommate":
      return "#71717a";
    default:
      return "#e5e5e5";
  }
}

// The comment is the only unauthenticated free text this product ever puts in
// somebody's inbox, and it arrives wearing our logo, our colours and our
// sending domain. It cannot execute anything — esc() handles that — but a mail
// client will happily autolink a bare URL inside it, which turns a feature into
// a delivery channel for a lookalike login page addressed to a hostel owner who
// is already primed to act. Breaking the scheme stops the autolink; the reader
// can still see exactly what was written.
function defangUrls(s: string): string {
  return s.replace(/:\/\//g, "[://]").replace(/\bwww\./gi, "www[.]");
}

export async function sendFeedbackAlertEmail(data: FeedbackAlertEmailData): Promise<void> {
  // esc() FIRST, then insert the <br> markup. The other order either escapes
  // the <br> into a literal "&lt;br&gt;" or reintroduces the injection this
  // whole function exists to prevent. Same ordering as sendComplaintEmail.
  const commentHtml = data.comment
    ? defangUrls(esc(data.comment)).replace(/\r?\n/g, "<br>")
    : null;

  const triggerPills = data.triggers
    .map(
      (t) =>
        `<div style="font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.5px;">${esc(t)}</div>`
    )
    .join("");

  const answerRows = data.answers
    .map(
      (a) => `<tr>
        <td style="padding:6px 0;font-size:13px;color:#71717a;width:140px;">${esc(a.label)}</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600;color:${answerColor(a.value)};">${esc(a.text)}</td>
      </tr>`
    )
    .join("");

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Feedback that needs your attention</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#a1a1aa;">${esc(data.tenantName)} checked out of <strong style="color:#f59e0b;">${esc(data.hostelName)}</strong> and left this feedback.</p>

    <div style="margin:0 0 20px;padding:10px 14px;background:#1c1917;border:1px solid #3f2d17;border-radius:8px;">
      ${triggerPills}
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Tenant", esc(data.tenantName))}
      ${data.phone ? row("Phone", esc(data.phone)) : ""}
      ${data.roomNumber ? row("Room", esc(data.roomNumber)) : ""}
      ${data.checkedOut ? row("Checked out", esc(data.checkedOut)) : ""}
    </table>

    <p style="margin:22px 0 6px;font-size:13px;font-weight:600;color:#e5e5e5;">All answers</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:8px;">
      ${answerRows}
    </table>

    ${
      commentHtml
        ? `<p style="margin:22px 0 6px;font-size:13px;font-weight:600;color:#e5e5e5;">What they said</p>
    <div style="padding:12px 14px;background:#0f0f11;border:1px solid #27272a;border-radius:8px;font-size:13px;color:#e5e5e5;line-height:1.6;">
      ${commentHtml}
    </div>
    <p style="margin:8px 0 0;font-size:11px;color:#71717a;">Typed by the tenant, not checked by us. Don&#39;t trust any link or phone number inside it.</p>`
        : ""
    }

    <p style="margin:24px 0 0;">
      <a href="${SITE_URL}/feedback" style="display:inline-block;background:#f59e0b;color:#0f0f11;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Open Feedback</a>
    </p>
  `;

  const poorTrigger = data.triggers.find((t) => t.startsWith("Marked poor"));
  const subject = poorTrigger
    ? `Poor rating from ${hdr(data.tenantName)} — ${hdr(data.hostelName)}`
    : `${hdr(data.tenantName)} would not recommend you — ${hdr(data.hostelName)}`;

  const { error } = await resend.emails.send({
    from: FROM,
    to: data.ownerEmail,
    subject,
    html: baseHtml("Checkout Feedback", body),
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

// ── Client provisioning credentials ──────────────────────────────────────────

export interface ClientCredentialsEmailData {
  clientName: string;
  businessName: string;
  email: string;
  password: string;
}

/**
 * The ONLY channel that ever carries a new client's password.
 *
 * Deliberately not WhatsApp: Meta classifies credential delivery as
 * AUTHENTICATION and rejects it as a utility template, and a WhatsApp message
 * lives forever in chat history, in cloud backups, and on a lock-screen
 * preview. Email is not perfect, but it is the account the password is FOR —
 * anyone who can read it can already reset the account anyway, so it adds no
 * new attacker.
 *
 * The companion WhatsApp template says only "we have emailed the details",
 * never the password itself. If this send fails, that message must not go out.
 *
 * Throws on failure. Resend returns { error } instead of rejecting, so an
 * unchecked call here would silently create an account nobody can log into.
 */
interface PaymentReceiptEmailData {
  tenantEmail: string;
  tenantName: string;
  hostelName: string;
  /** Cumulative received against this bill, not just this transaction. */
  amountPaid: number;
  forMonth: string;
  receiptUrl: string;
  /** True when the bill is settled in full after this payment. */
  paidInFull: boolean;
  /** Still owed on this bill. Zero when settled. */
  remainingBalance: number;
}

/**
 * Payment confirmation to the TENANT, alongside the WhatsApp one.
 *
 * Sent only when a tenant actually has an email on file — 45 of 621 active
 * tenants today, so this is silent for most. That is fine: it costs nothing
 * when there is no address, and the WhatsApp receipt remains the primary
 * channel.
 *
 * Deliberately does NOT attach the PDF. The receipt link renders the same
 * document, always reflects the live payment, and keeps this email small
 * enough to arrive reliably.
 */
export async function sendPaymentReceiptEmail(data: PaymentReceiptEmailData): Promise<void> {
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">
      ${data.paidInFull ? "Payment received" : "Partial payment received"}
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">
      Assalam o Alaikum ${esc(data.tenantName)}, we have received your payment for
      <strong style="color:#f59e0b;">${esc(data.forMonth)}</strong>.${
        data.paidInFull
          ? ""
          : ` <strong style="color:#f59e0b;">Rs ${data.remainingBalance.toLocaleString()}</strong> is still outstanding on this bill.`
      }
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row(
        "Status",
        data.paidInFull
          ? `<span style="color:#4ade80;font-weight:700;">Paid in full</span>`
          : `<span style="color:#f59e0b;font-weight:700;">Partial payment</span>`
      )}
      ${row(
        data.paidInFull ? "Amount Received" : "Received so far",
        `<span style="color:#4ade80;font-weight:700;">Rs ${data.amountPaid.toLocaleString()}</span>`
      )}
      ${data.remainingBalance > 0
        ? row("Remaining", `<span style="color:#f59e0b;font-weight:700;">Rs ${data.remainingBalance.toLocaleString()}</span>`)
        : ""}
      ${row("For", esc(data.forMonth))}
      ${row("Hostel", esc(data.hostelName))}
    </table>
    <div style="margin:24px 0 0;">
      <a href="${esc(data.receiptUrl)}"
         style="display:inline-block;background:#f59e0b;color:#18181b;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;text-decoration:none;">
        View your receipt
      </a>
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:#71717a;">
      Keep this email for your records. If anything looks wrong, contact hostel management.
    </p>
  `;

  // Throws on an API failure so the caller's catch logs it. The only caller
  // (lib/whatsapp-payment-confirmation.ts) already wraps this in try/catch and
  // continues to the WhatsApp send regardless.
  await sendOrThrow({
    from: FROM,
    to: data.tenantEmail,
    subject: data.paidInFull
      ? `Payment received — ${hdr(data.forMonth)} — ${hdr(cap(data.hostelName, 64))}`
      : `Partial payment received — ${hdr(data.forMonth)} — ${hdr(cap(data.hostelName, 64))}`,
    html: baseHtml("Payment Received", body),
  });
}

// ─── Payment recorded by staff (owner alert) ────────────────────────────────

// resend.emails.send() RESOLVES with { data: null, error } on an API failure —
// it does not reject. Calling it bare means a rejected send (bad key, unverified
// domain, 429) is indistinguishable from a delivered one, which is exactly how
// a stage run reported "sent: 1" while the mail never left. Surface it instead:
// the callers here already wrap sends in try/catch and count failures.
async function sendOrThrow(payload: Parameters<typeof resend.emails.send>[0]): Promise<void> {
  const { error } = await resend.emails.send(payload);
  if (error) {
    throw new Error(`[resend] ${error.name ?? "send failed"}: ${error.message ?? String(error)}`);
  }
}

// Every string in the alert below is typed by the very person being reported —
// a manager types the room number, a partner types the tenant name — and none of
// the write paths bound their length. Cap before escaping so a 10,000-character
// name cannot push the rest of the email out of view.
function cap(s: string | null | undefined, n: number): string {
  return (s ?? "").slice(0, n);
}

interface OwnerPaymentAlertEmailData {
  ownerEmail: string;
  hostelName: string;
  tenantName: string;
  roomNumber?: string | null;
  amountReceived: number;
  paymentMethod: string;
  forMonth: string;
  remainingBalance: number;
  /** True when the bill is settled in full after this transaction. */
  paidInFull: boolean;
  recordedByName: string;
  /** A code literal at the call site, never a string read from the database. */
  recordedByRole: "Manager" | "Partner";
}

/**
 * Payment alert to the OWNER, sent only when someone OTHER than the owner
 * recorded the collection.
 *
 * Deliberately carries no /r/<token> receipt link. That route is an
 * unauthenticated GET with write side effects, and its tokens are permanent and
 * unrevocable — putting one in a second inbox creates a copy of a bearer
 * credential that can be forwarded or prefetched by a mail scanner. The owner
 * already has authenticated access, so the CTA points at /payments instead.
 *
 * Also excluded: CNIC, tenant phone/email, the actor's uuid, the manager's
 * synthetic login address, and the collector's free-text notes.
 */
export async function sendOwnerPaymentAlertEmail(data: OwnerPaymentAlertEmailData): Promise<void> {
  const who = esc(cap(data.recordedByName, 64));
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Payment recorded</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">
      ${who} (${data.recordedByRole}) recorded a payment at
      <strong style="color:#f59e0b;">${esc(cap(data.hostelName, 64))}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Member", esc(cap(data.tenantName, 80)))}
      ${data.roomNumber ? row("Room", esc(cap(data.roomNumber, 32))) : ""}
      ${row(
        "Status",
        data.paidInFull
          ? `<span style="color:#4ade80;font-weight:700;">Paid in full</span>`
          : `<span style="color:#f59e0b;font-weight:700;">Partial payment</span>`
      )}
      ${row("Amount Received", `<span style="color:#4ade80;font-weight:700;">Rs ${data.amountReceived.toLocaleString()}</span>`)}
      ${data.remainingBalance > 0
        ? row("Remaining", `<span style="color:#f59e0b;font-weight:700;">Rs ${data.remainingBalance.toLocaleString()}</span>`)
        : ""}
      ${row("Method", esc(cap(data.paymentMethod, 32)))}
      ${row("For", esc(cap(data.forMonth, 32)))}
      ${row("Recorded by", `${who} · ${data.recordedByRole}`)}
    </table>
    <div style="margin:24px 0 0;">
      <a href="${SITE_URL}/payments"
         style="display:inline-block;background:#f59e0b;color:#18181b;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;text-decoration:none;">
        Open Payments
      </a>
    </div>
  `;

  await sendOrThrow({
    from: FROM,
    // No amount and no member name in the subject — subjects surface on lock
    // screens and in the Resend dashboard.
    subject: `Payment recorded at ${hdr(cap(data.hostelName, 64))}`,
    to: data.ownerEmail,
    html: baseHtml("Payment Recorded", body),
  });
}

interface OwnerPaymentUndoneEmailData {
  ownerEmail: string;
  hostelName: string;
  tenantName: string;
  roomNumber?: string | null;
  amountReversed: number;
  forMonth: string;
  remainingBalance: number;
  undoneByName: string;
  undoneByRole: "Owner" | "Manager" | "Partner";
}

/**
 * Tells the owner that a recorded payment was REVERSED.
 *
 * Sent for every undo including the owner's own, which is the opposite of the
 * payment alert. Recording money is routine; un-recording it is not, and the
 * installment row is deleted — so without this email the only trace lives in
 * hms_activity_log, which is readable by super admins alone. An owner would
 * have no way to see that a collection they were told about had been erased.
 */
export async function sendOwnerPaymentUndoneEmail(data: OwnerPaymentUndoneEmailData): Promise<void> {
  const who = esc(cap(data.undoneByName, 64));
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Payment reversed</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">
      ${who} (${data.undoneByRole}) undid a recorded payment at
      <strong style="color:#f59e0b;">${esc(cap(data.hostelName, 64))}</strong>.
      The bill is now unpaid for that amount.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Member", esc(cap(data.tenantName, 80)))}
      ${data.roomNumber ? row("Room", esc(cap(data.roomNumber, 32))) : ""}
      ${row("Amount reversed", `<span style="color:#f87171;font-weight:700;">Rs ${data.amountReversed.toLocaleString()}</span>`)}
      ${row("For", esc(cap(data.forMonth, 32)))}
      ${row("Now outstanding", `<span style="color:#f59e0b;font-weight:700;">Rs ${data.remainingBalance.toLocaleString()}</span>`)}
      ${row("Reversed by", `${who} · ${data.undoneByRole}`)}
    </table>
    <div style="margin:24px 0 0;">
      <a href="${SITE_URL}/payments"
         style="display:inline-block;background:#f59e0b;color:#18181b;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;text-decoration:none;">
        Open Payments
      </a>
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:#71717a;">
      If this was a correction, the payment should be recorded again with the right amount.
    </p>
  `;

  await sendOrThrow({
    from: FROM,
    subject: `Payment reversed at ${hdr(cap(data.hostelName, 64))}`,
    to: data.ownerEmail,
    html: baseHtml("Payment Reversed", body),
  });
}

interface OwnerDailySummaryEmailData {
  ownerEmail: string;
  ownerName: string | null;
  branchName: string;
  date: string;
  collection: number;
  kitchen: number;
  staff: number;
  bills: number;
  other: number;
}

/**
 * End-of-day summary to the OWNER, by email, for EVERY branch.
 *
 * The WhatsApp version of this is gated on hms_hostels.whatsapp_enabled, true
 * for 4 of 15 branches. Email is deliberately NOT gated — see
 * sendOwnerDailySummaryEmails in lib/owner-daily-summary.ts. One email per
 * branch, matching the WhatsApp shape exactly so a client on both channels sees
 * the same message twice rather than two different reports.
 */
export async function sendOwnerDailySummaryEmail(data: OwnerDailySummaryEmailData): Promise<void> {
  const spent = data.kitchen + data.staff + data.bills + data.other;
  const net = data.collection - spent;
  const money = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Today at ${esc(cap(data.branchName, 64))}</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">
      ${data.ownerName ? `${esc(cap(data.ownerName, 64))}, here` : "Here"} is
      <strong style="color:#f59e0b;">${esc(data.date)}</strong> in full.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Collected", `<span style="color:#4ade80;font-weight:700;">${money(data.collection)}</span>`)}
      ${row("Kitchen", money(data.kitchen))}
      ${row("Staff", money(data.staff))}
      ${row("Bills", money(data.bills))}
      ${row("Other expenses", money(data.other))}
      ${row(
        "Net",
        `<span style="color:${net >= 0 ? "#4ade80" : "#f87171"};font-weight:700;">${net < 0 ? "−" : ""}${money(Math.abs(net))}</span>`
      )}
    </table>
    <div style="margin:24px 0 0;">
      <a href="${SITE_URL}/reports"
         style="display:inline-block;background:#f59e0b;color:#18181b;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;text-decoration:none;">
        Open Reports
      </a>
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:#71717a;">
      Cash in and out for the day. Figures come from the same sources the Reports page totals.
    </p>
  `;

  await sendOrThrow({
    from: FROM,
    subject: `Daily summary — ${hdr(cap(data.branchName, 64))} — ${hdr(data.date)}`,
    to: data.ownerEmail,
    html: baseHtml("Daily Summary", body),
  });
}

interface SeatReservedEmailData {
  tenantEmail: string;
  tenantName: string;
  hostelName: string;
  depositCollected: number;
  expectedJoining: string | null;
}

/**
 * Booking deposit confirmation to the TENANT.
 *
 * Arguably the most important receipt we send: the tenant has handed over money
 * for a room they have not moved into yet, and until now had nothing on paper.
 * There is no receipt link because no hms_payments row exists yet — a
 * reservation is recorded on the tenant, not as a bill — so the figures are
 * spelled out in the email body instead.
 *
 * Says the deposit is adjustable against the first bill, because "is this money
 * gone?" is the question a tenant actually has after paying it.
 */
export async function sendSeatReservedEmail(data: SeatReservedEmailData): Promise<void> {
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Your seat is reserved</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">
      Assalam o Alaikum ${esc(data.tenantName)}, we have received your booking deposit for
      <strong style="color:#f59e0b;">${esc(data.hostelName)}</strong>. Your seat is held.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Deposit Received", `<span style="color:#4ade80;font-weight:700;">Rs ${data.depositCollected.toLocaleString()}</span>`)}
      ${row("Hostel", esc(data.hostelName))}
      ${data.expectedJoining ? row("Expected Joining", esc(data.expectedJoining)) : ""}
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#a1a1aa;">
      This amount is adjusted against your first bill when you move in.
    </p>
    <p style="margin:12px 0 0;font-size:12px;color:#71717a;">
      Keep this email as proof of your booking. If anything looks wrong, contact hostel management.
    </p>
  `;

  await resend.emails.send({
    from: FROM,
    to: data.tenantEmail,
    subject: `Seat reserved — ${data.hostelName}`,
    html: baseHtml("Seat Reserved", body),
  });
}

export async function sendClientCredentialsEmail(data: ClientCredentialsEmailData): Promise<void> {
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Your Pulse account is ready</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">Assalam o Alaikum ${esc(data.clientName)}, your account for <strong style="color:#f59e0b;">${esc(data.businessName)}</strong> has been set up.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Email", esc(data.email))}
    </table>

    <p style="margin:20px 0 6px;font-size:13px;font-weight:600;color:#e5e5e5;">Password</p>
    <div style="padding:12px 14px;background:#0f0f11;border:1px solid #3f2d17;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;color:#f59e0b;letter-spacing:0.5px;word-break:break-all;">
      ${esc(data.password)}
    </div>

    <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;line-height:1.6;">
      Keep this email private — anyone with these details can sign in to your hostel's records.
      Do not forward it.
    </p>

    <p style="margin:24px 0 0;">
      <a href="${SITE_URL}/login" style="display:inline-block;background:#f59e0b;color:#0f0f11;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Sign in to Pulse</a>
    </p>
  `;

  const { error } = await resend.emails.send({
    from: FROM,
    to: data.email,
    subject: `Your Pulse account for ${data.businessName}`,
    html: baseHtml("Your Pulse account is ready", body),
  });

  if (error) throw new Error(`Resend: ${error.message}`);
}

// ─── Password reset ──────────────────────────────────────────────────────────

interface PasswordResetEmailData {
  to: string;
  /** The one-time recovery URL. Never logged, never stored, never echoed back
   *  to the browser that requested it. */
  actionLink: string;
  /** Whatever we can show the person to reassure them this is really them. */
  name?: string | null;
  /** Minutes until the link stops working — stated so nobody sits on it. */
  expiresInMinutes: number;
}

/**
 * Sent from OUR domain through Resend, alongside every other email this product
 * sends, rather than through Supabase's default sender.
 *
 * That is not only branding. Supabase's template lives in a web form: it cannot
 * be reviewed, it has no history, and nobody can tell what the email says
 * without logging into a dashboard. This one sits in the repo with the rest.
 *
 * No CTA text beyond the button and the raw URL: a password-reset mail is the
 * single most-phished message any product sends, so the fewer links and the
 * plainer the language, the easier it is for someone to tell a real one from a
 * forgery.
 */
export async function sendPasswordResetEmail(data: PasswordResetEmailData): Promise<void> {
  const greeting = data.name?.trim() ? `Hi ${esc(data.name.trim().split(/\s+/)[0])},` : "Hi,";
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Reset your password</h2>
    <p style="margin:0 0 8px;font-size:14px;color:#a1a1aa;">${greeting}</p>
    <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;">
      Someone asked to reset the password for this Pulse HMS account. Click the button below to choose a new one.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr><td style="border-radius:8px;background:#f59e0b;">
        <a href="${data.actionLink}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#0d1117;text-decoration:none;">Set a new password</a>
      </td></tr>
    </table>
    <p style="margin:0 0 24px;font-size:13px;color:#71717a;">
      This link works once and expires in ${data.expiresInMinutes} minutes.
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#71717a;">If the button does not work, paste this into your browser:</p>
    <p style="margin:0 0 24px;font-size:12px;color:#52525b;word-break:break-all;">${data.actionLink}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      <tr><td style="padding-top:16px;font-size:13px;color:#71717a;">
        <strong style="color:#a1a1aa;">Did not request this?</strong> Ignore this email — your password stays as it is.
        Nobody can change it without the link above. If you get these repeatedly, reply and tell us.
      </td></tr>
    </table>
  `;

  await resend.emails.send({
    from: FROM,
    to: data.to,
    subject: "Reset your Pulse HMS password",
    html: baseHtml("Reset your password", body),
  });
}
