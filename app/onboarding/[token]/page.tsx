import type { Metadata } from "next";
import { loadOnboardingDraft } from "@/app/actions/onboarding-intake";
import { OnboardingWizard } from "./onboarding-wizard";
import { OnboardingDone } from "./onboarding-done";

export const metadata: Metadata = {
  title: "Set up your hostel — Pulse",
};

export default async function OnboardingTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { draft, error } = await loadOnboardingDraft(token);

  if (error || !draft) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 bg-background">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold text-foreground">This link isn&apos;t valid</h1>
          <p className="text-sm text-muted-foreground">
            {error ?? "Ask us for a fresh setup link and we'll get you going."}
          </p>
        </div>
      </main>
    );
  }

  if (draft.status !== "draft") {
    return <OnboardingDone ownerName={draft.data.owner.name} />;
  }

  return <OnboardingWizard token={token} initialData={draft.data} />;
}
