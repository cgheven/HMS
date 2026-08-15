"use client";

import { useState } from "react";
import { CheckCircle2, Home, Loader2, Phone, User } from "lucide-react";
import { submitReferral } from "@/app/actions/referrals-public";
import { REFERRAL_PENDING_TTL_DAYS } from "@/lib/referrals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { REFERRAL_NAME_MAX_LENGTH, REFERRAL_PHONE_MAX_LENGTH } from "@/lib/referrals";

interface Props {
  code: string;
  hostelName: string;
  /** 0 = referrer-only mode; the page then promises the visitor nothing. */
  referredPercent: number;
}

export function ReferralFormClient({ code, hostelName, referredPercent }: Props) {
  const offersDiscount = referredPercent > 0;
  const [form, setForm] = useState({ name: "", phone: "", website_url: "" });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) { setError("Please enter their name."); return; }
    if (!form.phone.trim()) { setError("Please enter their mobile number."); return; }

    setLoading(true);
    try {
      const result = await submitReferral(code, {
        name: form.name,
        phone: form.phone,
        website_url: form.website_url,
      });

      if (result.success) {
        setSubmitted(true);
        return;
      }
      setError(result.error ?? "Something went wrong. Please try again.");
    } catch {
      // A dropped connection rejects the action call rather than returning an
      // error object. Without this the button sits on "Sending…" forever on the
      // one page an outsider ever sees, and the lead is lost with no retry.
      setError("Couldn't send that just now. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-5 animate-fade-in">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-serif font-normal tracking-tight text-foreground">
              You&apos;re on the list
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {offersDiscount ? (
                <>
                  Your discount is valid for{" "}
                  <span className="font-semibold text-foreground">
                    {REFERRAL_PENDING_TTL_DAYS} days
                  </span>{" "}
                  from today. Visit{" "}
                  <span className="font-semibold text-foreground">{hostelName}</span> and give this
                  mobile number when you arrive — after {REFERRAL_PENDING_TTL_DAYS} days the
                  discount no longer applies.
                </>
              ) : (
                <>
                  Visit <span className="font-semibold text-foreground">{hostelName}</span> within{" "}
                  <span className="font-semibold text-foreground">
                    {REFERRAL_PENDING_TTL_DAYS} days
                  </span>{" "}
                  and give this mobile number when you arrive.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-sidebar-border bg-sidebar/90 backdrop-blur-md">
        <div className="max-w-lg mx-auto px-4 min-h-14 py-2.5 flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20 shrink-0">
            <Home className="w-4 h-4 text-amber" />
          </div>
          <p className="text-sm font-semibold text-foreground leading-snug min-w-0 truncate">
            {hostelName}
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground">
            {offersDiscount
              ? `Get ${referredPercent}% off your first month's rent`
              : `Looking for a room at ${hostelName}?`}
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">
            Leave your name and number, then visit {hostelName}. Give this number when you arrive
            {offersDiscount ? " and your discount is applied to your first month." : "."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-muted-foreground" />
                Your Name <span className="text-rose-400">*</span>
              </Label>
              <Input
                placeholder="Ahmed Khan"
                value={form.name}
                maxLength={REFERRAL_NAME_MAX_LENGTH}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                Your Mobile Number <span className="text-rose-400">*</span>
              </Label>
              <Input
                type="tel"
                inputMode="tel"
                placeholder="0300 0000000"
                value={form.phone}
                maxLength={REFERRAL_PHONE_MAX_LENGTH}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                required
              />
            </div>

            {/* Honeypot — hidden from people, irresistible to bots. */}
            <div className="hidden" aria-hidden="true">
              <label htmlFor="website_url">Website</label>
              <input
                id="website_url"
                name="website_url"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={form.website_url}
                onChange={(e) => setForm({ ...form, website_url: e.target.value })}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-amber text-background hover:bg-amber/90 font-semibold h-11 text-base gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Register My Interest"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
