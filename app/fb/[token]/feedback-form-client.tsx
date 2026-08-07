"use client";

import { useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Home, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitTenantFeedbackAction } from "@/app/actions/feedback";
import {
  FEEDBACK_COMMENT_MAX_LENGTH,
  FOOD_LABELS,
  RATING_LABELS,
  RATING_OPTIONS,
  RECOMMEND_LABELS,
  RECOMMEND_OPTIONS,
  ROOMMATE_LABELS,
} from "@/lib/feedback-options";

interface Props {
  token: string;
  hostelName: string;
}

type QuestionKey = "food" | "cleanliness" | "staff" | "roommate" | "recommend";

interface Question {
  key: QuestionKey;
  text: string;
  options: readonly string[];
  labels: Record<string, string>;
  columns: 3 | 4;
  // The opt-out sits on its own full-width row BELOW the scale. It is not a
  // rating — inside the row it would read as being worse than Poor, and it
  // would make the four-pill scale uneven.
  optOut?: { value: string; label: string };
}

const QUESTIONS: Question[] = [
  {
    key: "food",
    text: "How was the food?",
    options: RATING_OPTIONS,
    labels: RATING_LABELS as Record<string, string>,
    columns: 4,
    optOut: { value: "no_meals", label: FOOD_LABELS.no_meals },
  },
  {
    key: "cleanliness",
    text: "How was the cleanliness?",
    options: RATING_OPTIONS,
    labels: RATING_LABELS as Record<string, string>,
    columns: 4,
  },
  {
    key: "staff",
    text: "How was the hostel staff?",
    options: RATING_OPTIONS,
    labels: RATING_LABELS as Record<string, string>,
    columns: 4,
  },
  {
    key: "roommate",
    text: "How was your roommate?",
    options: RATING_OPTIONS,
    labels: RATING_LABELS as Record<string, string>,
    columns: 4,
    optOut: { value: "no_roommate", label: ROOMMATE_LABELS.no_roommate },
  },
  {
    key: "recommend",
    text: "Would you recommend us to your circle?",
    options: RECOMMEND_OPTIONS,
    labels: RECOMMEND_LABELS as Record<string, string>,
    columns: 3,
  },
];

export function FeedbackFormClient({ token, hostelName }: Props) {
  const [answers, setAnswers] = useState<Partial<Record<QuestionKey, string>>>({});
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [spent, setSpent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [prompting, setPrompting] = useState<QuestionKey | null>(null);
  const cardRefs = useRef<Partial<Record<QuestionKey, HTMLDivElement | null>>>({});

  const unanswered = QUESTIONS.filter((q) => !answers[q.key]);
  const answeredCount = QUESTIONS.length - unanswered.length;

  function scrollTo(key: QuestionKey) {
    cardRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pick(q: Question, value: string) {
    setAnswers((prev) => ({ ...prev, [q.key]: value }));
    if (prompting === q.key) setPrompting(null);

    const next = QUESTIONS.find((other) => other.key !== q.key && !answers[other.key]);
    if (next) {
      // The tapped answer stays on screen as it moves up, so the tenant sees
      // their choice register rather than having the question vanish.
      window.setTimeout(() => scrollTo(next.key), 120);
    }
  }

  async function handleSubmit() {
    if (unanswered.length > 0) {
      const first = unanswered[0];
      setPrompting(first.key);
      scrollTo(first.key);
      return;
    }

    setLoading(true);
    setFailed(false);
    const result = await submitTenantFeedbackAction(token, {
      food: answers.food!,
      cleanliness: answers.cleanliness!,
      staff: answers.staff!,
      roommate: answers.roommate!,
      recommend: answers.recommend!,
      comment: comment.trim() || null,
    });
    setLoading(false);

    // Three outcomes, and only one of them leaves this page. "retry" means the
    // request never reached the point of judging the token, so the form stays
    // exactly as the tenant filled it in and the button works again. It is not
    // an oracle: every token state — used, expired, revoked, never existed —
    // still collapses into the same single "spent" screen.
    if (result.ok) setSubmitted(true);
    else if (result.retry) setFailed(true);
    else setSpent(true);
  }

  if (submitted || spent) {
    // IDENTICAL for every answer set — a tenant who marked things Poor sees
    // exactly this, and is never told the owner has been emailed. Being told
    // "the owner has been notified" reads as exposure to someone who has
    // already left, and softens what they say next time.
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-5 animate-fade-in">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-serif font-normal tracking-tight text-foreground">
              {submitted ? "Thank you — that's all we needed." : "You've already shared your feedback"}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {submitted
                ? `${hostelName} has your feedback.`
                : `Thanks — ${hostelName} has your answers. This link only works once.`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-sidebar-border bg-sidebar/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 min-h-14 py-2.5 flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20 shrink-0">
            <Home className="w-4 h-4 text-amber" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground leading-snug">{hostelName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Private feedback</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground">
            How was your stay?
          </h1>
          {/* No greeting by name, deliberately: a WhatsApp link gets forwarded,
              and "Hi Ahmed" would tell whoever received it who moved out of
              where. The tenant already knows who they are. */}
          {/* Makes no promise either way about publication — the earlier
              "nothing is posted publicly" had to go once feedback became
              publishable, and promising publication instead would be the same
              broken promise pointing the other way.
              The staff exclusion stays: question 3 asks the tenant to rate the
              staff, and that line is what makes an honest answer safe to give. */}
          <p className="text-muted-foreground text-sm mt-1.5">
            Six quick questions. We use your feedback to improve {hostelName} for future
            residents. Hostel staff cannot see your answers.
          </p>
        </div>

        {/* Answering is the only thing that moves this. Five questions is short,
            but a tenant on a phone cannot see that until they scroll — the bar
            says "nearly done" before they have to find out. */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              {answeredCount} of {QUESTIONS.length} answered
            </span>
            {answeredCount === QUESTIONS.length && (
              <span className="text-xs font-semibold text-amber">Ready to send</span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber/70 to-amber transition-all duration-500 ease-out"
              style={{ width: `${(answeredCount / QUESTIONS.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="space-y-4">
          {QUESTIONS.map((q) => {
            const selected = answers[q.key];
            return (
              <div
                key={q.key}
                ref={(el) => {
                  cardRefs.current[q.key] = el;
                }}
                className={
                  "rounded-2xl border p-5 space-y-3.5 scroll-mt-4 transition-colors duration-300 " +
                  (selected
                    ? "border-amber/25 bg-gradient-to-b from-amber/[0.04] to-transparent"
                    : "border-sidebar-border bg-card")
                }
              >
                <p className="text-[15px] font-semibold text-foreground leading-snug">{q.text}</p>

                {/* No colour coding. Poor is not red and Excellent is not green:
                    colouring an ordinal scale pressures an unhappy tenant back
                    toward the middle, which defeats the whole reason the scale
                    reads Poor/Fair/Good/Excellent. Colour appears on the owner
                    side, where it is analysis rather than persuasion. */}
                <div className={q.columns === 4 ? "grid grid-cols-4 gap-1.5" : "grid grid-cols-3 gap-1.5"}>
                  {q.options.map((opt) => {
                    const checked = selected === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => pick(q, opt)}
                        aria-pressed={checked}
                        className={
                          "rounded-xl border px-2 py-3.5 text-[13px] font-semibold text-center " +
                          "transition-all duration-150 active:scale-[0.96] " +
                          (checked
                            // Solid fill, not a tint. The old 6%-opacity wash was
                            // invisible on a phone in daylight — a tenant could not
                            // tell what they had picked.
                            ? "border-amber bg-amber text-background shadow-lg shadow-amber/20 scale-[1.02]"
                            : "border-sidebar-border bg-white/[0.02] text-foreground hover:border-amber/40 hover:bg-white/[0.04]")
                        }
                      >
                        {q.labels[opt] ?? opt}
                      </button>
                    );
                  })}
                </div>

                {q.optOut && (
                  <button
                    type="button"
                    onClick={() => pick(q, q.optOut!.value)}
                    className={
                      "w-full rounded-xl border px-3 py-3 text-center transition-all duration-150 active:scale-[0.98] " +
                      (selected === q.optOut.value
                        ? "border-amber bg-amber text-background text-[13px] font-semibold shadow-lg shadow-amber/20"
                        : "border-sidebar-border bg-white/[0.02] hover:border-amber/40 text-xs text-muted-foreground")
                    }
                  >
                    {q.optOut.label}
                  </button>
                )}

                {prompting === q.key && (
                  <p className="text-xs text-amber mt-1">Pick one to continue.</p>
                )}
              </div>
            );
          })}

          <div className="rounded-2xl border border-sidebar-border bg-card p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">
              Anything we could do better?{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </p>
            <textarea
              rows={4}
              value={comment}
              maxLength={FEEDBACK_COMMENT_MAX_LENGTH}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Type here if you want to. You can skip this."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t border-sidebar-border px-4 py-3">
        <div className="max-w-2xl mx-auto">
          {/* Never disabled on unanswered questions: handleSubmit scrolls to the
              first gap and says "Pick one to continue". A dead button leaves a
              tenant tapping with no idea what is wrong. */}
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className={
              "w-full h-13 py-4 text-base font-semibold gap-2 rounded-2xl border-0 " +
              "transition-all duration-200 active:scale-[0.98] " +
              (answeredCount === QUESTIONS.length
                ? "bg-gradient-to-r from-amber to-amber/85 text-background shadow-xl shadow-amber/25 hover:shadow-amber/40"
                : "bg-white/[0.06] text-muted-foreground hover:bg-white/[0.09]")
            }
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending…
              </>
            ) : answeredCount === QUESTIONS.length ? (
              <>
                Send my feedback
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              `${QUESTIONS.length - answeredCount} question${QUESTIONS.length - answeredCount === 1 ? "" : "s"} left`
            )}
          </Button>
          {failed ? (
            <p className="text-xs text-amber text-center mt-1.5">
              We couldn&apos;t send that just now — nothing was lost, please tap again.
            </p>
          ) : unanswered.length > 0 ? (
            <p className="text-xs text-muted-foreground text-center mt-1.5">
              {unanswered.length} question{unanswered.length === 1 ? "" : "s"} still to answer
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
