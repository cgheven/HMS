import { NextResponse } from "next/server";
import { RECOVERY_COOKIE } from "@/lib/auth-recovery";

/**
 * Burns the recovery marker once the password has actually been changed.
 *
 * Without this the marker would stay valid for its full 15 minutes, so someone
 * who walked away from an unlocked machine could return to /reset-password and
 * set the password again. Clearing it makes one verified link buy exactly one
 * password change.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(RECOVERY_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
