"use client";

import { useState, useTransition, useMemo } from "react";
import {
  Building2, Plus, Search, RefreshCw, Users, Home,
  GitBranch, Trash2, Copy, Check, MessageCircle, AlertTriangle,
  Wallet, CheckCircle2, Clock, Zap, Download, Pencil,
} from "lucide-react";
import {
  listAllHostels, createHostelForClient, addBranchToOwner,
  deleteHostel, deleteClient, type SuperHostelRow,
} from "@/app/actions/super-admin";
import {
  getClientBilling, setClientBilling, generateInvoiceNow, markInvoiceStatus, updateInvoiceAmount,
  updateOwnerPhone,
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
import { calculateAnnualPrice } from "@/lib/pricing";
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
    price: "",
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
      setBillingForm({
        cycle: res.billing?.billing_cycle ?? "annual",
        price: res.billing?.custom_price != null ? String(res.billing.custom_price) : "",
        notes: res.billing?.pricing_notes ?? "",
        startDate: res.billing?.next_invoice_date ?? new Date().toISOString().slice(0, 10),
      });
    }
    setBillingLoading(false);
  }

  function handleSaveBilling() {
    if (!billingTarget) return;
    const price = parseFloat(billingForm.price);
    if (!price || price <= 0) {
      toast({ title: "Enter a valid price", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      const res = await setClientBilling({
        ownerId: billingTarget.ownerId,
        billingCycle: billingForm.cycle,
        customPrice: price,
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
    const price = parseFloat(billingForm.price);
    if (!price || price <= 0) {
      toast({ title: "Enter a valid price", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      // Save whatever's currently typed FIRST — otherwise this would silently generate
      // using the last-saved price and discard any unsaved edit in the price field.
      const saveRes = await setClientBilling({
        ownerId: billingTarget.ownerId,
        billingCycle: billingForm.cycle,
        customPrice: price,
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
    const actualAnnual = inv.billing_cycle === "annual" ? Number(inv.amount) : Number(inv.amount) * 12;
    const discount = Math.max(0, Number(inv.standard_annual_price) - actualAnnual);
    const discountPct = Number(inv.standard_annual_price) > 0 ? (discount / Number(inv.standard_annual_price)) * 100 : 0;
    return { actualAnnual, discount, discountPct };
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

  // Live discount-vs-standard-price preview while setting a client's billing —
  // so it's visible before saving, not just after generating an invoice PDF.
  const billingPreview = useMemo(() => {
    const enteredPrice = parseFloat(billingForm.price);
    if (!enteredPrice || enteredPrice <= 0) return null;
    const standardAnnual = calculateAnnualPrice(billingBranchCount);
    const actualAnnual = billingForm.cycle === "annual" ? enteredPrice : enteredPrice * 12;
    const discount = Math.max(0, standardAnnual - actualAnnual);
    const discountPct = standardAnnual > 0 ? (discount / standardAnnual) * 100 : 0;
    return {
      standardAnnual, actualAnnual, discount, discountPct,
      standardMonthly: standardAnnual / 12,
      actualMonthly: actualAnnual / 12,
      discountMonthly: discount / 12,
    };
  }, [billingForm.price, billingForm.cycle, billingBranchCount]);

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

      {/* ── Billing Dialog ── */}
      <Dialog open={!!billingTarget} onOpenChange={o => !o && setBillingTarget(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin">
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
                        onClick={() => setBillingForm(f => ({ ...f, cycle: c }))}
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
                    <Label>Price per {billingForm.cycle === "monthly" ? "month" : "year"} (PKR)</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="80000"
                      value={billingForm.price}
                      onChange={e => setBillingForm(f => ({ ...f, price: e.target.value }))}
                    />
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
                <p className="text-[11px] text-muted-foreground -mt-2">
                  The next invoice generated (manually or by the daily job) will cover the {billingForm.cycle} starting from this date — set it to when the client actually started, not necessarily today.
                </p>

                {billingPreview && (
                  <div className="rounded-lg border border-sidebar-border bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Standard price ({billingBranchCount} branch{billingBranchCount !== 1 ? "es" : ""})</span>
                      <span className="font-medium">
                        {formatCurrency(billingPreview.standardAnnual)}/yr
                        <span className="text-muted-foreground font-normal"> ({formatCurrency(billingPreview.standardMonthly)}/mo)</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">This client's price</span>
                      <span className="font-medium">
                        {formatCurrency(billingPreview.actualAnnual)}/yr
                        <span className="text-muted-foreground font-normal"> ({formatCurrency(billingPreview.actualMonthly)}/mo)</span>
                      </span>
                    </div>
                    {billingPreview.discount > 0 ? (
                      <div className="flex items-center justify-between text-xs pt-1 border-t border-sidebar-border/60">
                        <span className="text-amber font-semibold">Discount you're giving</span>
                        <span className="text-amber font-semibold">
                          {formatCurrency(billingPreview.discount)}/yr ({formatCurrency(billingPreview.discountMonthly)}/mo) · {billingPreview.discountPct.toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs pt-1 border-t border-sidebar-border/60">
                        <span className="text-emerald-400 font-semibold">No discount — full standard price</span>
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
                    disabled={isPending || !billing?.custom_price}
                    className="flex-1 gap-2"
                  >
                    <Zap className="w-4 h-4" /> Generate Invoice Now
                  </Button>
                </div>
              </div>

              <div className="h-px bg-sidebar-border" />

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Invoice History</p>
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No invoices yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {invoices.map((inv) => {
                      const { actualAnnual, discount, discountPct } = invoicePricingInfo(inv);
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
                                {formatCurrency(actualAnnual)}/yr ({inv.branch_count} branch{inv.branch_count !== 1 ? "es" : ""})
                                {discount > 0 && <span className="text-amber"> · {discountPct.toFixed(0)}% discount ({formatCurrency(discount)}/yr)</span>}
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
            <Button variant="outline" onClick={() => setBillingTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
