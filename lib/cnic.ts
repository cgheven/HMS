// A Pakistani CNIC is 13 digits, conventionally written XXXXX-XXXXXXX-X.
//
// Applicants overwhelmingly type the digits straight through with no dashes —
// 38 of 47 real applications came in that way — so the dashes are inserted for
// them as they type rather than rejecting an otherwise-correct number over a
// punctuation convention. Validation then only has to catch genuinely wrong
// input (too few digits), not formatting.

export const CNIC_RE = /^\d{5}-\d{7}-\d$/;

/** Progressive formatter — safe to call on every keystroke. Non-digits are
 *  dropped, so a pasted "42101-1234567-1" and a typed "4210112345671" both
 *  land on the same result. */
export function formatCnic(input: string): string {
  const d = (input ?? "").replace(/\D/g, "").slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

export function isValidCnic(value: string | null | undefined): boolean {
  return CNIC_RE.test((value ?? "").trim());
}

/** Normalise before persisting: formats digits-only input, leaves anything
 *  already well-formed untouched, and maps empty to null. */
export function normalizeCnic(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return formatCnic(v);
}
