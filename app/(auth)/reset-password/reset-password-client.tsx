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
  // Whether other sessions were actually revoked — never assumed.
  const [revoked, setRevoked] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let settled = false;

    // Gate on the PASSWORD_RECOVERY EVENT, never on "a session exists".
    //
    // The previous version accepted any session at all, which made this page a
    // password-change form for whoever was already signed in — no recovery link
    // and no re-authentication required. Combined with lib/supabase/middleware.ts
    // treating only /login as an auth route, a signed-in visitor was never
    // redirected away, so any borrowed or hijacked session was a complete
    // account-takeover primitive.
    //
    // This event fires only when the browser has just consumed a recovery token,
    // so it is proof of the link rather than proof of a login.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        settled = true;
        setPhase("ready");

        // The token arrived in the fragment (#access_token=...) and has now been
        // consumed. Strip it: a fragment persists in browser history and is the
        // classic way a reset link leaks from a shared or borrowed machine.
        if (typeof window !== "undefined" && window.location.hash) {
          window.history.replaceState(null, "", window.location.pathname);
        }
      }
    });

    // The event fires during the client's initial URL parse. If it has not
    // fired shortly after mount, this visitor arrived without a valid link —
    // expired, already used, or guessed — and an ordinary logged-in session
    // must NOT be mistaken for one.
    const timer = setTimeout(() => {
      if (!settled) setPhase("invalid");
    }, 2500);

    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
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

    // Every other session is killed, not just this one. A reset is usually a
    // response to suspected compromise, and leaving the attacker's session alive
    // defeats the point. The result is CHECKED rather than discarded: the
    // previous version asserted "signed out everywhere" unconditionally, so a
    // failure here told the user they were safe when they were not.
    const { error: signOutErr } = await supabase.auth.signOut({ scope: "global" });
    setRevoked(!signOutErr);
    if (signOutErr) {
      console.error("[reset-password] global sign-out failed:", signOutErr.message);
    }
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
              {revoked
                ? "You have been signed out everywhere. Sign in again with your new password."
                : "Your password is updated. We could not sign out your other devices — sign in again and, if you suspect someone else had access, change it once more from a device you trust."}
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
