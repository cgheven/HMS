import type { VisitPurpose } from "@/types";

export const VISIT_PURPOSE_OPTIONS: VisitPurpose[] = [
  "education", "employment", "job_interview", "exam",
  "medical", "business", "tourism", "other",
];

export const VISIT_PURPOSE_LABELS: Record<VisitPurpose, string> = {
  education: "Education / Study",
  employment: "Job or Employment",
  job_interview: "Job Interview",
  exam: "Exam or Test",
  medical: "Medical Treatment",
  business: "Business",
  tourism: "Tourism / Visit",
  other: "Other",
};

/**
 * The write-side counterpart of visitPurposeLabel: turns whatever a caller
 * supplies into the exact column pair to insert.
 *
 * Every tenant-creation path goes through this rather than passing the raw
 * values, for two reasons. An unrecognised purpose would otherwise reach the
 * CHECK in migration 168 and fail the whole insert with a raw Postgres error —
 * on the public admission form that means a stranger's submission just dies.
 * And a detail string only belongs to "other"; letting one ride along with a
 * preset stores a description that contradicts its own key.
 */
export function normalizeVisitPurpose(
  purpose: string | null | undefined,
  detail: string | null | undefined
): { purpose_of_visit: VisitPurpose | null; purpose_of_visit_detail: string | null } {
  const key = VISIT_PURPOSE_OPTIONS.includes(purpose as VisitPurpose)
    ? (purpose as VisitPurpose)
    : null;
  return {
    purpose_of_visit: key,
    purpose_of_visit_detail: key === "other" ? detail?.trim() || null : null,
  };
}

/**
 * One display string for a stored purpose pair. "Other" alone tells a manager
 * nothing, so the typed detail replaces the generic label rather than being
 * appended to it — and falls back to "Other" if the detail was left blank.
 */
export function visitPurposeLabel(
  purpose: string | null | undefined,
  detail: string | null | undefined
): string | null {
  if (!purpose) return null;
  if (purpose === "other") return detail?.trim() || VISIT_PURPOSE_LABELS.other;
  return VISIT_PURPOSE_LABELS[purpose as VisitPurpose] ?? purpose;
}
