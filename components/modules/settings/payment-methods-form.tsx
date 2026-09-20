"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { MessageCircle, Plus, Trash2, ShieldCheck, Save, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { savePaymentRecoverySettings } from "@/app/actions/settings";
import { defaultReminderTemplate, buildReminderMessage } from "@/lib/whatsapp-reminder";
import type { PaymentMethodAccount } from "@/types";

function uid() { return Math.random().toString(36).slice(2, 10); }

export function PaymentMethodsForm({
  initialPaymentMethods, initialReminderTemplate, hostelName, country,
  whatsappEnabled = false, readOnly = false, readOnlyNote, onSaved, bare = false,
}: {
  initialPaymentMethods: PaymentMethodAccount[];
  initialReminderTemplate?: string | null;
  hostelName: string;
  /** Hostel ISO country — drives the default reminder greeting (PK "Assalam o Alaikum", else "Hi"). */
  country?: string | null;
  whatsappEnabled?: boolean;
  readOnly?: boolean;
  readOnlyNote?: ReactNode;
  onSaved?: () => void;
  /** Render just the content, without the outer Card/header (for embedding, e.g. the welcome wizard). */
  bare?: boolean;
}) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodAccount[]>(
    () => (initialPaymentMethods ?? []).map((m) => ({ ...m, id: m.id || uid() }))
  );
  const [reminderTemplate, setReminderTemplate] = useState(initialReminderTemplate ?? defaultReminderTemplate(country));
  const [savingRecovery, setSavingRecovery] = useState(false);

  function addPaymentMethod() {
    setPaymentMethods((prev) => [...prev, { id: uid(), label: "", account_number: "" }]);
  }
  function updatePaymentMethod(id: string, patch: Partial<PaymentMethodAccount>) {
    setPaymentMethods((prev) => prev.map((m) => m.id === id ? { ...m, ...patch } : m));
  }
  function removePaymentMethod(id: string) {
    setPaymentMethods((prev) => prev.filter((m) => m.id !== id));
  }

  async function saveRecoverySettings() {
    setSavingRecovery(true);
    const result = await savePaymentRecoverySettings({
      payment_methods: paymentMethods.filter((m) => m.label.trim()),
      reminder_template: reminderTemplate,
    });
    setSavingRecovery(false);
    if (result.success) { toast({ title: "Payment recovery settings saved" }); onSaved?.(); }
    else toast({ title: "Error", description: result.error, variant: "destructive" });
  }

  const recoveryPreview = buildReminderMessage({
    template: reminderTemplate,
    country,
    tenantName: "Ali Raza",
    amount: 15000,
    month: new Date().toLocaleDateString("en-PK", { month: "long", year: "numeric" }),
    hostelName: hostelName || "Your Hostel",
    accounts: paymentMethods,
  });

  const bodyEl = (
        <>
          <fieldset disabled={readOnly} className="space-y-6 min-w-0">

          {/* Payment Methods */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-semibold">Payment Methods</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Bank accounts, JazzCash, EasyPaisa etc. shown in reminders.</p>
              </div>
              <Button size="sm" variant="outline" onClick={addPaymentMethod} className="gap-1.5 h-8 shrink-0">
                <Plus className="w-3.5 h-3.5" /> Add Method
              </Button>
            </div>
            {paymentMethods.length === 0 ? (
              <div className="rounded-xl border border-dashed border-sidebar-border p-4 text-center">
                <ShieldCheck className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No payment methods added yet.</p>
                <p className="text-xs text-muted-foreground">Add bank account, JazzCash, or EasyPaisa details.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {paymentMethods.map((m) => (
                  <div key={m.id} className="rounded-xl border border-sidebar-border bg-card/50 p-3">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2">
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Bank / Method</p>
                        <Input
                          placeholder="e.g. HBL, JazzCash"
                          value={m.label}
                          onChange={(e) => updatePaymentMethod(m.id, { label: e.target.value })}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Account Title</p>
                        <Input
                          placeholder="Account holder name"
                          value={m.account_title ?? ""}
                          onChange={(e) => updatePaymentMethod(m.id, { account_title: e.target.value })}
                          className="h-9 text-sm"
                        />
                      </div>
                      {/* Spacer matching the delete button below, so both rows share
                          the same column tracks and the fields line up vertically. */}
                      <div className="w-9 shrink-0" aria-hidden />
                    </div>
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Account Number</p>
                        <Input
                          placeholder="Account / phone number"
                          value={m.account_number ?? ""}
                          onChange={(e) => updatePaymentMethod(m.id, { account_number: e.target.value })}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">IBAN <span className="normal-case">(optional)</span></p>
                        <Input
                          placeholder="PK00XXXX..."
                          value={m.iban ?? ""}
                          onChange={(e) => updatePaymentMethod(m.id, { iban: e.target.value })}
                          className="h-9 text-sm"
                        />
                      </div>
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => removePaymentMethod(m.id)}
                        className="h-9 w-9 text-muted-foreground hover:text-rose-400 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Message Template */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">WhatsApp Reminder Template</Label>
            <textarea
              value={reminderTemplate}
              onChange={(e) => setReminderTemplate(e.target.value)}
              rows={9}
              className="w-full rounded-xl border border-sidebar-border bg-card p-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 resize-y"
            />
            <p className="text-[11px] text-muted-foreground">
              Placeholders:&nbsp;
              {["{name}", "{amount}", "{month}", "{hostel}", "{accounts}", "{ac_maintenance}", "{registration_fee}"].map((p) => (
                <code key={p} className="text-foreground mx-0.5 px-1 py-0.5 rounded bg-white/5">{p}</code>
              ))}
            </p>
          </div>

          {/* Auto Reminders status */}
          {whatsappEnabled && (
          <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] p-3">
            <p className="text-xs font-semibold text-emerald-400">Auto WhatsApp Reminders — Active</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Each tenant is automatically reminded, using the template above, on the day-of-month they checked in —
              only while still pending, overdue, or partially paid for the current month, and only while still active.
              Checked-out tenants are never reminded. Separate from the manual &quot;Send Reminder&quot; button on the
              Payments page, which is unaffected.
            </p>
          </div>
          )}

          {/* Live Preview */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Live Preview</Label>
            <div className="rounded-xl border border-[#25D366]/15 bg-[#25D366]/[0.03] p-4 max-w-md">
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                <svg className="w-3 h-3 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                WhatsApp message preview
              </p>
              <pre className="whitespace-pre-wrap text-sm font-sans text-foreground leading-relaxed">{recoveryPreview}</pre>
            </div>
            {paymentMethods.length === 0 && reminderTemplate.includes("{accounts}") && (
              <p className="text-[11px] text-amber flex items-center gap-1">
                ⚠ Template includes <code className="px-1 bg-white/5 rounded">{"{accounts}"}</code> but no payment methods added — it will be blank in messages.
              </p>
            )}
          </div>

          </fieldset>
          {!readOnly ? (
            <Button onClick={saveRecoverySettings} disabled={savingRecovery} className="gap-2">
              {savingRecovery ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Recovery Settings
            </Button>
          ) : readOnlyNote}
        </>
  );
  if (bare) return <div className="space-y-6 min-w-0">{bodyEl}</div>;
  return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Payment Recovery</CardTitle>
          </div>
          <CardDescription>
            Bank accounts &amp; WhatsApp reminder template sent to tenants with unpaid rent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">{bodyEl}</CardContent>
      </Card>
  );
}
