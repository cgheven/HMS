import type { Metadata } from "next";
import { ResetPasswordClient } from "./reset-password-client";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return <ResetPasswordClient />;
}
