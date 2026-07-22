import "server-only";

// Server-side client for the Wasender WhatsApp API (wasenderapi.com) — a single
// shared platform session (one connected WhatsApp number for the whole
// platform), used only by the automated payment-reminder cron. Fully separate
// from the existing manual "wa.me" reminder/receipt buttons, which keep
// opening the staff member's own WhatsApp app and are unaffected by this file.

const WASENDER_BASE_URL = "https://wasenderapi.com/api";

export interface SendWhatsAppResult {
  ok: boolean;
  error?: string;
}

// Wasender expects a WhatsApp JID, not a bare phone number — "923001234567@s.whatsapp.net".
function toJid(phoneDigits: string): string {
  return `${phoneDigits}@s.whatsapp.net`;
}

export async function sendWhatsAppMessage(phoneDigits: string, text: string): Promise<SendWhatsAppResult> {
  const apiKey = process.env.WASENDER_API_KEY;
  if (!apiKey) return { ok: false, error: "WASENDER_API_KEY not configured" };

  try {
    const res = await fetch(`${WASENDER_BASE_URL}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ to: toJid(phoneDigits), text }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Wasender ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
