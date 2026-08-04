"use client";

import { useState, useTransition, useMemo } from "react";
import {
  Building2, Plus, Search, RefreshCw, Users, Home,
  GitBranch, Trash2, Copy, Check, MessageCircle, AlertTriangle,
  Wallet, CheckCircle2, Clock, Zap, Download, Pencil, RotateCcw, Mail,
} from "lucide-react";
import {
  listAllHostels, createHostelForClient, addBranchToOwner,
  deleteHostel, deleteClient, setWhatsappEnabled, type SuperHostelRow,
} from "@/app/actions/super-admin";
import {
  getClientBilling, setClientBilling, generateInvoiceNow, markInvoiceStatus, updateInvoiceAmount, sendInvoiceEmail,
  resetClientInvoices, updateOwnerPhone,
} from "@/app/actions/client-billing";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { STANDARD_CLIENT_MONTHLY_RATE, ONBOARDING_FEE, clientDiscountPct, listSubtotalFromDiscount } from "@/lib/pricing";
import type { ClientBilling, PlatformInvoice } from "@/types";

const emptyOwner = { ownerEmail: "", ownerName: "", ownerPhone: "" };

// wa.me needs a full international number — a local "03XX…" number (how Pakistani
// numbers are normally typed/stored) has to become "923XX…", or the chat never opens.
function toWhatsAppPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("0") ? `92${digits.slice(1)}` : digits;
}

interface Credentials { name: string; email: string; password: string; phone: string; branches: number }
interface Props { initialHostels: SuperHostelRow[] }

export function SuperAdminHostelsClient({ initialHostels }: Props) {
  const [hostels, setHostels] = useState<SuperHostelRow[]>(initialHostels);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // ── New Client ─────────────────────────────────────────────────────────────
  const [newOpen, setNewOpen] = useState(false);
  const [ownerForm, setOwnerForm] = useState(emptyOwner);
  const [primaryBranchName, setPrimaryBranchName] = useState("");
  const [branchCount, setBranchCount] = useState(1);

  // ── Credentials modal ──────────────────────────────────────────────────────
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [copied, setCopied] = useState<"email" | "pass" | null>(null);

  function copy(text: string, field: "email" | "pass") {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  }

  function shareWhatsApp(c: Credentials) {
    const origin = window.location.origin;
    const msg =
      `Assalam o Alaikum ${c.name}! 👋\n\n` +
      `Your Hostel Management System (HMS) account has been created.\n\n` +
      `🔐 *Login Details:*\n` +
      `• URL: ${origin}/login\n` +
      `• Email: ${c.email}\n` +
      `• Password: ${c.password}\n\n` +
      `You have *${c.branches} branch${c.branches > 1 ? "es" : ""}* provisioned. ` +
      `You can rename them from Settings after logging in.\n\n` +
      `Welcome aboard! 🏠`;
    // Open directly to that chat. Falls back to contact picker if no phone was provided.
    const phone = toWhatsAppPhone(c.phone);
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleCreate() {
    startTransition(async () => {
      const primary = primaryBranchName.trim() || "Main Branch";
      const branches = [
        { name: primary },
        ...Array.from({ length: branchCount - 1 }, (_, i) => ({ name: `Branch ${i + 2}` })),
      ];
      const res = await createHostelForClient({
        ownerEmail: ownerForm.ownerEmail,
        ownerName: ownerForm.ownerName,
        ownerPhone: ownerForm.ownerPhone,
        branches,
      });
      if (res.error) {
        toast({ title: "Failed to create", description: res.error, variant: "destructive" });
        return;
      }
      setNewOpen(false);
      setCreds({ name: ownerForm.ownerName, email: ownerForm.ownerEmail, password: res.password!, phone: ownerForm.ownerPhone, branches: branchCount });
      setOwnerForm(emptyOwner);
      setPrimaryBranchName("");
      setBranchCount(1);
      refresh();
    });
  }

  // ── Add Branch ─────────────────────────────────────────────────────────────
  const [branchOpen, setBranchOpen] = useState(false);
  const [targetOwner, setTargetOwner] = useState<{ id: string; name: string } | null>(null);
  const [newBranch, setNewBranch] = useState({ name: "", city: "", address: "" });

  function openAddBranch(ownerId: string, ownerName: string) {
    setTargetOwner({ id: ownerId, name: ownerName });
    setNewBranch({ name: "", city: "", address: "" });
    setBranchOpen(true);
  }

  function handleAddBranch() {
    if (!targetOwner) return;
    startTransition(async () => {
      const res = await addBranchToOwner({ ownerId: targetOwner.id, name: newBranch.name, city: newBranch.city, address: newBranch.address });
      if (res.error) {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "Branch added" });
        setBranchOpen(false);
        refresh();
      }
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ type: "branch" | "client"; id: string; name: string } | null>(null);

  function handleDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const res = deleteTarget.type === "branch"
        ? await deleteHostel(deleteTarget.id)
        : await deleteClient(deleteTarget.id);
      if (res.error) {
        toast({ title: "Cannot delete", description: res.error, variant: "destructive" });
      } else {
        toast({ title: `${deleteTarget.type === "branch" ? "Branch" : "Client"} deleted` });
        setDeleteTarget(null);
        refresh();
      }
    });
  }

  // ── Billing ────────────────────────────────────────────────────────────────
  const [billingTarget, setBillingTarget] = useState<{ ownerId: string; ownerName: string } | null>(null);
  const [billingBranchCount, setBillingBranchCount] = useState(1);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billing, setBilling] = useState<ClientBilling | null>(null);
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
  const [ownerPhone, setOwnerPhone] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [billingForm, setBillingForm] = useState({
    cycle: "annual" as "monthly" | "annual",
    monthlyRate: "",
    waiveOnboarding: true,
    notes: "",
    startDate: new Date().toISOString().slice(0, 10),
  });

  async function openBilling(ownerId: string, ownerName: string, branches: number) {
    setBillingTarget({ ownerId, ownerName });
    setBillingBranchCount(branches);
    setBillingLoading(true);
    const res = await getClientBilling(ownerId);
    if (res.error) {
      toast({ title: "Error", description: res.error, variant: "destructive" });
    } else {
      setBilling(res.billing ?? null);
      setInvoices(res.invoices ?? []);
      setOwnerPhone(res.ownerPhone ?? null);
      setPhoneInput(res.ownerPhone ?? "");
      const cycle = res.billing?.billing_cycle ?? "annual";
      setBillingForm({
        cycle,
        monthlyRate: res.billing?.monthly_rate != null ? String(res.billing.monthly_rate) : "",
        waiveOnboarding: res.billing?.waive_onboarding ?? (cycle === "annual"),
        notes: res.billing?.pricing_notes ?? "",
        startDate: res.billing?.next_invoice_date ?? new Date().toISOString().slice(0, 10),
      });
    }
    setBillingLoading(false);
  }

  function handleSaveBilling() {
    if (!billingTarget) return;
    const rate = parseFloat(billingForm.monthlyRate);
    if (!rate || rate <= 0) {
      toast({ title: "Enter a valid monthly rate", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      const res = await setClientBilling({
        ownerId: billingTarget.ownerId,
        billingCycle: billingForm.cycle,
        monthlyRate: rate,
        waiveOnboarding: billingForm.waiveOnboarding,
        pricingNotes: billingForm.notes,
        nextInvoiceDate: billingForm.startDate,
      });
      if (res.error) {
        toast({ title: "Failed to save", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "Billing saved" });
        openBilling(billingTarget.ownerId, billingTarget.ownerName, billingBranchCount);
      }
    });
  }

  function handleGenerateInvoice() {
    if (!billingTarget) return;
    const rate = parseFloat(billingForm.monthlyRate);
    if (!rate || rate <= 0) {
      toast({ title: "Enter a valid monthly rate", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      // Save whatever's currently typed FIRST — otherwise this would silently generate
      // using the last-saved rate and discard any unsaved edit in the form.
      const saveRes = await setClientBilling({
        ownerId: billingTarget.ownerId,
        billingCycle: billingForm.cycle,
        monthlyRate: rate,
        waiveOnboarding: billingForm.waiveOnboarding,
        pricingNotes: billingForm.notes,
        nextInvoiceDate: billingForm.startDate,
      });
      if (saveRes.error) {
        toast({ title: "Failed to save", description: saveRes.error, variant: "destructive" });
        return;
      }
      const res = await generateInvoiceNow(billingTarget.ownerId);
      if (res.error) {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
      } else if (!res.generated) {
        toast({ title: "Not generated", description: res.reason });
      } else {
        toast({ title: "Saved and invoice generated" });
        openBilling(billingTarget.ownerId, billingTarget.ownerName, billingBranchCount);
      }
    });
  }

  function invoicePricingInfo(inv: PlatformInvoice) {
    const months = inv.billing_cycle === "annual" ? 12 : 1;
    const actualSubtotal = Number(inv.monthly_rate) * months * inv.branch_count;
    const listSubtotal = listSubtotalFromDiscount(actualSubtotal, Number(inv.discount_pct));
    const standardOnboarding = inv.is_first_invoice ? ONBOARDING_FEE : 0;
    const listTotal = listSubtotal + standardOnboarding;
    const totalSavings = listTotal - Number(inv.amount);
    return { listTotal, totalSavings, discountPct: Number(inv.discount_pct) };
  }

  // ── Correct an already-generated but unpaid invoice's amount ──────────────
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState("");

  function startEditInvoice(inv: PlatformInvoice) {
    setEditingInvoiceId(inv.id);
    setEditingAmount(String(inv.amount));
  }

  function handleSaveInvoiceAmount(invoiceId: string) {
    const amount = parseFloat(editingAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (!billingTarget) return;
    startTransition(async () => {
      const res = await updateInvoiceAmount(invoiceId, amount);
      if (res.error) {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "Invoice updated" });
        setEditingInvoiceId(null);
        openBilling(billingTarget.ownerId, billingTarget.ownerName, billingBranchCount);
      }
    });
  }

  // ── Reset invoices (test accounts only) ───────────────────────────────────
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  function handleResetInvoices() {
    if (!billingTarget) return;
    startTransition(async () => {
      const res = await resetClientInvoices(billingTarget.ownerId);
      if (res.error) {
        toast({ title: "Cannot reset", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "Invoices reset" });
        setResetConfirmOpen(false);
        openBilling(billingTarget.ownerId, billingTarget.ownerName, billingBranchCount);
      }
    });
  }

  function handleSavePhone() {
    if (!billingTarget) return;
    setSavingPhone(true);
    startTransition(async () => {
      const res = await updateOwnerPhone(billingTarget.ownerId, phoneInput);
      if (res.error) {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
      } else {
        setOwnerPhone(phoneInput.trim() || null);
        toast({ title: "Phone saved" });
      }
      setSavingPhone(false);
    });
  }

  function shareInvoiceWhatsApp(inv: PlatformInvoice) {
    const phone = toWhatsAppPhone(ownerPhone ?? "");
    if (!phone) {
      toast({ title: "No phone on file", description: "Add the client's phone number above, then share again.", variant: "destructive" });
      return;
    }
    const url = `${window.location.origin}/invoice/${inv.share_token}`;
    const msg =
      `Assalam o Alaikum ${billingTarget?.ownerName ?? ""}! Here's your Pulse invoice for *${inv.period_label}*:\n` +
      `Amount: ${formatCurrency(inv.amount)}\n\n` +
      `Please pay at your earliest convenience.\n\n` +
      `${url}`;
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, "_blank");
  }

  function handleSendInvoiceEmail(inv: PlatformInvoice) {
    if (!billingTarget) return;
    startTransition(async () => {
      const res = await sendInvoiceEmail(inv.id);
      if (res.error) {
        toast({ title: "Failed to send", description: res.error, variant: "destructive" });
        return;
      }
      toast({
        title: res.redirectedTo ? "Sent in TEST mode" : "Invoice emailed",
        description: res.redirectedTo
          ? `Redirected to ${res.redirectedTo} instead of ${res.sentTo}. Reminders every 3 days until marked paid.`
          : `Sent to ${res.sentTo} with full breakdown. Reminders every 3 days until marked paid.`,
      });
      openBilling(billingTarget.ownerId, billingTarget.ownerName, billingBranchCount);
    });
  }

  function handleToggleInvoiceStatus(invoiceId: string, current: PlatformInvoice["status"]) {
    if (!billingTarget) return;
    startTransition(async () => {
      const res = await markInvoiceStatus(invoiceId, current === "paid" ? "unpaid" : "paid");
      if (res.error) {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
      } else {
        openBilling(billingTarget.ownerId, billingTarget.ownerName, billingBranchCount);
      }
    });
  }

  // ── Shared ─────────────────────────────────────────────────────────────────
  async function refresh() {
    setLoading(true);
    const res = await listAllHostels();
    if (res.error) toast({ title: "Error", description: res.error, variant: "destructive" });
    else setHostels(res.hostels ?? []);
    setLoading(false);
  }

  const [togglingWhatsapp, setTogglingWhatsapp] = useState<string | null>(null);
  async function toggleWhatsapp(hostelId: string, current: boolean) {
    setTogglingWhatsapp(hostelId);
    const res = await setWhatsappEnabled(hostelId, !current);
    if (res.error) {
      toast({ title: "Error", description: res.error, variant: "destructive" });
    } else {
      setHostels(prev => prev.map(h => h.id === hostelId ? { ...h, whatsapp_enabled: !current } : h));
      toast({ title: !current ? "WhatsApp enabled" : "WhatsApp disabled" });
    }
    setTogglingWhatsapp(null);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return hostels;
    return hostels.filter(h =>
      h.name.toLowerCase().includes(q) ||
      (h.owner_name ?? "").toLowerCase().includes(q) ||
      h.owner_email.toLowerCase().includes(q) ||
      (h.city ?? "").toLowerCase().includes(q)
    );
  }, [search, hostels]);

  const stats = useMemo(() => ({
    total: hostels.length,
    owners: new Set(hostels.map(h => h.owner_id)).size,
    tenants: hostels.reduce((s, h) => s + h.tenant_count, 0),
  }), [hostels]);

  const grouped = useMemo(() => {
    const map = new Map<string, SuperHostelRow[]>();
    for (const h of filtered) {
      const rows = map.get(h.owner_id) ?? [];
      rows.push(h);
      map.set(h.owner_id, rows);
    }
    return Array.from(map.values());
  }, [filtered]);

  // Live "everything included vs. what you're charging" preview while setting a
  // client's billing — so it's visible before saving, not just on the PDF. The
  // rate is PER BRANCH, so every total is rate × months × branch count — this is
  // what was missing before and made totals look wrong for multi-branch clients.
  // The discount is always auto-derived from the rate vs. our standard cost, for
  // both monthly and annual clients — there's no separate manual discount field.
  // Onboarding stays a flat one-time account-level fee, not multiplied by branches.
  const billingPreview = useMemo(() => {
    const rate = parseFloat(billingForm.monthlyRate);
    if (!rate || rate <= 0) return null;
    const isFirstInvoice = invoices.length === 0;
    const months = billingForm.cycle === "annual" ? 12 : 1;
    const branches = Math.max(1, billingBranchCount);
    const discountPct = clientDiscountPct(rate);
    const perBranchActual = rate * months;
    const perBranchList = STANDARD_CLIENT_MONTHLY_RATE * months;
    const actualSubtotal = perBranchActual * branches;
    const listSubtotal = perBranchList * branches;
    const discountAmount = listSubtotal - actualSubtotal;
    const standardOnboarding = isFirstInvoice ? ONBOARDING_FEE : 0;
    const onboardingCharged = isFirstInvoice && !billingForm.waiveOnboarding ? ONBOARDING_FEE : 0;
    const listTotal = listSubtotal + standardOnboarding;
    const actualTotal = actualSubtotal + onboardingCharged;
    const totalSavings = listTotal - actualTotal;
    return {
      isFirstInvoice, branches, perBranchActual, perBranchList,
      listSubtotal, actualSubtotal, discountPct, discountAmount,
      standardOnboarding, onboardingCharged, listTotal, actualTotal, totalSavings,
    };
  }, [billingForm.monthlyRate, billingForm.cycle, billingForm.waiveOnboarding, invoices.length, billingBranchCount]);

  // Onboarding only ever applies to a client's literal first invoice ever generated —
  // once they have any invoice history, the waive checkbox has no effect at all, which
  // is confusing unless the dialog says so explicitly.
  const isClientFirstInvoice = invoices.length === 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-sidebar-border px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between gap-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber/10 border border-amber/20">
              <Building2 className="w-4 h-4 text-amber" />
            </div>
            <div>
              <h1 className="text-base font-bold">All Hostels</h1>
              <p className="text-xs text-muted-foreground">Platform-wide hostel registry</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-2" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button size="sm" className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold" onClick={() => setNewOpen(true)}>
              <Plus className="w-4 h-4" /> New Client
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Branches",  value: stats.total,   icon: Building2, color: "text-amber-400",   bg: "bg-amber/10",       border: "border-amber/20" },
            { label: "Clients",   value: stats.owners,  icon: Users,     color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
            { label: "Tenants",   value: stats.tenants, icon: Home,      color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
          ].map(({ label, value, icon: Icon, color, bg, border }) => (
            <div key={label} className={cn("flex items-center gap-3 rounded-xl border p-3", bg, border)}>
              <Icon className={cn("w-5 h-5 shrink-0", color)} />
              <div>
                <p className="text-xl font-bold leading-none">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search client, branch, city…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>

        {/* Card grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Building2 className="w-10 h-10 mb-3 opacity-20" />
            <p className="font-medium">No clients yet</p>
            <p className="text-sm mt-1">Click "New Client" to onboard your first hostel owner</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {grouped.map((rows) => {
              const owner = rows[0];
              const totalTenants = rows.reduce((s, h) => s + h.tenant_count, 0);
              return (
                <Card key={owner.owner_id} className="overflow-hidden border-sidebar-border">
                  {/* Owner header */}
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{owner.owner_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{owner.owner_email}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openBilling(owner.owner_id, owner.owner_name ?? owner.owner_email, rows.length)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors"
                          title="Billing"
                        >
                          <Wallet className="w-3.5 h-3.5" />
                        </button>
                        {/* Delete client */}
                        <button
                          onClick={() => setDeleteTarget({ type: "client", id: owner.owner_id, name: owner.owner_name ?? owner.owner_email })}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete client"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[11px] text-muted-foreground">{rows.length} branch{rows.length !== 1 ? "es" : ""}</span>
                      <span className="text-[11px] text-muted-foreground">·</span>
                      <span className="text-[11px] text-muted-foreground">{totalTenants} tenant{totalTenants !== 1 ? "s" : ""}</span>
                    </div>
                  </div>

                  {/* Branch list */}
                  <div className="border-t border-sidebar-border">
                    {rows.map((h) => (
                      <div key={h.id} className="group flex items-center gap-2 px-4 py-2.5 hover:bg-muted/10 border-b border-sidebar-border/40 last:border-0 transition-colors">
                        <Building2 className="w-3.5 h-3.5 text-amber shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{h.name}</p>
                          {h.city && <p className="text-[11px] text-muted-foreground truncate">{h.city}</p>}
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">{h.tenant_count} ten.</span>
                        <button
                          onClick={() => toggleWhatsapp(h.id, h.whatsapp_enabled)}
                          disabled={togglingWhatsapp === h.id}
                          className={cn(
                            "p-1 rounded transition-all shrink-0",
                            h.whatsapp_enabled
                              ? "text-emerald-400 hover:bg-emerald-500/10"
                              : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10"
                          )}
                          title={h.whatsapp_enabled ? "WhatsApp (reminders + announcements): ON for this branch — click to disable" : "WhatsApp (reminders + announcements): OFF for this branch — click to enable"}
                        >
                          <MessageCircle className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget({ type: "branch", id: h.id, name: h.name })}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                          title="Delete branch"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add branch */}
                  <CardContent className="p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-8 text-xs gap-1.5"
                      onClick={() => openAddBranch(owner.owner_id, owner.owner_name ?? owner.owner_email)}
                    >
                      <GitBranch className="w-3 h-3" /> Add Branch
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── New Client Dialog ── */}
      <Dialog open={newOpen} onOpenChange={o => { if (!o) { setNewOpen(false); setOwnerForm(emptyOwner); setPrimaryBranchName(""); setBranchCount(1); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="w-4 h-4" /> New Client</DialogTitle>
            <DialogDescription>Creates an owner account and provisions their branches. Credentials are shown after creation.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Owner Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input placeholder="Ahmed Khan" value={ownerForm.ownerName} onChange={e => setOwnerForm({ ...ownerForm, ownerName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="+92 300…" value={ownerForm.ownerPhone} onChange={e => setOwnerForm({ ...ownerForm, ownerPhone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" placeholder="owner@example.com" value={ownerForm.ownerEmail} onChange={e => setOwnerForm({ ...ownerForm, ownerEmail: e.target.value })} />
            </div>

            <div className="h-px bg-sidebar-border" />

            <div className="space-y-1.5">
              <Label>Primary Branch Name *</Label>
              <Input
                placeholder="e.g. Al-Noor Boys Hostel – Johar Town"
                value={primaryBranchName}
                onChange={e => setPrimaryBranchName(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Named "Main Branch". Additional branches are auto-named and can be renamed later.</p>
            </div>

            <div className="space-y-2">
              <Label>Number of Branches</Label>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setBranchCount(n => Math.max(1, n - 1))}
                  className="w-9 h-9 rounded-lg border border-sidebar-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors text-xl font-light">−</button>
                <span className="text-3xl font-bold w-10 text-center">{branchCount}</span>
                <button type="button" onClick={() => setBranchCount(n => Math.min(20, n + 1))}
                  className="w-9 h-9 rounded-lg border border-sidebar-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors text-xl font-light">+</button>
                <p className="text-xs text-muted-foreground leading-tight">
                  {branchCount === 1
                    ? "Only the primary branch will be created"
                    : `${branchCount - 1} extra branch${branchCount - 1 > 1 ? "es" : ""} auto-named — owner renames from Settings`}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={isPending || !ownerForm.ownerEmail || !ownerForm.ownerName || !primaryBranchName.trim()}
              className="bg-amber text-background hover:bg-amber/90 font-semibold">
              {isPending ? "Creating…" : `Create · ${branchCount} Branch${branchCount > 1 ? "es" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Credentials Modal ── */}
      <Dialog open={!!creds} onOpenChange={o => !o && setCreds(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-400">
              <Check className="w-4 h-4" /> Client Created Successfully
            </DialogTitle>
            <DialogDescription>
              Share these credentials with <strong>{creds?.name}</strong>. The password cannot be retrieved again.
            </DialogDescription>
          </DialogHeader>
          {creds && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg border border-sidebar-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Email</p>
                    <p className="text-sm font-mono truncate">{creds.email}</p>
                  </div>
                  <button onClick={() => copy(creds.email, "email")}
                    className="p-1.5 rounded-lg border border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0">
                    {copied === "email" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="h-px bg-sidebar-border" />
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Password</p>
                    <p className="text-sm font-mono tracking-wider">{creds.password}</p>
                  </div>
                  <button onClick={() => copy(creds.password, "pass")}
                    className="p-1.5 rounded-lg border border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0">
                    {copied === "pass" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <p className="text-xs text-amber/80 bg-amber/5 border border-amber/20 rounded-lg px-3 py-2">
                ⚠️ Save this password now — it will not be shown again.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setCreds(null)}>Close</Button>
            {creds && (
              <Button onClick={() => shareWhatsApp(creds)}
                className="gap-2 bg-[#25D366] hover:bg-[#25D366]/90 text-white font-semibold">
                <MessageCircle className="w-4 h-4" /> Share on WhatsApp
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Branch Dialog ── */}
      <Dialog open={branchOpen} onOpenChange={o => !o && setBranchOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-amber" /> Add Branch</DialogTitle>
            <DialogDescription>New branch for <strong>{targetOwner?.name}</strong>.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Branch Name *</Label>
              <Input placeholder="e.g. Garden Town Branch" value={newBranch.name} onChange={e => setNewBranch({ ...newBranch, name: e.target.value })} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input placeholder="Lahore" value={newBranch.city} onChange={e => setNewBranch({ ...newBranch, city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input placeholder="Street, area" value={newBranch.address} onChange={e => setNewBranch({ ...newBranch, address: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchOpen(false)}>Cancel</Button>
            <Button onClick={handleAddBranch} disabled={isPending || !newBranch.name.trim()} className="gap-2">
              <GitBranch className="w-4 h-4" />{isPending ? "Adding…" : "Add Branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4" /> Confirm Delete
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.type === "client"
                ? `This will permanently delete the client "${deleteTarget.name}" and all their branches. This cannot be undone.`
                : `This will permanently delete the branch "${deleteTarget?.name}". This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending} className="gap-2">
              <Trash2 className="w-4 h-4" />{isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Invoices Confirm Dialog ── */}
      <Dialog open={resetConfirmOpen} onOpenChange={o => !o && setResetConfirmOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4" /> Reset Invoices?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes all {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} for <strong>{billingTarget?.ownerName}</strong> and cannot be undone.
              Their billing config (rate, cycle, onboarding waiver) is kept as-is, and their next invoice will be treated as a first invoice again.
              Blocked automatically if any invoice has been marked paid — this is for test accounts only.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleResetInvoices} disabled={isPending} className="gap-2">
              <RotateCcw className="w-4 h-4" />{isPending ? "Resetting…" : "Reset Invoices"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Billing Dialog ── */}
      <Dialog open={!!billingTarget} onOpenChange={o => { if (!o) { setBillingTarget(null); setResetConfirmOpen(false); } }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wallet className="w-4 h-4 text-amber" /> Billing</DialogTitle>
            <DialogDescription>{billingTarget?.ownerName}</DialogDescription>
          </DialogHeader>

          {billingLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-5 py-2">
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label>Client Phone (for WhatsApp)</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="+92 300 1234567"
                      value={phoneInput}
                      onChange={e => setPhoneInput(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending || savingPhone || phoneInput === (ownerPhone ?? "")}
                      onClick={handleSavePhone}
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                  </div>
                  {!ownerPhone && (
                    <p className="text-[11px] text-amber">No phone on file — WhatsApp sharing won't work until one is added.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Billing Cycle</Label>
                  <div className="flex gap-2">
                    {(["annual", "monthly"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setBillingForm(f => ({ ...f, cycle: c, waiveOnboarding: c === "annual" ? true : f.waiveOnboarding }))}
                        className={cn(
                          "flex-1 h-9 rounded-lg border text-sm font-medium capitalize transition-colors",
                          billingForm.cycle === c
                            ? "border-amber bg-amber/10 text-amber"
                            : "border-sidebar-border text-muted-foreground hover:bg-white/5"
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Monthly Rate per Branch (PKR)</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder={String(STANDARD_CLIENT_MONTHLY_RATE)}
                      value={billingForm.monthlyRate}
                      onChange={e => setBillingForm(f => ({ ...f, monthlyRate: e.target.value }))}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Per branch, per month. Our standard rate is {formatCurrency(STANDARD_CLIENT_MONTHLY_RATE)}/mo — charge less and the discount % is worked out for you below.
                      This client has {billingBranchCount} branch{billingBranchCount !== 1 ? "es" : ""}, so the total is this rate × {billingBranchCount}.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Billing Start Date</Label>
                    <Input
                      type="date"
                      value={billingForm.startDate}
                      onChange={e => setBillingForm(f => ({ ...f, startDate: e.target.value }))}
                    />
                  </div>
                </div>
                <label
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
                    isClientFirstInvoice ? "border-sidebar-border cursor-pointer" : "border-sidebar-border/50 opacity-60 cursor-not-allowed"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={billingForm.waiveOnboarding}
                    disabled={!isClientFirstInvoice}
                    onChange={e => setBillingForm(f => ({ ...f, waiveOnboarding: e.target.checked }))}
                    className="w-4 h-4 accent-amber"
                  />
                  <span className="text-sm">
                    Waive onboarding fee ({formatCurrency(ONBOARDING_FEE)})
                    <span className="block text-[11px] text-muted-foreground font-normal">
                      {isClientFirstInvoice
                        ? "This is their first invoice — this decides whether it includes the onboarding fee."
                        : "Already has invoice history, so the onboarding fee no longer applies — this setting has no effect."}
                    </span>
                  </span>
                </label>
                <p className="text-[11px] text-muted-foreground -mt-2">
                  The next invoice generated (manually or by the daily job) will cover the {billingForm.cycle} starting from this date — set it to when the client actually started, not necessarily today.
                </p>

                {billingPreview && (
                  <div className="rounded-lg border border-sidebar-border bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Our cost (per branch, {billingForm.cycle})</span>
                      <span className="font-medium">{formatCurrency(billingPreview.perBranchList)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">We're charging (per branch)</span>
                      <span className="font-medium">{formatCurrency(billingPreview.perBranchActual)}</span>
                    </div>
                    {billingPreview.discountAmount > 0 ? (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-amber">Discount</span>
                        <span className="font-medium text-amber">{billingPreview.discountPct.toFixed(1)}%</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-400">Discount</span>
                        <span className="font-medium text-emerald-400">0% — full standard rate</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-sidebar-border/60">
                      <span className="text-muted-foreground">× {billingPreview.branches} branch{billingPreview.branches !== 1 ? "es" : ""}</span>
                      <span className="font-medium">{formatCurrency(billingPreview.actualSubtotal)}</span>
                    </div>
                    {billingPreview.discountAmount > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">(list price for all branches: {formatCurrency(billingPreview.listSubtotal)}, discount - {formatCurrency(billingPreview.discountAmount)})</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-sidebar-border/60">
                      <span className="text-muted-foreground">Onboarding fee (flat, not per branch)</span>
                      {billingPreview.isFirstInvoice ? (
                        billingForm.waiveOnboarding ? (
                          <span className="font-medium text-emerald-400">Waived</span>
                        ) : (
                          <span className="font-medium">{formatCurrency(ONBOARDING_FEE)}</span>
                        )
                      ) : (
                        <span className="font-medium text-muted-foreground">Not applicable</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-sidebar-border/60">
                      <span className="font-semibold">You're charging (total, all branches)</span>
                      <span className="font-semibold">{formatCurrency(billingPreview.actualTotal)}</span>
                    </div>
                    {billingPreview.totalSavings > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-amber font-semibold">Total you're giving away</span>
                        <span className="text-amber font-semibold">{formatCurrency(billingPreview.totalSavings)}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Textarea
                    placeholder="e.g. Early adopter, discounted for first year"
                    value={billingForm.notes}
                    onChange={e => setBillingForm(f => ({ ...f, notes: e.target.value }))}
                    className="min-h-16"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveBilling} disabled={isPending} className="flex-1 gap-2">
                    <Check className="w-4 h-4" /> Save
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleGenerateInvoice}
                    disabled={isPending || !billing?.monthly_rate}
                    className="flex-1 gap-2"
                  >
                    <Zap className="w-4 h-4" /> Generate Invoice Now
                  </Button>
                </div>
              </div>

              <div className="h-px bg-sidebar-border" />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Invoice History</p>
                  {invoices.length > 0 && (
                    <button
                      onClick={() => setResetConfirmOpen(true)}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-red-400 transition-colors"
                      title="Reset invoices (test accounts only)"
                    >
                      <RotateCcw className="w-3 h-3" /> Reset (test)
                    </button>
                  )}
                </div>
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No invoices yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {invoices.map((inv) => {
                      const { totalSavings, discountPct } = invoicePricingInfo(inv);
                      return (
                      <div key={inv.id} className="flex items-center justify-between gap-2 rounded-lg border border-sidebar-border px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{inv.period_label}</p>
                          {editingInvoiceId === inv.id ? (
                            <div className="flex items-center gap-1.5 mt-1">
                              <Input
                                type="number"
                                min={0}
                                autoFocus
                                value={editingAmount}
                                onChange={e => setEditingAmount(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && handleSaveInvoiceAmount(inv.id)}
                                className="h-7 w-28 text-xs"
                              />
                              <Button size="sm" className="h-7 px-2" disabled={isPending} onClick={() => handleSaveInvoiceAmount(inv.id)}>
                                <Check className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setEditingInvoiceId(null)}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <>
                              <p className="text-[11px] text-muted-foreground">Due {formatDate(inv.due_date)} · {formatCurrency(inv.amount)}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {formatCurrency(Number(inv.monthly_rate) * (inv.billing_cycle === "annual" ? 12 : 1))}/branch × {inv.branch_count} branch{inv.branch_count !== 1 ? "es" : ""}
                                {discountPct > 0 && <span className="text-amber"> · {discountPct.toFixed(0)}% discount</span>}
                                {inv.is_first_invoice && <span> · first invoice{inv.onboarding_fee_charged > 0 ? " + onboarding fee" : " (onboarding waived)"}</span>}
                                {totalSavings > 0 && <span className="text-amber"> · saved {formatCurrency(totalSavings)}</span>}
                              </p>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {inv.status === "unpaid" && editingInvoiceId !== inv.id && (
                            <button
                              onClick={() => startEditInvoice(inv)}
                              className="p-1.5 rounded-lg border border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                              title="Correct amount"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => window.open(`${window.location.origin}/invoice/${inv.share_token}`, "_blank")}
                            className="p-1.5 rounded-lg border border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                            title="Download PDF"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => shareInvoiceWhatsApp(inv)}
                            className="p-1.5 rounded-lg border border-[#25D366]/30 text-[#25D366] hover:bg-[#25D366]/10 transition-colors"
                            title="Share on WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </button>
                          {inv.status === "unpaid" && (
                            <button
                              onClick={() => handleSendInvoiceEmail(inv)}
                              disabled={isPending}
                              className={cn(
                                "p-1.5 rounded-lg border transition-colors disabled:opacity-50",
                                inv.first_sent_at
                                  ? "border-amber/40 text-amber hover:bg-amber/10"
                                  : "border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-white/5"
                              )}
                              title={
                                inv.first_sent_at
                                  ? `Emailed ${formatDate(inv.first_sent_at.slice(0, 10))} · ${inv.reminder_count} reminder${inv.reminder_count === 1 ? "" : "s"} sent · click to resend`
                                  : "Email invoice with PDF (starts 3-day reminders)"
                              }
                            >
                              <Mail className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleInvoiceStatus(inv.id, inv.status)}
                            disabled={isPending}
                            className={cn(
                              "inline-flex items-center gap-1 whitespace-nowrap px-2 py-1 rounded-full text-xs font-medium border transition-colors",
                              inv.status === "paid"
                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20"
                                : "text-amber bg-amber/10 border-amber/20 hover:bg-amber/20"
                            )}
                          >
                            {inv.status === "paid" ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                            {inv.status === "paid" ? "Paid" : "Unpaid"}
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setBillingTarget(null); setResetConfirmOpen(false); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
