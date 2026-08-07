import type {
  FeedbackFood,
  FeedbackRating,
  FeedbackRecommend,
  FeedbackRoommate,
  TenantFeedback,
} from "@/types";

// Shared vocabulary for tenant checkout feedback.
//
// No "server-only" here on purpose: the public form (a client component) and
// the server action must agree on the exact same option lists, and the only way
// to guarantee that is for both to import the same arrays. Nothing in this file
// touches the database or reads a secret.

export const RATING_OPTIONS = ["poor", "fair", "good", "excellent"] as const;
export const FOOD_OPTIONS = [...RATING_OPTIONS, "no_meals"] as const;
export const ROOMMATE_OPTIONS = [...RATING_OPTIONS, "no_roommate"] as const;
export const RECOMMEND_OPTIONS = ["yes", "maybe", "no"] as const;

// UX cap. The database CHECK is 2000 (migration 161) and is the real floor;
// this is the tighter product limit, enforced server-side in the action rather
// than trusted from the textarea's maxLength, which is advisory only.
export const FEEDBACK_COMMENT_MAX_LENGTH = 1000;

export const RATING_LABELS: Record<FeedbackRating, string> = {
  poor: "Poor",
  fair: "Fair",
  good: "Good",
  excellent: "Excellent",
};

export const FOOD_LABELS: Record<FeedbackFood, string> = {
  ...RATING_LABELS,
  no_meals: "I didn't take meals",
};

export const ROOMMATE_LABELS: Record<FeedbackRoommate, string> = {
  ...RATING_LABELS,
  no_roommate: "I didn't have one",
};

export const RECOMMEND_LABELS: Record<FeedbackRecommend, string> = {
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

// Short forms for the owner-side chips, where the question word already
// supplies the context ("Food — no meals" rather than "Food I didn't take meals").
export const FOOD_SHORT: Record<FeedbackFood, string> = {
  ...RATING_LABELS,
  no_meals: "no meals",
};

export const ROOMMATE_SHORT: Record<FeedbackRoommate, string> = {
  ...RATING_LABELS,
  no_roommate: "none",
};

export type FeedbackBucket = "attention" | "mixed" | "happy";

// ONE definition of "needs attention", shared by the stat tile, the card badge,
// the rose card highlight, the dashboard tile and the email trigger.
//
// The database computes the same rule independently as a GENERATED column
// (hms_tenant_feedback.needs_attention), and THAT is what gates the owner
// email. This function exists only to bucket rows for display; it must never
// be used to decide whether to send mail, or the two definitions can drift.
export function feedbackBucket(f: {
  food: FeedbackFood;
  cleanliness: FeedbackRating;
  staff: FeedbackRating;
  roommate: FeedbackRoommate;
  recommend: FeedbackRecommend;
}): FeedbackBucket {
  const answers = [f.food, f.cleanliness, f.staff, f.roommate];
  if (answers.includes("poor") || f.recommend === "no") return "attention";
  if (answers.includes("fair") || f.recommend === "maybe") return "mixed";
  return "happy";
}

// Which answers actually triggered the alert, in plain words, for the amber
// pill at the top of the owner email and the card badge.
export function feedbackTriggers(f: {
  food: FeedbackFood;
  cleanliness: FeedbackRating;
  staff: FeedbackRating;
  roommate: FeedbackRoommate;
  recommend: FeedbackRecommend;
}): string[] {
  const poor: string[] = [];
  if (f.food === "poor") poor.push("Food");
  if (f.cleanliness === "poor") poor.push("Cleanliness");
  if (f.staff === "poor") poor.push("Staff");
  if (f.roommate === "poor") poor.push("Roommate");

  const out: string[] = [];
  if (poor.length > 0) out.push(`Marked poor: ${poor.join(", ")}`);
  if (f.recommend === "no") out.push("Would not recommend us");
  return out;
}

export const VERDICT_LABEL: Record<FeedbackBucket, string> = {
  attention: "Needs attention",
  mixed: "Mixed",
  happy: "Happy",
};

// Colour on the OWNER side only. The public form is deliberately colourless —
// see the form client.
export function answerColor(value: string): string {
  switch (value) {
    case "poor":
    case "no":
      return "text-rose-400";
    case "fair":
    case "maybe":
      return "text-amber";
    case "excellent":
    case "yes":
      return "text-emerald-400";
    case "no_meals":
    case "no_roommate":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

// The five answers as "{Question} {Answer}" pairs, in question order.
export function feedbackChips(f: Pick<TenantFeedback, "food" | "cleanliness" | "staff" | "roommate" | "recommend">) {
  return [
    { label: "Food", value: f.food, text: FOOD_SHORT[f.food] ?? f.food },
    { label: "Cleanliness", value: f.cleanliness, text: RATING_LABELS[f.cleanliness] ?? f.cleanliness },
    { label: "Staff", value: f.staff, text: RATING_LABELS[f.staff] ?? f.staff },
    { label: "Roommate", value: f.roommate, text: ROOMMATE_SHORT[f.roommate] ?? f.roommate },
    { label: "Recommends", value: f.recommend, text: RECOMMEND_LABELS[f.recommend] ?? f.recommend },
  ];
}
