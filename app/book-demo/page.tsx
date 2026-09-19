import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, Check } from "lucide-react";
import { BookDemoForm } from "@/components/modules/marketing/book-demo-form";

export const metadata: Metadata = {
  title: "Book a Demo — Pulse",
  description: "See Pulse in action. Book a personalised demo of the accommodation management platform for your hostel or property.",
};

const HIGHLIGHTS = [
  "A walkthrough tailored to your property",
  "Rooms, residents, rent, bills, kitchen & staff in one place",
  "Set up in minutes — bring your questions",
];

export default function BookDemoPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:py-20">
        {/* Left: pitch */}
        <div className="lg:pt-6">
          <div className="flex items-center gap-2 text-sm text-primary">
            <Sparkles className="h-4 w-4" />
            <span>Pulse — accommodation management</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Book a demo</h1>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            Tell us a little about your property and we&apos;ll show you exactly how Pulse can run it — end to end.
          </p>
          <ul className="mt-6 space-y-3">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-start gap-2.5 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm text-muted-foreground">
            Prefer to explore first?{" "}
            <Link href="/pricing" className="text-primary hover:underline">See pricing</Link>.
          </p>
        </div>

        {/* Right: form card */}
        <div className="rounded-2xl border border-sidebar-border bg-card p-6 sm:p-8">
          <BookDemoForm />
        </div>
      </div>
    </main>
  );
}
