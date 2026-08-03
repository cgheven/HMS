import "server-only";
import { Resend } from "resend";

// esc/baseHtml/row are module-private in lib/email.ts and that file is owned
// elsewhere, so they are replicated here rather than widening its public
// surface. Any change to the shell there should be mirrored here.

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM_EMAIL ?? "Pulse HMS <noreply@yourpulse.io>";

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

// ─── RedFlag listing notice (notifies the person who was listed) ──────────────
// Deliberately neutral: it states which hostel recorded an outstanding balance
// and who to take it up with. It makes no accusation, names no other hostel,
// asserts nothing about whether the balance is genuine, and carries NO CNIC —
// the recipient already knows their own, and an email in transit is the wrong
// place for it.
//
// It also does not promise deletion. Marking a report settled sets its status
// to 'resolved'; neither hms_redflag_search nor hms_redflag_list filters on
// status, so the entry keeps being returned to other organisations, shown as
// Resolved. The wording below has to match that behaviour exactly — an email
// promising removal would be a statement we cannot keep.

interface RedflagNoticeEmailData {
  toEmail: string;
  tenantName: string;
  hostelName: string;
  ownerContact?: string | null;
  amount: number;
}

const DISCLAIMER =
  "Pulse HMS records this entry on behalf of the listing hostel and does not verify, endorse, or take responsibility for its contents. Any dispute must be settled directly with the hostel named above.";

export async function sendRedflagNoticeEmail(data: RedflagNoticeEmailData): Promise<void> {
  const amountLabel = `Rs. ${Number(data.amount).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Outstanding Balance Recorded</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#a1a1aa;">
      Hello ${esc(data.tenantName)}, <strong style="color:#f59e0b;">${esc(data.hostelName)}</strong>
      has recorded an unsettled balance against your name in Pulse HMS.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Recorded by", esc(data.hostelName))}
      ${row("Amount", esc(amountLabel))}
      ${data.ownerContact ? row("Contact", esc(data.ownerContact)) : ""}
    </table>

    <p style="margin:24px 0 0;font-size:13px;color:#a1a1aa;">
      If you have already paid this amount, or believe it was recorded in error, please contact
      ${esc(data.hostelName)} directly — they are the only ones who can update this entry.
      When they mark the balance settled, the entry's status changes to Resolved and anyone
      who looks it up sees it as settled. The entry itself stays on record.
    </p>

    <div style="margin:20px 0 0;padding:12px 14px;background:#1c1917;border:1px solid #27272a;border-radius:8px;">
      <div style="font-size:11px;color:#71717a;line-height:1.6;">${esc(DISCLAIMER)}</div>
    </div>
  `;

  await resend.emails.send({
    from: FROM,
    to: data.toEmail,
    subject: `Outstanding balance recorded by ${data.hostelName}`,
    html: baseHtml("Outstanding Balance Recorded", body),
  });
}

// ─── RedFlag resolution notice (closes the loop with the person listed) ───────
// The counterpart to the notice above. Someone told they owe money is entitled
// to be told when the hostel records it settled — otherwise the only message
// they ever receive from us is the accusation.
//
// The wording is held to the same standard: it says the status is now Resolved
// and it does NOT say the entry was deleted, because it was not. Resolved rows
// stay in the registry and stay visible to other hostels; only their status
// changes. Promising removal would be a promise the schema cannot keep.

interface RedflagResolvedEmailData {
  toEmail: string;
  tenantName: string;
  hostelName: string;
  amount: number;
}

export async function sendRedflagResolvedEmail(data: RedflagResolvedEmailData): Promise<void> {
  const amountLabel = `Rs. ${Number(data.amount).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff;">Balance Marked Settled</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#a1a1aa;">
      Hello ${esc(data.tenantName)}, <strong style="color:#f59e0b;">${esc(data.hostelName)}</strong>
      has marked the outstanding balance recorded against your name as settled.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a;padding-top:16px;">
      ${row("Recorded by", esc(data.hostelName))}
      ${row("Amount", esc(amountLabel))}
      ${row("Status", '<span style="color:#34d399;font-weight:600;">Resolved</span>')}
    </table>

    <p style="margin:24px 0 0;font-size:13px;color:#a1a1aa;">
      No further action is needed from you. The entry remains on record and is now shown as
      Resolved to anyone who looks it up — it is not deleted. If anything here looks wrong,
      contact ${esc(data.hostelName)} directly.
    </p>

    <div style="margin:20px 0 0;padding:12px 14px;background:#1c1917;border:1px solid #27272a;border-radius:8px;">
      <div style="font-size:11px;color:#71717a;line-height:1.6;">${esc(DISCLAIMER)}</div>
    </div>
  `;

  await resend.emails.send({
    from: FROM,
    to: data.toEmail,
    subject: `Balance marked settled by ${data.hostelName}`,
    html: baseHtml("Balance Marked Settled", body),
  });
}
