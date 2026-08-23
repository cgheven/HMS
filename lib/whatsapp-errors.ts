// Meta error codes worth translating — the raw numbers are not self-explanatory,
// and the difference between them is the difference between "fix this" and
// "ignore this". Shared by the WhatsApp monitor and the marketing campaign page
// so the same code never gets two different explanations on two screens.

export const WHATSAPP_ERROR_HINTS: Record<number, string> = {
  131026: "Number is not on WhatsApp",
  131047: "Outside the 24-hour window — needs an approved template",
  132001: "Template name or language does not match",
  132000: "Wrong number of template parameters",
  100: "Invalid parameter sent to Meta",
  131049: "Blocked by Meta to protect user experience",
  131048: "Spam rate limit hit for this number",
  // Both learned the hard way on real blasts.
  130472: "Meta marketing experiment — temporary, retry later",
  131053: "Meta could not fetch the header image",
};

/** Short label for a stats row, where the full hint is too long to fit. */
const SHORT: Record<number, string> = {
  131026: "not on WhatsApp",
  130472: "Meta experiment",
  132001: "bad template",
  131053: "bad header image",
  131049: "blocked by Meta",
  131048: "rate limited",
};

export function whatsappErrorHint(code: number | null | undefined): string | null {
  return code == null ? null : WHATSAPP_ERROR_HINTS[code] ?? null;
}

/** Falls back to the bare code: an unrecognised failure must still be countable,
 *  or a new Meta error silently disappears from the breakdown. */
export function whatsappErrorShort(code: number | null | undefined): string {
  if (code == null) return "no code";
  return SHORT[code] ?? WHATSAPP_ERROR_HINTS[code] ?? `error ${code}`;
}
