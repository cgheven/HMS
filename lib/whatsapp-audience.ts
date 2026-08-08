// Who a WhatsApp message was addressed to.
//
// Deliberately NOT in app/actions/whatsapp-monitor.ts: that file is "use server",
// and Next.js only allows async function exports there — exporting the label map
// from it crashed the page with "a 'use server' file can only export async
// functions, found object".
//
// No "server-only" either: the monitor action derives the audience and the
// client component renders its label, so both sides must share one definition
// or the filter and the badge can disagree. Same reasoning as
// lib/feedback-options.ts.

export type WhatsAppAudience = "tenant" | "client_invoice" | "client_account" | "unknown";

export const AUDIENCE_LABELS: Record<WhatsAppAudience, string> = {
  tenant: "Tenant",
  // Split by purpose because they are different conversations: an invoice
  // chases OUR money, while provisioning and the daily summary are service
  // messages about the client's own business.
  client_invoice: "Client — invoice",
  client_account: "Client — account",
  unknown: "Unattributed",
};
