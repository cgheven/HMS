import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createOnboardingDraft } from "@/app/actions/onboarding-intake";

export const metadata: Metadata = {
  title: "Set up your hostel — Pulse",
  description:
    "Tell us about your hostel and branches and we'll have your Pulse account ready to go.",
};

// Bare /onboarding mints a draft and forwards to its own resumable URL, so the
// link that gets sent out can stay generic. Everything typed from that point
// autosaves against the token, and reopening the URL restores it.
export default async function OnboardingEntryPage() {
  const { token, error } = await createOnboardingDraft();

  if (error || !token) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 bg-background">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold text-foreground">We couldn&apos;t start your setup</h1>
          <p className="text-sm text-muted-foreground">{error ?? "Please try again in a moment."}</p>
        </div>
      </main>
    );
  }

  redirect(`/onboarding/${token}`);
}
