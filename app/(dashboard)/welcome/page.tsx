import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/data";
import { getWelcomeStatus } from "@/app/actions/onboarding-welcome";
import { WelcomeClient } from "@/components/modules/welcome/welcome-client";
import type { WifiNetwork, MealTimes, PaymentMethodAccount } from "@/types";

export default async function WelcomePage() {
  const ctx = await getAuthContext();
  // Owner-only setup flow. Managers/partners/super-admins never see it.
  if (!ctx || ctx.profile?.role !== "owner") redirect("/dashboard");

  const hostel = (ctx.hostel ?? null) as unknown as Record<string, unknown> | null;
  const status = await getWelcomeStatus();

  return (
    <WelcomeClient
      key={ctx.hostelId ?? ""}
      hostelId={ctx.hostelId ?? ""}
      branchName={(hostel?.name as string) || "your property"}
      country={(hostel?.country as string) ?? "PK"}
      status={status}
      initialWifi={(hostel?.wifi_networks ?? []) as WifiNetwork[]}
      initialMeals={(hostel?.meal_times ?? {}) as MealTimes}
      welcomeTemplate={(hostel?.welcome_message_template as string) ?? ""}
      initialReferrerPct={Number(hostel?.referral_referrer_percent ?? 0)}
      initialReferredPct={Number(hostel?.referral_referred_percent ?? 0)}
      initialCampaign={(hostel?.referral_campaign as string) ?? "off"}
      initialPaymentMethods={(hostel?.payment_methods ?? []) as PaymentMethodAccount[]}
      initialReminderTemplate={(hostel?.reminder_template as string) ?? null}
      whatsappEnabled={Boolean(hostel?.whatsapp_enabled)}
    />
  );
}
