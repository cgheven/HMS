"use client";
import { useState } from "react";
import { Home, CheckCircle2, Loader2, Phone, User, MessageSquare, AlertCircle } from "lucide-react";
import { submitComplaintAction } from "@/app/actions/complaints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicHostelComplaintInfo, ComplaintCategory } from "@/types";

interface Props {
  hostel: PublicHostelComplaintInfo;
  complaintCode: string;
}

const CATEGORY_OPTIONS: { value: ComplaintCategory; label: string; icon: string }[] = [
  { value: "kitchen", label: "Kitchen", icon: "🍽️" },
  { value: "staff", label: "Staff", icon: "🧑‍💼" },
  { value: "cleanliness", label: "Cleanliness", icon: "🧹" },
  { value: "maintenance", label: "Maintenance", icon: "🔧" },
  { value: "security", label: "Security", icon: "🔒" },
  { value: "other", label: "Other", icon: "📋" },
];

// Distinguishes the "we couldn't verify you" identity mismatch from any other
// server error, so it can be surfaced with its own prominent, non-generic UI.
const VERIFICATION_ERROR_MARKER = "couldn't verify an active tenant";

export function ComplaintFormClient({ hostel, complaintCode }: Props) {
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    category: "" as "" | ComplaintCategory,
    description: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVerificationError(false);

    if (!form.full_name.trim()) { setError("Full name is required."); return; }
    if (!form.phone.trim()) { setError("Phone number is required."); return; }
    if (!form.category) { setError("Please select a category."); return; }
    if (!form.description.trim()) { setError("Please describe the issue."); return; }

    setLoading(true);
    const result = await submitComplaintAction(
      complaintCode,
      form.full_name,
      form.phone,
      form.category,
      form.description
    );
    setLoading(false);

    if (!result.error) {
      setSubmitted(true);
      return;
    }

    if (result.error.includes(VERIFICATION_ERROR_MARKER)) {
      setVerificationError(true);
    } else {
      setError(result.error);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-5 animate-fade-in">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-serif font-normal tracking-tight text-foreground">
              Complaint Submitted!
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Thanks, {form.full_name.trim().split(" ")[0]} — the team at{" "}
              <span className="font-semibold text-foreground">{hostel.name}</span> has been notified.
            </p>
          </div>
          <div className="rounded-xl border border-sidebar-border bg-card p-4 text-left space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What happens next?</p>
            {[
              "The hostel team reviews your complaint",
              "They'll look into the issue and take action",
              "The complaint is marked resolved once fixed",
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber/10 border border-amber/20 text-amber text-xs font-bold shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-sidebar-border bg-sidebar/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20">
            <Home className="w-4 h-4 text-amber" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-none">{hostel.name}</p>
            {(hostel.city || hostel.area) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {[hostel.area, hostel.city].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground">
            Report an Issue
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            Let the hostel team know about a problem — they'll follow up and resolve it.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" /> Your Details
            </h2>

            <div className="space-y-1.5">
              <Label>Full Name <span className="text-rose-400">*</span></Label>
              <Input
                placeholder="Ahmed Khan"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                Phone Number <span className="text-rose-400">*</span>
              </Label>
              <Input
                placeholder="0300 0000000"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Used to confirm you're a current resident — please match what the hostel has on file.
            </p>
          </div>

          <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" /> The Issue
            </h2>

            <div className="space-y-1.5">
              <Label>Category <span className="text-rose-400">*</span></Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CATEGORY_OPTIONS.map((opt) => {
                  const checked = form.category === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, category: opt.value })}
                      className={
                        "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors " +
                        (checked
                          ? "border-amber/40 bg-amber/[0.06]"
                          : "border-sidebar-border hover:border-muted-foreground/30")
                      }
                    >
                      <span className="text-lg shrink-0">{opt.icon}</span>
                      <span className="text-sm font-medium text-foreground truncate">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description <span className="text-rose-400">*</span></Label>
              <textarea
                rows={5}
                placeholder="Tell us what happened…"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>
          </div>

          {verificationError && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3.5 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-rose-400">We couldn't verify your details</p>
                <p className="text-xs text-rose-400/90 mt-1 leading-relaxed">
                  We couldn't match an active tenant with that phone number. Please double-check it's
                  entered exactly as on file with the hostel, and try again — or contact the hostel
                  directly if the problem continues.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-amber text-background hover:bg-amber/90 font-semibold h-11 text-base gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit Complaint"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
