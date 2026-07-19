import { requireSuperAdmin } from "@/lib/auth";
import { listOnboardingSubmissions } from "@/app/actions/onboarding-provision";
import { OnboardingSubmissionsClient } from "@/components/modules/super-admin/onboarding-submissions-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminOnboardingPage() {
  await requireSuperAdmin();
  const { submissions } = await listOnboardingSubmissions();
  return <OnboardingSubmissionsClient initialSubmissions={submissions ?? []} />;
}
