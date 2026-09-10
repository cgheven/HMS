import type { Metadata } from "next";
import { getPaddleClientConfig } from "@/lib/paddle";
import { CheckoutClient } from "./checkout-client";

export const metadata: Metadata = { title: "Checkout — Pulse" };

// Public checkout page. Opens the Paddle checkout for the ?_ptxn transaction on
// THIS (approved) domain, so the app domain never launches Paddle.js itself.
export default function CheckoutPage() {
  const cfg = getPaddleClientConfig();
  return <CheckoutClient environment={cfg.environment} clientToken={cfg.clientToken} />;
}
