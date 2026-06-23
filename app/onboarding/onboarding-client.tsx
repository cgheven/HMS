"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Home, Building2, CheckCircle2, Phone, Mail, MapPin,
  MessageSquare, Users, Loader2, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitOnboarding } from "@/app/actions/onboarding";

const BRANCH_OPTIONS = [
  { value: 1, label: "1 branch" },
  { value: 3, label: "2 – 5 branches" },
  { value: 6, label: "6+ branches" },
];

const FEATURES = [
  { icon: Users, text: "Tenant management & check-in / check-out" },
  { icon: Building2, text: "Multi-branch support in one dashboard" },
  { icon: CheckCircle2, text: "Automated monthly payment tracking" },
  { icon: MessageSquare, text: "Complaints, announcements & staff management" },
];

export function OnboardingClient() {
  const [form, setForm] = useState({
    business_name: "",
    owner_name: "",
    phone: "",
    email: "",
    city: "",
    branch_count: 1,
    message: "",
    // honeypot — hidden from real users, bots fill it
    website_url: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await submitOnboarding(form);

    setSubmitting(false);
    if (!result.success) {
      setError(result.error ?? "Something went wrong. Please try again.");
      return;
    }
    setSuccess(true);
  }

  // ---- Success State ----
  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6 animate-fade-up">
          <div className="flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-serif font-normal tracking-tight text-foreground">
              Thank you{form.owner_name ? `, ${form.owner_name}` : ""}!
            </h1>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              We have received your application and will contact you on WhatsApp within{" "}
              <strong className="text-foreground">24 hours</strong> to get you set up.
            </p>
          </div>
          <div className="rounded-xl border border-sidebar-border bg-card p-4 text-left space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What happens next</p>
            {[
              "Our team reaches out on WhatsApp to verify details",
              "We set up your hostel account and configure your first branch",
              "You get a walkthrough of the dashboard",
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-amber/10 border border-amber/20 shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-amber">{i + 1}</span>
                </div>
                <p className="text-sm text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-amber hover:underline"
          >
            Back to home <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  // ---- Form ----
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b border-sidebar-border bg-sidebar/60 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20">
              <Home className="w-4 h-4 text-amber" />
            </div>
            <div>
              <p className="text-foreground font-bold text-sm tracking-tight leading-none">Pulse</p>
              <p className="text-amber/70 text-[10px] mt-0.5 font-semibold tracking-[0.15em] uppercase">Pulse of Your Business</p>
            </div>
          </Link>
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Already have an account? <span className="text-amber">Sign in</span>
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 lg:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start">

          {/* Left: Marketing copy */}
          <div className="space-y-8 lg:sticky lg:top-24">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber/10 border border-amber/20 text-xs font-semibold text-amber">
                <span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" />
                Free to get started
              </div>
              <h1 className="text-4xl lg:text-5xl font-serif font-normal tracking-tight text-foreground leading-tight">
                Manage Your Hostel{" "}
                <span className="text-amber italic">Digitally</span>
              </h1>
              <p className="text-muted-foreground text-base leading-relaxed">
                Join hundreds of hostel owners who use Pulse to streamline operations,
                collect payments on time, and grow their business.
              </p>
            </div>

            {/* Features */}
            <ul className="space-y-3">
              {FEATURES.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
                </li>
              ))}
            </ul>

            {/* Social proof */}
            <div className="rounded-2xl border border-sidebar-border bg-card p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {["A", "M", "F", "Z"].map((l) => (
                    <div key={l} className="w-8 h-8 rounded-full bg-amber/15 border-2 border-background flex items-center justify-center text-xs font-bold text-amber">
                      {l}
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">50+ hostel owners</strong> trust Pulse
                </p>
              </div>
              <blockquote className="text-sm text-muted-foreground italic border-l-2 border-amber/30 pl-3">
                "Pulse turned our chaotic hostel into a smooth operation. Payment tracking alone saved us hours every month."
              </blockquote>
              <p className="text-xs text-muted-foreground/60">— Hostel owner, Karachi</p>
            </div>
          </div>

          {/* Right: Form */}
          <div className="rounded-2xl border border-sidebar-border bg-card p-6 sm:p-8">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-foreground">Get started — it&apos;s free</h2>
              <p className="text-muted-foreground text-sm mt-1">Fill in the form and we&apos;ll contact you within 24 hours.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Honeypot — hidden from real users, visible to bots */}
              <div className="hidden" aria-hidden="true">
                <Label htmlFor="website_url">Website</Label>
                <Input
                  id="website_url"
                  name="website_url"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website_url}
                  onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="business_name" className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                    Business / Hostel Name *
                  </Label>
                  <Input
                    id="business_name"
                    placeholder="Green Valley Hostel"
                    value={form.business_name}
                    onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="owner_name" className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    Your Name *
                  </Label>
                  <Input
                    id="owner_name"
                    placeholder="Ahmed Khan"
                    value={form.owner_name}
                    onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                    WhatsApp Number *
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+92 300 0000000"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                    Email <span className="text-muted-foreground/50 text-xs font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="owner@hostel.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="city" className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                    City <span className="text-muted-foreground/50 text-xs font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="city"
                    placeholder="Karachi"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </div>
              </div>

              {/* Branch count */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                  Number of Branches
                </Label>
                <div className="flex gap-2">
                  {BRANCH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, branch_count: opt.value })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        form.branch_count === opt.value
                          ? "bg-amber/10 border-amber/30 text-amber"
                          : "border-sidebar-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message */}
              <div className="space-y-1.5">
                <Label htmlFor="message" className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                  Message <span className="text-muted-foreground/50 text-xs font-normal">(optional)</span>
                </Label>
                <textarea
                  id="message"
                  rows={3}
                  placeholder="Tell us about your hostel or any specific requirements…"
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-amber text-background hover:bg-amber/90 font-semibold h-11 text-base gap-2"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                ) : (
                  <>Get Started Free <ChevronRight className="w-4 h-4" /></>
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                By submitting, you agree to be contacted by our team via WhatsApp or email.
                No spam, ever.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
