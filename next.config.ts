import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "X-XSS-Protection",          value: "1; mode=block" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  // F-011: camera=(self) so the PhotoPicker component's getUserMedia() works.
  // The previous camera=() blocked camera access for the page itself.
  { key: "Permissions-Policy",        value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // F-013: Content-Security-Policy — defense-in-depth against XSS.
  // 'unsafe-inline' is required for Next.js styled-jsx/inline styles.
  // Supabase CDN is whitelisted for images and API connections.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https://*.supabase.co data: blob:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "font-src 'self' data:",
      "media-src 'self' blob:",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Lets a verification build run while `next dev` is holding .next:
  //   HMS_DIST_DIR=.next-verify npx next build
  // Two deployments failed on a route-export error that `tsc --noEmit` cannot
  // detect — Next validates route exports only during `next build` — and the
  // reason it went unverified locally was that the dev server owned .next.
  // Unset in CI and on Vercel, so production builds are unaffected.
  distDir: process.env.HMS_DIST_DIR || ".next",
  compress: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    // Tree-shake icon and chart imports — ships only what's used
    optimizePackageImports: ["lucide-react", "recharts", "@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-label"],
    // Default Server Action body limit is 1MB. addRoomAsManager/updateRoomAsManager
    // (app/actions/managers.ts) submit up to 5 room photos per save, each up to
    // 5MB per the client-side check in spaces-client.tsx — worst case ~25MB.
    // allowedOrigins is additive to the default same-origin rule. Branded
    // subdomains are rewritten internally (middleware.ts), so a Server Action
    // fired from one — joinWaitlist on the public listing page — arrives with
    // an Origin that Next must be told to trust, or the waitlist form fails
    // silently on every client domain.
    serverActions: { bodySizeLimit: "30mb", allowedOrigins: ["*.hostels.yourpulse.io"] },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Tenant checkout feedback carries a single-use write credential in the
      // URL path, so this block is listed AFTER the global one in order to
      // override Referrer-Policy for these routes only.
      //
      //   no-referrer  — the default strict-origin-when-cross-origin would leak
      //                  the whole path (and therefore the token) in the Referer
      //                  of any third-party request the page makes. The page
      //                  deliberately loads zero third-party assets as well.
      //   noindex      — an indexed copy of this URL is a live credential
      //                  sitting in a search result.
      //   no-store     — a shared or proxy cache must never be able to serve one
      //                  tenant's rendered state to the next visitor.
      {
        // Identical reasoning to /fb below: the path segment is a credential.
        source: "/rs/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        source: "/fb/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
  async rewrites() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return [];
    return [
      // AC meter photos are served from our own domain rather than the raw
      // Supabase storage host. Cosmetic in intent — an owner opening evidence
      // should see their own site, not a project-ref URL that also advertises
      // which backend this runs on — but it earns two real things:
      //
      //   * the securityHeaders above now apply to the image response,
      //     including the X-Content-Type-Options: nosniff that Supabase's
      //     public storage endpoint does not send;
      //   * the storage host stops appearing in anything an owner might share.
      //
      // A rewrite, not a redirect: the browser never learns the upstream URL.
      // Every stored path ends in .png/.jpg/.webp, which middleware.ts's matcher
      // excludes, so these requests bypass the auth gate exactly like other
      // static image traffic — the bucket is public, so there is nothing here
      // for a session to protect.
      {
        source: "/meter-photos/:path*",
        destination: `${supabaseUrl}/storage/v1/object/public/ac-meter-photos/:path*`,
      },
    ];
  },
};

export default nextConfig;
