"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { requestPasswordReset } from "@/app/actions/password-reset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordClient() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    const res = await requestPasswordReset(email);
    setSending(false);
    // The server answers identically for every outcome, so this screen can show
    // the result verbatim without leaking whether the address exists.
    setSent(res.message);
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto">
            <MailCheck className="w-7 h-7 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-serif tracking-tight">Check your email</h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{sent}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            The link expires shortly and can only be used once.
          </p>
          <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-amber hover:underline">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl font-serif tracking-tight">Forgot your password?</h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Enter the email you sign in with and we will send you a link to set a new password.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={sending || !email.trim()}>
          {sending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sending…</> : "Send reset link"}
        </Button>

        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          Managers sign in with a mobile number and cannot reset here — ask your hostel owner to
          issue a new password.
        </p>

        <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm text-amber hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
        </Link>
      </form>
    </div>
  );
}
