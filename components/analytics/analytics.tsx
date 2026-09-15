"use client";

import Script from "next/script";
import { GA_ENABLED, GA_MEASUREMENT_ID, GA_DEBUG } from "@/lib/analytics";

/**
 * Loads GA4 (gtag.js) exactly once for custom business events.
 *
 *  - Nothing is loaded at all unless GA is enabled (prod, or NEXT_PUBLIC_GA_DEBUG).
 *  - send_page_view:false — GA never auto-sends the initial pageview.
 *  - There is deliberately NO router listener: we do NOT send page_view on SPA
 *    route changes, so authenticated dashboard URLs, route names and query
 *    strings are never captured automatically. Only the explicit, whitelisted
 *    custom events in lib/analytics.ts reach GA4.
 *
 * NOTE: GA4 "Enhanced measurement → Page changes based on browser history
 * events" must ALSO be turned OFF in the data stream — it is a GA-side setting
 * that no gtag config can override, and if left on it would still auto-capture
 * authenticated SPA URLs. Documented in the GA4 dashboard config checklist.
 */
export function Analytics() {
  if (!GA_ENABLED) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false${
            GA_DEBUG ? ", debug_mode: true" : ""
          } });
        `}
      </Script>
    </>
  );
}
