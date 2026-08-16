import "server-only";

/**
 * Best-effort client IP, for rate-limit bucket keys only.
 *
 * Never use this for authorization. On Vercel the platform sets
 * x-vercel-forwarded-for and x-real-ip and a client cannot forge them; behind
 * any other proxy those same headers become client-settable and every ceiling
 * keyed on this evaporates silently. If this deployment ever moves, this
 * function is the thing to re-check first.
 *
 * x-forwarded-for is read RIGHTMOST-first: the trusted proxy appends its own
 * view of the peer at the end, while a client controls everything to the left.
 */
export function clientIpFrom(h: Headers): string {
  return (
    h.get("x-vercel-forwarded-for") ||
    h.get("x-real-ip") ||
    h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    "unknown"
  );
}
