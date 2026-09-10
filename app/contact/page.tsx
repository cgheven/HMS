import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone, MapPin } from "lucide-react";
import { LegalFooter } from "@/components/legal/legal-footer";

export const metadata: Metadata = { title: "Contact — Pulse" };

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-5 py-16">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Pulse</Link>
        <h1 className="mt-6 font-serif text-3xl tracking-tight">Contact us</h1>
        <p className="mt-2 text-muted-foreground">
          Pulse is operated by <strong>PulseHub Private Limited</strong>. Reach us any time — we usually reply
          within one business day.
        </p>

        <div className="mt-8 space-y-4">
          <a href="mailto:hello@yourpulse.io" className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-card p-4 hover:border-primary/30 transition-colors">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Mail className="w-4 h-4 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-medium">hello@yourpulse.io</p>
            </div>
          </a>
          <a href="tel:+923336673553" className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-card p-4 hover:border-primary/30 transition-colors">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Phone className="w-4 h-4 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="font-medium">+92 333 66 73553</p>
            </div>
          </a>
          <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-card p-4">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><MapPin className="w-4 h-4 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Address</p>
              <p className="font-medium">PulseHub Private Limited, Karachi, Pakistan</p>
            </div>
          </div>
        </div>

        <LegalFooter />
      </div>
    </div>
  );
}
