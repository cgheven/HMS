"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { saveBillingSettings } from "@/app/actions/settings";

export function BillingDateForm({
  initialAnchorDay,
  initialSeparate = true,
  readOnly = false,
  readOnlyNote,
  simple = false,
  onSaved,
}: {
  initialAnchorDay: number | null | undefined;
  initialSeparate?: boolean;
  readOnly?: boolean;
  readOnlyNote?: ReactNode;
  /** Onboarding: hide the merged/separate toggle (defaults to separate, the
   *  recommended mode); the advanced choice stays in Settings. */
  simple?: boolean;
  /** Called after a successful save (e.g. to tick an onboarding step). */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [anchorDay, setAnchorDay] = useState<string>(
    initialAnchorDay === null || initialAnchorDay === undefined ? "" : String(initialAnchorDay)
  );
  const [separate, setSeparate] = useState<boolean>(!!initialSeparate);
  const [saving, setSaving] = useState(false);

  const enabled = anchorDay.trim() !== "";
  const dayNum = Number(anchorDay);
  const dayInvalid = enabled && (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31);

  async function save() {
    if (dayInvalid) {
      toast({ title: "Enter a day between 1 and 31, or leave it empty.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const result = await saveBillingSettings({
      billing_anchor_day: enabled ? Math.trunc(dayNum) : null,
      bill_leftover_days_separately: separate,
    });
    setSaving(false);
    if (result.success) {
      toast({ title: "Billing date saved" });
      onSaved?.();
      router.refresh();
    } else {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    }
  }

  return (
    <fieldset disabled={readOnly} className="space-y-5 min-w-0">
      {readOnly && readOnlyNote}

      <div className="space-y-2">
        <Label htmlFor="billing-anchor-day" className="text-sm font-semibold">Billing date (day of month)</Label>
        <div className="flex items-center gap-3">
          <Input
            id="billing-anchor-day"
            type="number"
            min="1"
            max="31"
            step="1"
            inputMode="numeric"
            placeholder="Off"
            value={anchorDay}
            onChange={(e) => setAnchorDay(e.target.value)}
            className="h-9 w-28 text-center"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to bill each resident on their own join date (default). Set a
            day (e.g. 1) to bill <span className="font-medium">every resident on that day</span>.
          </p>
        </div>
        {dayInvalid && <p className="text-xs text-destructive">Day must be between 1 and 31.</p>}
      </div>

      <div className="rounded-xl border border-sidebar-border p-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          When someone joins mid-month, they are charged only for the days they actually
          stayed that month (at their per-day rate entered on admission), then a full
          month from the billing date onward.{!enabled && " This takes effect once you set a billing date above."}
          {simple && " You can fine-tune how the leftover days are billed later in Settings."}
        </p>
        {!simple && (
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={separate}
            onChange={(e) => setSeparate(e.target.checked)}
            className="w-4 h-4 mt-0.5 accent-amber shrink-0"
          />
          <span className="text-sm">
            Bill the leftover days separately
            <span className="block text-xs text-muted-foreground mt-0.5">
              On (recommended): the leftover days get their own bill in the join month
              — so you can collect the deposit and joining payment at move-in, and the
              resident shows up in that month. Off: the leftover days are merged into
              the first full-month bill, so nothing is billed until the billing date.
            </span>
          </span>
        </label>
        )}
      </div>

      {!readOnly && (
        <Button onClick={save} disabled={saving || dayInvalid} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save billing date
        </Button>
      )}
    </fieldset>
  );
}
