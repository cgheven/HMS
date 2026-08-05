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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
