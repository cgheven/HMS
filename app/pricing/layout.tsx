import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — HMS",
  description: "Simple, transparent pricing for hostel management. All plans include full setup, training, and support.",
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
