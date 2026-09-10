"use client";

import { useEffect, useState } from "react";
import { initializePaddle } from "@paddle/paddle-js";
import { Loader2 } from "lucide-react";

/**
 * Redirect-checkout page. Lives on an APPROVED domain (in production this is
 * yourpulse.io). The app creates the Paddle transaction, then sends the customer
 * here with ?_ptxn=<transactionId>; Paddle.js opens the checkout on THIS domain,
 * so the app's own domain never has to be approved. On success Paddle returns to
 * the app's billing page.
 */
export function CheckoutClient({
  environment,
  clientToken,
}: {
  environment: "sandbox" | "production";
  clientToken: string;
}) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const txn = new URLSearchParams(window.location.search).get("_ptxn");
    if (!txn) { setError("No transaction to pay for."); return; }
    if (!clientToken) { setError("Checkout is not configured."); return; }

    // Where to send the buyer after a successful payment. In production the app
    // origin is passed via ?return=<origin>; default to this origin for testing.
    const returnOrigin = new URLSearchParams(window.location.search).get("return") || window.location.origin;
    const successUrl = `${returnOrigin.replace(/\/$/, "")}/billing?checkout=success`;

    let cancelled = false;
    initializePaddle({ environment, token: clientToken })
      .then((p) => {
        if (cancelled || !p) return;
        p.Checkout.open({
          transactionId: txn,
          settings: { displayMode: "overlay", theme: "dark", allowLogout: false, successUrl },
        });
      })
      .catch(() => { if (!cancelled) setError("Could not load the checkout. Please try again."); });
    return () => { cancelled = true; };
  }, [environment, clientToken]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="text-center">
        {error ? (
          <>
            <p className="text-sm font-semibold text-rose-400">{error}</p>
            <p className="mt-2 text-xs text-muted-foreground">You can close this page and try again from your billing page.</p>
          </>
        ) : (
          <>
            <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
            <p className="mt-3 text-sm text-muted-foreground">Opening secure checkout…</p>
          </>
        )}
      </div>
    </div>
  );
}
