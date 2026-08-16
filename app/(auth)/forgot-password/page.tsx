import type { Metadata } from "next";
import { ForgotPasswordClient } from "./forgot-password-client";

// noindex: a reset endpoint has no business in search results, and an indexed
// one invites automated probing.
export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <ForgotPasswordClient />;
}
