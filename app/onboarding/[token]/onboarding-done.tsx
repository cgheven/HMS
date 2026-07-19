import { CheckCircle2, Mail } from "lucide-react";

export function OnboardingDone({ ownerName }: { ownerName?: string }) {
  const first = ownerName?.trim().split(" ")[0];
  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-background">
      <div className="max-w-lg w-full text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-emerald-400" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {first ? `Thanks, ${first} — that's everything.` : "That's everything — thank you."}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We have your branches and pricing. Your account is being set up now, and your login
            details will arrive shortly.
          </p>
        </div>
        <div className="rounded-xl border border-sidebar-border bg-card px-4 py-3 flex items-center gap-2.5 justify-center">
          <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            Nothing else to do — we&apos;ll email and WhatsApp you when it&apos;s ready.
          </p>
        </div>
      </div>
    </main>
  );
}
