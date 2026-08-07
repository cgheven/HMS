import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { getTenantFeedback } from "@/lib/data";
import { FeedbackClient } from "@/components/modules/feedback/feedback-client";

export default async function FeedbackPage() {
  // Question 3 rates the hostel staff, and a manager IS the staff. This guard
  // admits owners, super admins and partners at any tier, and redirects
  // managers — which is the behaviour that keeps staff out of their own
  // performance ratings.
  await requireOwnerOrPartnerTier("read_only");

  const { hostelId, feedback } = await getTenantFeedback();
  return <FeedbackClient key={hostelId ?? ""} feedback={feedback} />;
}
