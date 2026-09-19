"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, CalendarClock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { submitBookDemo } from "@/app/actions/book-demo";

export function BookDemoForm() {
  const [form, setForm] = useState({ contactName: "", businessName: "", phone: "", email: "", city: "", propertyCount: "", preferredDate: "", preferredTime: "", message: "" });
  const [honeypot, setHoneypot] = useState("");
  const [timezone, setTimezone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Detect the visitor's IANA time zone so the preferred time is unambiguous
  // (e.g. a Lahore visitor resolves to "Asia/Karachi" = PKT). Client-only.
  useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    } catch {
      /* leave blank — the label falls back to "your local time" */
    }
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await submitBookDemo({ ...form, timezone, contactRef2: honeypot });
      if (res.success) setDone(true);
      else setError(res.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
        <h2 className="mt-4 text-xl font-semibold">Thanks — we&apos;ve got your request!</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Our team will reach out shortly to schedule your Pulse demo. Keep an eye on your phone and email.
        </p>
        <Link href="/pricing" className="mt-6 inline-block text-sm text-primary hover:underline">
          View pricing while you wait →
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Honeypot — off-screen, not display:none (harder for bots to detect). */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="contactRef2">Do not fill this in</label>
        <input id="contactRef2" name="contactRef2" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contactName">Your name *</Label>
          <Input id="contactName" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="e.g. Ahmed Khan" maxLength={100} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="businessName">Business / property name *</Label>
          <Input id="businessName" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="e.g. Al-Noor Hostel" maxLength={150} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone / WhatsApp *</Label>
          <Input id="phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="03001234567" maxLength={32} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@business.com" maxLength={254} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">City / country</Label>
          <Input id="city" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Lahore, Pakistan" maxLength={100} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="propertyCount">Number of properties</Label>
          <Input id="propertyCount" type="number" inputMode="numeric" min={1} max={999} value={form.propertyCount} onChange={(e) => set("propertyCount", e.target.value)} placeholder="e.g. 1" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preferredDate">Preferred demo date</Label>
          <Input id="preferredDate" type="date" value={form.preferredDate} onChange={(e) => set("preferredDate", e.target.value)} min={new Date().toISOString().slice(0, 10)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preferredTime">Preferred time</Label>
          <Input id="preferredTime" type="time" value={form.preferredTime} onChange={(e) => set("preferredTime", e.target.value)} />
          <p className="text-xs text-muted-foreground">
            In your local time{timezone ? ` — ${timezone}` : ""}. We&apos;ll send the invite to match.
          </p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="message">Anything you&apos;d like us to know?</Label>
          <textarea
            id="message"
            value={form.message}
            onChange={(e) => set("message", e.target.value)}
            placeholder="Rooms, what you're looking for, or anything else…"
            maxLength={1000}
            rows={4}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
          />
        </div>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
        {submitting ? "Sending…" : "Book my demo"}
      </Button>
      <p className="text-xs text-muted-foreground">
        We&apos;ll only use your details to contact you about a Pulse demo. No spam.
      </p>
    </form>
  );
}
