"use client";

import { answerColor, feedbackChips } from "@/lib/feedback-options";
import type { TenantFeedback } from "@/types";

type AnswerFields = Pick<TenantFeedback, "food" | "cleanliness" | "staff" | "roommate" | "recommend">;

export function FeedbackAnswerChips({ feedback }: { feedback: AnswerFields }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {feedbackChips(feedback).map((chip) => (
        <span key={chip.label} className="text-xs">
          <span className="text-muted-foreground">{chip.label} </span>
          <span className={`font-medium ${answerColor(chip.value)}`}>{chip.text}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The tenant's own words.
 *
 * SECURITY: `comment` is free text from an unauthenticated submitter and is
 * stored verbatim. It is rendered here as a React TEXT CHILD, which React
 * escapes. Never dangerouslySetInnerHTML on this value, and never
 * .replace(/\n/g, "<br>") — line breaks come from whitespace-pre-wrap below,
 * precisely so no one ever needs to reach for raw HTML to get them.
 */
export function FeedbackComment({ comment }: { comment: string | null }) {
  // Omitted entirely when absent. "No comment" is noise on a page that will
  // mostly have none.
  if (!comment) return null;
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2 text-xs text-foreground mt-2 whitespace-pre-wrap break-words">
      {comment}
    </div>
  );
}

/**
 * The block shown on a tenant's own record, inside the Tenant History dialog.
 * A summary fact about the whole stay, so it sits above the timeline rather
 * than inside it, where it would scroll away.
 */
export function FeedbackSummary({ feedback }: { feedback: TenantFeedback }) {
  return (
    <div
      className={
        "rounded-xl border p-3 " +
        (feedback.needs_attention
          ? "border-rose-500/30 bg-rose-500/[0.06]"
          : "border-sidebar-border bg-card/50")
      }
    >
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Checkout Feedback
      </p>
      <FeedbackAnswerChips feedback={feedback} />
      <FeedbackComment comment={feedback.comment} />
    </div>
  );
}
