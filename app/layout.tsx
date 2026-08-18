import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { siteUrl } from "@/lib/site-url";

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700"],
});

const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  // Without this Next resolves relative metadata URLs against Vercel's own
  // project domain, so every og:image and twitter:image pointed at
  // hms.yourpulse.io — the host a tenant never sees anywhere else. It is the
  // image a WhatsApp preview card fetches when somebody pastes their referral
  // link, so it belongs on the same origin as the link itself.
  //
  // Page-level metadata still wins: the public subdomain pages set their own
  // metadataBase from the request origin, which is what serves each client's
  // branding on their own domain.
  metadataBase: new URL(siteUrl()),
  title: "Pulse - Hostel Management System",
  description: "Manage your hostel, expenses, kitchen, and bills in one place",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerif.variable}`} suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
