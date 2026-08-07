"use client";

import { useMemo, useState } from "react";
import { MessageSquareHeart } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/utils";
import { feedbackBucket, VERDICT_LABEL, type FeedbackBucket } from "@/lib/feedback-options";
import { FeedbackAnswerChips, FeedbackComment } from "./feedback-summary";
import type { TenantFeedback } from "@/types";

interface Props {
  feedback: TenantFeedback[];
}

const BUCKET_BADGE: Record<FeedbackBucket, string> = {
  attention: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  mixed: "text-amber border-amber/30 bg-amber/10",
  happy: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
};

function EmptyBlock({ line1, line2 }: { line1: string; line2?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground rounded-2xl border border-sidebar-border bg-card">
      <MessageSquareHeart className="w-10 h-10 opacity-20" />
      <p className="text-sm">{line1}</p>
      {line2 && <p className="text-xs">{line2}</p>}
    </div>
  );
}

function FeedbackCard({ f }: { f: TenantFeedback }) {
  const bucket = feedbackBucket(f);
  const name = f.tenant?.full_name ?? "Former tenant";
  const room = f.tenant?.room?.room_number;
  const left = f.tenant?.check_out;

  return (
    <div
      className={
        "rounded-xl border p-4 transition-colors " +
        (f.needs_attention
          ? "border-rose-500/30 bg-rose-500/[0.06]"
          : "border-sidebar-border bg-card/50 hover:border-white/10")
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={
            "flex items-center justify-center w-8 h-8 rounded-full shrink-0 " +
            (f.needs_attention
              ? "bg-rose-500/10 border border-rose-500/20"
              : "bg-amber/10 border border-amber/20")
          }
        >
          <span className={`text-xs font-bold ${f.needs_attention ? "text-rose-400" : "text-amber"}`}>
            {name.charAt(0).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-foreground truncate">{name}</p>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${BUCKET_BADGE[bucket]}`}>
              {VERDICT_LABEL[bucket]}
            </span>
          </div>

          <p className="text-xs text-muted-foreground mt-0.5">
            {[room ? `Room ${room}` : null, left ? `Left ${formatDate(left)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>

          <div className="mt-2">
            <FeedbackAnswerChips feedback={f} />
          </div>

          <FeedbackComment comment={f.comment} />
        </div>
      </div>
    </div>
  );
}

export function FeedbackClient({ feedback }: Props) {
  const [tab, setTab] = useState<"all" | FeedbackBucket>("all");

  const buckets = useMemo(
    () => feedback.map((f) => ({ f, bucket: feedbackBucket(f) })),
    [feedback]
  );

  const counts = useMemo(
    () => ({
      attention: buckets.filter((b) => b.bucket === "attention").length,
      mixed: buckets.filter((b) => b.bucket === "mixed").length,
      happy: buckets.filter((b) => b.bucket === "happy").length,
    }),
    [buckets]
  );

  const recommends = feedback.filter((f) => f.recommend === "yes").length;
  const filtered = tab === "all" ? feedback : buckets.filter((b) => b.bucket === tab).map((b) => b.f);

  const header = (
    <div>
      <h1 className="text-3xl font-serif font-normal tracking-tight">Feedback</h1>
      <p className="text-muted-foreground text-sm mt-1">What tenants said when they checked out</p>
    </div>
  );

  // A brand-new hostel gets the header and one honest block. No stat tiles
  // (three zeros reads as broken) and no tabs (four "(0)" tabs read as broken
  // too). The second line exists only because without it the owner has no way
  // of knowing what would ever make something appear here.
  if (feedback.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <EmptyBlock
          line1="No feedback yet"
          line2="Tenants get a feedback link on WhatsApp when they check out. Answers show up here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {header}

      {/* "12 of 18", never "67%". With numbers this small a percentage lies —
          2 of 3 is not "67% satisfaction", and it will be read as one. */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Responses", value: `${feedback.length}`, color: "text-foreground" },
          { label: "Would recommend you", value: `${recommends} of ${feedback.length}`, color: "text-emerald-400" },
          { label: "Needs attention", value: `${counts.attention}`, color: "text-rose-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* The three buckets are mutually exclusive AND exhaustive, so the counts
          add up to All — which the owner will check, and which is the one thing
          that stops a filter feeling arbitrary. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | FeedbackBucket)}>
        <TabsList>
          <TabsTrigger value="all">All ({feedback.length})</TabsTrigger>
          <TabsTrigger value="attention">Needs attention ({counts.attention})</TabsTrigger>
          <TabsTrigger value="mixed">Mixed ({counts.mixed})</TabsTrigger>
          <TabsTrigger value="happy">Happy ({counts.happy})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab}>
          {filtered.length === 0 ? (
            <EmptyBlock line1="No feedback in this filter." />
          ) : (
            <div className="grid gap-3">
              {filtered.map((f) => (
                <FeedbackCard key={f.id} f={f} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
