"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

/** Long enough to resist offline guessing, short enough that people comply.
 *  Length beats character-class rules, which mostly produce "Password1!". */
const MIN_LENGTH = 10;

type Phase = "checking" | "ready" | "invalid" | "done";

export function ResetPasswordClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // Supabase turns the recovery token in the URL fragment into a short-lived
    // session before this runs. A visitor with no such session reached this page
    // without a valid link — an expired one, a reused one, or a guess.
    supabase.auth.getSession().then(({ data }) => {
      setPhase(data.session ? "ready" : "invalid");
    });

    // The token arrives in the fragment (#access_token=...). Strip it as soon as
    // it has been consumed: a fragment survives in browser history, and is the
    // classic way a reset link leaks from a shared or borrowed machine.
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= MIN_LENGTH && password === confirm && !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast({ title: "Could not update password", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Every other session is killed, not just this one. A password reset is very
    // often a response to a suspected compromise, and leaving the attacker's
    // existing session alive would defeat the entire point of resetting.
    await supabase.auth.signOut({ scope: "global" });
    setPhase("done");
    setSaving(false);
  }

  if (phase === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-amber/10 border border-amber/20 mx-auto">
            <TriangleAlert className="w-7 h-7 text-amber" />
          </div>
          <div>
            <h1 className="text-2xl font-serif tracking-tight">This link is no longer valid</h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Reset links expire quickly and can only be used once. Request a new one.
            </p>
          </div>
          <Link href="/forgot-password">
            <Button className="w-full">Request a new link</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto">
            <ShieldCheck className="w-7 h-7 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-serif tracking-tight">Password updated</h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              You have been signed out everywhere. Sign in again with your new password.
            </p>
          </div>
          <Button className="w-full" onClick={() => router.push("/login")}>Go to sign in</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl font-serif tracking-tight">Set a new password</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            At least {MIN_LENGTH} characters. A short phrase you will remember beats a short jumble.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Input
              id="password"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {tooShort && <p className="text-xs text-amber">Needs at least {MIN_LENGTH} characters.</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          {mismatch && <p className="text-xs text-rose-400">These do not match.</p>}
        </div>

        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Updating…</> : "Update password"}
        </Button>
      </form>
    </div>
  );
}
