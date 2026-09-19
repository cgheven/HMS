"use client";
import { useEffect, useState, useTransition } from "react";
import { Building2, User, Save, Loader2, Globe, Clock, Phone, RefreshCw, Plus, Check, Handshake, Eye, EyeOff, Trash2, X, MessageCircle, ShieldCheck, ChefHat, ChevronDown, Utensils } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useHostelContext } from "@/contexts/hostel-context";
import { getCountryConfig } from "@/lib/country-config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { requestBranchDeletion } from "@/app/actions/branches";
import { listPartners, createPartner, removePartner, updatePartnerTier, getExistingPartnersForOwner, addPartnerToHostel } from "@/app/actions/partners";
import type { PartnerRow, ExistingPartnerOption } from "@/app/actions/partners";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PARTNER_TIER_LABELS } from "@/lib/partner-tier-labels";
import type { Hostel, PaymentMethodAccount, PackageTier, PartnerTier, WifiNetwork, MealTimes } from "@/types";
import { MealTimesFields } from "@/components/modules/settings/meal-times-fields";
import { savePaymentRecoverySettings, saveWelcomeSettings } from "@/app/actions/settings";
import { requestEmailChange } from "@/app/actions/account";
import { DEFAULT_REMINDER_TEMPLATE, formatAccounts, buildReminderMessage } from "@/lib/whatsapp-reminder";
import { DEFAULT_WELCOME_TEMPLATE, buildWelcomeMessage } from "@/lib/whatsapp-welcome";
import { floorToken, roomToken } from "@/lib/wifi-coverage";
import { SEATER_CAPACITIES, SEATER_LABELS } from "@/lib/seater-pricing";

import { PackagePricingForm } from "@/components/modules/settings/package-pricing-form";
import { PaymentMethodsForm } from "@/components/modules/settings/payment-methods-form";
import { HostelInfoForm } from "@/components/modules/settings/hostel-info-form";

function Section({ title, icon: Icon, description, danger = false, defaultOpen = false, children }: {
  title: string; icon: typeof Building2; description?: string; danger?: boolean; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className={danger ? "border-rose-500/20" : undefined}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-4 h-4 shrink-0 ${danger ? "text-rose-400" : "text-muted-foreground"}`} />
          <span className={`text-base font-semibold ${danger ? "text-rose-300" : ""}`}>{title}</span>
        </div>
        <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-5 pb-5 space-y-4">{description && <p className="text-sm text-muted-foreground -mt-1">{description}</p>}{children}</div>}
    </Card>
  );
}

export function SettingsClient() {
  const { profile, hostel, hostels, partnerTier } = useHostelContext();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const hostelId = hostel?.id ?? null;
  // Currency indicator for these config-field captions. PK keeps "Rs." (period,
  // byte-identical); other countries use their symbol (e.g. "£").
  const curCfg = getCountryConfig(hostel?.country);
  const curSym = curCfg.currency === "PKR" ? "Rs." : curCfg.currencySymbol;
  // PK renders the exact incumbent rate labels (with their (Rs. …) captions + a
  // plain <Input>); non-PK renders the inline-symbol MoneyInput. Formatting only.
  const isPk = (hostel?.country ?? "PK").toUpperCase() === "PK";
  // Country terminology: PK renders Branch/Branches/Tenant; non-PK renders
  // Property/Properties/Resident. Fails open to PK (byte-identical).
  const words = curCfg.terms;
  // Branch-scoped cards are shown to partners; the Branches and Partners cards
  // are not. Those two are account-level — creating branches on the owner's
  // account, and adding/removing/re-tiering partners (which would let a partner
  // escalate their own access or remove the owner's other partners).
  const isPartner = profile?.role === "partner";
  // Branch configuration (hostel row, package configs) is full-tier only at the
  // DB level — below that the card renders read-only instead of letting a save
  // silently affect zero rows. Your Profile is never gated: it writes the
  // caller's own row.
  const canFullTier = !partnerTier || partnerTier === "full";
  const readOnlyNote = (
    <p className="text-xs text-muted-foreground/70">
      View only — your access level doesn&apos;t allow changing this. Ask the owner if it needs updating.
    </p>
  );

  // Branches state
  const [requestingDelete, setRequestingDelete] = useState(false);
  async function requestDeleteBranch() {
    if (!hostelId) return;
    setRequestingDelete(true);
    const res = await requestBranchDeletion(hostelId);
    setRequestingDelete(false);
    if (res.success) toast({ title: "Check your email", description: `We've emailed a link to confirm deleting "${hostel?.name}". It expires in 30 minutes.` });
    else toast({ title: "Couldn't start deletion", description: res.error, variant: "destructive" });
  }
  /** Which branch cooks for this one. "" means self-catered — the value every
   *  branch has until an owner points it somewhere. */
  const [kitchenGroupId, setKitchenGroupId] = useState<string>("");
  const [savingKitchen, setSavingKitchen] = useState(false);

  // Partners state
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [showAddPartner, setShowAddPartner] = useState(false);
  const [partnerMode, setPartnerMode] = useState<"new" | "existing">("new");
  const [partnerForm, setPartnerForm] = useState({ name: "", email: "", phone: "", password: "", tier: "read_only" as PartnerTier });
  const [showPartnerPassword, setShowPartnerPassword] = useState(false);
  const [creatingPartner, setCreatingPartner] = useState(false);
  const [removingPartner, setRemovingPartner] = useState<string | null>(null);
  const [updatingTierFor, setUpdatingTierFor] = useState<string | null>(null);
  // Other branches' partners this owner can attach to the current branch
  const [existingPartners, setExistingPartners] = useState<ExistingPartnerOption[]>([]);
  const [selectedExistingPartnerId, setSelectedExistingPartnerId] = useState("");
  const [existingPartnerTier, setExistingPartnerTier] = useState<PartnerTier>("read_only");
  const [addingExistingPartner, setAddingExistingPartner] = useState(false);
  // lastCreatedPartner holds credentials for WhatsApp share — cleared on dialog close
  const [lastCreatedPartner, setLastCreatedPartner] = useState<{ name: string; email: string; phone: string; password: string } | null>(null);

  const [profileForm, setProfileForm] = useState({ full_name: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [sendingEmailChange, setSendingEmailChange] = useState(false);



  // Payment Recovery state
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // Tenant Welcome / WiFi state
  const [wifiNetworks, setWifiNetworks] = useState<WifiNetwork[]>(
    () => (hostel?.wifi_networks ?? []).map((w) => ({ ...w, id: w.id || uid() }))
  );
  const [welcomeTemplate, setWelcomeTemplate] = useState(
    hostel?.welcome_message_template ?? DEFAULT_WELCOME_TEMPLATE
  );
  const [mealTimes, setMealTimes] = useState<MealTimes>(() => ({
    breakfast: { from: hostel?.meal_times?.breakfast?.from ?? "", to: hostel?.meal_times?.breakfast?.to ?? "" },
    lunch: { from: hostel?.meal_times?.lunch?.from ?? "", to: hostel?.meal_times?.lunch?.to ?? "" },
    dinner: { from: hostel?.meal_times?.dinner?.from ?? "", to: hostel?.meal_times?.dinner?.to ?? "" },
  }));
  const [savingWelcome, setSavingWelcome] = useState(false);

  // Rooms of this branch, so a WiFi network can be scoped to floors/rooms.
  // Blank scope = whole hostel (the default), so this is only for owners who
  // want the precision — the picker stays empty and harmless otherwise.
  const [coverageRooms, setCoverageRooms] = useState<{ room_number: string; floor: number | null }[]>([]);
  useEffect(() => {
    if (!hostelId) { setCoverageRooms([]); return; }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("hms_rooms")
        .select("room_number, floor")
        .eq("hostel_id", hostelId)
        .order("floor", { ascending: true })
        .order("room_number", { ascending: true });
      if (!cancelled) setCoverageRooms((data as { room_number: string; floor: number | null }[] | null) ?? []);
    })();
    return () => { cancelled = true; };
  }, [hostelId]);

  const coverageFloors = Array.from(
    new Set(coverageRooms.map((r) => r.floor).filter((f): f is number => f !== null && f !== undefined))
  ).sort((a, b) => a - b);
  // Deduped + trimmed: a branch can (rarely) have the same room number on two
  // floors, and one chip per number keeps the token stable and the React keys
  // unique. Room scoping is by number; floors are the tool when numbers repeat.
  const coverageRoomNumbers = Array.from(
    new Set(coverageRooms.map((r) => (r.room_number ?? "").trim()).filter((n) => n))
  );

  function addWifiNetwork() {
    setWifiNetworks((prev) => [...prev, { id: uid(), name: "", password: "", coverage: [] }]);
  }
  function updateWifiNetwork(id: string, patch: Partial<WifiNetwork>) {
    setWifiNetworks((prev) => prev.map((w) => w.id === id ? { ...w, ...patch } : w));
  }
  function removeWifiNetwork(id: string) {
    setWifiNetworks((prev) => prev.filter((w) => w.id !== id));
  }
  function toggleWifiCoverage(id: string, token: string) {
    setWifiNetworks((prev) => prev.map((w) => {
      if (w.id !== id) return w;
      const cur = w.coverage ?? [];
      return { ...w, coverage: cur.includes(token) ? cur.filter((t) => t !== token) : [...cur, token] };
    }));
  }
  function updateMealTime(meal: "breakfast" | "lunch" | "dinner", field: "from" | "to", value: string) {
    setMealTimes((prev) => ({ ...prev, [meal]: { ...prev[meal], [field]: value } }));
  }

  async function saveWelcomeSettingsHandler() {
    setSavingWelcome(true);
    const result = await saveWelcomeSettings({
      wifi_networks: wifiNetworks.filter((w) => w.name.trim()),
      welcome_message_template: welcomeTemplate,
      meal_times: mealTimes,
    });
    setSavingWelcome(false);
    if (result.success) toast({ title: `${words.tenant} welcome settings saved` });
    else toast({ title: "Error", description: result.error, variant: "destructive" });
  }
  const welcomePreview = buildWelcomeMessage({
    template: welcomeTemplate,
    tenantName: "Ali Raza",
    hostelName: hostel?.name ?? "Your Hostel",
    room: "5",
    wifiNetworks,
    menuUrl: hostel?.listing_enabled && hostel?.slug ? `https://hostel.yourpulse.io/find/${hostel.slug}` : null,
    mealTimes,
  });


  async function saveKitchenGroup(nextValue: string) {
    if (!hostelId) return;
    setSavingKitchen(true);
    const supabase = createClient();
    // Written on every member of the group, the host included, so membership can
    // be read with one equality filter instead of "points at X or is X".
    const { data, error } = await supabase
      .from("hms_hostels")
      .update({ kitchen_group_id: nextValue === "" ? null : nextValue })
      .eq("id", hostelId)
      .select("id");
    setSavingKitchen(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    setKitchenGroupId(nextValue);
    toast({ title: nextValue === "" ? "Set to self-catered" : "Shared kitchen saved" });
  }

  async function fetchPartners(id: string) {
    setLoadingPartners(true);
    const [result, existingResult] = await Promise.all([
      listPartners(id),
      getExistingPartnersForOwner(id),
    ]);
    if (result.error) {
      toast({ title: "Failed to load partners", description: result.error, variant: "destructive" });
    } else {
      setPartners(result.partners ?? []);
    }
    setExistingPartners(existingResult.partners ?? []);
    setLoadingPartners(false);
  }

  async function handleCreatePartner(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId) return;
    if (partnerForm.password.length < 8) {
      toast({ title: "Password too short", description: "Password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    setCreatingPartner(true);
    const result = await createPartner(hostelId, partnerForm);
    setCreatingPartner(false);
    if (result.error) {
      toast({ title: "Failed to add partner", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Partner added", description: `${partnerForm.name} now has access.` });
    // Store credentials for WhatsApp share before clearing the form
    setLastCreatedPartner({ name: partnerForm.name, email: partnerForm.email, phone: partnerForm.phone, password: partnerForm.password });
    setPartnerForm({ name: "", email: "", phone: "", password: "", tier: "read_only" });
    setShowAddPartner(false);
    await fetchPartners(hostelId);
  }

  async function handleAddExistingPartner(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId || !selectedExistingPartnerId) return;
    setAddingExistingPartner(true);
    const result = await addPartnerToHostel(selectedExistingPartnerId, hostelId, existingPartnerTier);
    setAddingExistingPartner(false);
    if (result.error) {
      toast({ title: "Failed to add partner", description: result.error, variant: "destructive" });
      return;
    }
    const added = existingPartners.find((p) => p.partnerId === selectedExistingPartnerId);
    toast({ title: "Partner added", description: `${added?.name ?? "Partner"} now has access to this branch.` });
    setSelectedExistingPartnerId("");
    setExistingPartnerTier("read_only");
    setShowAddPartner(false);
    await fetchPartners(hostelId);
  }

  async function handleRemovePartner(partnershipId: string, partnerName: string) {
    if (!confirm(`Remove ${partnerName} as a partner? They will lose access immediately.`)) return;
    setRemovingPartner(partnershipId);
    const result = await removePartner(partnershipId);
    setRemovingPartner(null);
    if (result.error) {
      toast({ title: "Failed to remove partner", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Partner removed" });
    if (hostelId) await fetchPartners(hostelId);
  }

  async function handleUpdatePartnerTier(partnershipId: string, tier: PartnerTier) {
    const previous = partners;
    setPartners((prev) => prev.map((p) => (p.partnership_id === partnershipId ? { ...p, tier } : p)));
    setUpdatingTierFor(partnershipId);
    const result = await updatePartnerTier(partnershipId, tier);
    setUpdatingTierFor(null);
    if (result.error) {
      setPartners(previous);
      toast({ title: "Failed to update access", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Access updated", description: `Now set to ${PARTNER_TIER_LABELS[tier]}.` });
  }

  function buildWhatsAppLink(partner: { name: string; email: string; phone?: string | null; password?: string }) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const credentialsLine = partner.password
      ? `Email: ${partner.email}\nPassword: ${partner.password}`
      : `Email: ${partner.email}\n\nPlease ask the hostel owner for your password.`;
    const msg = `Assalam o Alaikum ${partner.name},\n\nYour partner access for *${hostel?.name ?? "the hostel"}* has been set up.\n\nLogin URL: ${origin}/login\n${credentialsLine}\n\nWelcome aboard!`;
    const encoded = encodeURIComponent(msg);
    const normalizedPhone = partner.phone?.trim()
      ? partner.phone.replace(/\D/g, "").replace(/^0/, "92")
      : "";
    // wa.me requires a phone number in the path — without one it fails to open
    // a compose window on most platforms. api.whatsapp.com/send is the
    // officially documented endpoint for a phone-less "pick any contact" share.
    return normalizedPhone
      ? `https://wa.me/${normalizedPhone}?text=${encoded}`
      : `https://api.whatsapp.com/send?text=${encoded}`;
  }



  useEffect(() => {
    if (hostel) {
      // Kitchen group comes straight from the already-loaded context hostels (no
      // async fetch → no late pop-in / re-order of the accordion on refresh).
      setKitchenGroupId((hostels.find((h) => h.id === hostel.id) as { kitchen_group_id?: string | null } | undefined)?.kitchen_group_id ?? "");
      if (!isPartner) fetchPartners(hostel.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostel, hostels]);

  useEffect(() => {
    if (profile) setProfileForm({ full_name: profile.full_name ?? "" });
  }, [profile]);

  async function submitEmailChange() {
    const target = newEmail.trim();
    if (!target) return;
    setSendingEmailChange(true);
    const res = await requestEmailChange(target);
    setSendingEmailChange(false);
    if ("error" in res) {
      toast({ title: "Couldn't change email", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Confirmation sent", description: res.message });
    setEditingEmail(false);
    setNewEmail("");
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSavingProfile(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hms_profiles")
      .update({
        full_name: profileForm.full_name,
      })
      .eq("id", profile.id)
      .select("id");
    setSavingProfile(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not saved", description: "Your profile could not be updated. Please try again.", variant: "destructive" });
      return;
    }
    toast({ title: "Profile updated" });
  }


  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-serif font-normal tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your hostel and profile</p>
      </div>

      {/* Hostel Info */}
      <Section title="Hostel Information" icon={Building2}>
        <HostelInfoForm bare hostelId={hostelId ?? ""} country={hostel?.country} readOnly={!canFullTier} readOnlyNote={readOnlyNote} />
      </Section>

      {/* Package Pricing */}
      <Section title="Package Pricing" icon={Utensils}>
        <PackagePricingForm bare hostelId={hostelId ?? ""} country={hostel?.country} readOnly={!canFullTier} readOnlyNote={readOnlyNote} />
      </Section>

      {/* Branches + Partners — account-level, owner-only. A partner manages
          their branch, not the account's branch list or partner roster. */}
      {!isPartner && (<>

      {/* Shared Kitchen — only meaningful with more than one branch, so a
          single-branch owner never sees a control they cannot use. */}
      {hostels.length > 1 && (
        <Section title="Shared Kitchen" icon={ChefHat} description="If this branch's meals are cooked at another branch, say which one. The kitchen's groceries and cook salaries are then split across every branch it feeds, in proportion to how many people ate at each one.">
            <Select
              value={kitchenGroupId === "" ? "__self__" : kitchenGroupId}
              onValueChange={(v) => saveKitchenGroup(v === "__self__" ? "" : v)}
              disabled={savingKitchen || isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="Self-catered" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__self__">Self-catered — cooks its own food</SelectItem>
                {hostels.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.id === hostelId ? `${b.name} (this branch cooks for others)` : b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Set this on <span className="text-foreground">every branch in the group</span>, the one
              with the kitchen included — pick itself there. The split is an estimate: nobody weighs
              the food leaving the kitchen, so how many people ate is the fairest driver available.
              See Reports → Unit Cost.
            </p>
        </Section>
      )}

      {/* Partners */}
      <Section title="Partners" icon={Handshake} description={`Grant partners branch-scoped access — from read-only up to full owner-equal rights — ${partners.length} ${partners.length === 1 ? "partner" : "partners"} active`}>
          <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => hostelId && fetchPartners(hostelId)}
                disabled={loadingPartners}
                className="gap-1.5 h-8 text-xs"
              >
                <RefreshCw className={`w-3 h-3 ${loadingPartners ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={() => setShowAddPartner((p) => !p)}
                className="gap-1.5 h-8 text-xs bg-amber text-background hover:bg-amber/90 font-semibold"
              >
                <Plus className="w-3 h-3" />
                Add Partner
              </Button>
          </div>

          {/* Last-created credential share banner */}
          {lastCreatedPartner && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-semibold text-emerald-400">Partner created!</p>
                  <p className="text-xs text-muted-foreground">
                    Share credentials with <strong className="text-foreground">{lastCreatedPartner.name}</strong> via WhatsApp.
                    The password is only shown once — save it now.
                  </p>
                  <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                    <p>Email: <span className="text-foreground font-medium">{lastCreatedPartner.email}</span></p>
                    <p>Password: <span className="text-foreground font-medium font-mono">{lastCreatedPartner.password}</span></p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setLastCreatedPartner(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <a
                href={buildWhatsAppLink(lastCreatedPartner)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#25D366]/10 border border-[#25D366]/25 text-[#25D366] text-xs font-medium hover:bg-[#25D366]/15 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Share via WhatsApp
              </a>
            </div>
          )}

          {/* Add partner inline form */}
          {showAddPartner && (
            <div className="rounded-xl border border-amber/20 bg-amber/[0.04] p-4">
              {existingPartners.length > 0 && (
                <div className="flex gap-1 p-0.5 mb-3 rounded-lg bg-white/5 w-fit">
                  <button
                    type="button"
                    onClick={() => setPartnerMode("new")}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${partnerMode === "new" ? "bg-amber text-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    New Partner
                  </button>
                  <button
                    type="button"
                    onClick={() => setPartnerMode("existing")}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${partnerMode === "existing" ? "bg-amber text-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Existing Partner
                  </button>
                </div>
              )}

              {partnerMode === "new" ? (
                <form onSubmit={handleCreatePartner} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Full Name *</Label>
                      <Input
                        placeholder="Ahmed Khan"
                        value={partnerForm.name}
                        onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })}
                        required
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Phone *</Label>
                      <Input
                        placeholder="+92 300 0000000"
                        value={partnerForm.phone}
                        onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Email *</Label>
                      <Input
                        type="email"
                        placeholder="partner@example.com"
                        value={partnerForm.email}
                        onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Password * (min 8 chars)</Label>
                      <div className="relative">
                        <Input
                          type={showPartnerPassword ? "text" : "password"}
                          placeholder="Min 8 characters"
                          value={partnerForm.password}
                          onChange={(e) => setPartnerForm({ ...partnerForm, password: e.target.value })}
                          required
                          minLength={8}
                          className="pr-9"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPartnerPassword((p) => !p)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                        >
                          {showPartnerPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5 sm:w-1/2 sm:pr-1.5">
                    <Label>Access level</Label>
                    <Select value={partnerForm.tier} onValueChange={(v) => setPartnerForm({ ...partnerForm, tier: v as PartnerTier })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read_only">Read-only — view only</SelectItem>
                        <SelectItem value="standard">Standard — tenants, payments &amp; expenses</SelectItem>
                        <SelectItem value="full">Full — equal to owner on this branch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground/70">
                    {partnerForm.tier === "read_only" && "The partner will get read-only access to tenants and payments."}
                    {partnerForm.tier === "standard" && "The partner will be able to add tenants, record payments and log expenses on this branch."}
                    {partnerForm.tier === "full" && "The partner will have full, owner-equal access on this branch, including checkout and tenant edits."}
                    {" "}Share their credentials via WhatsApp after creation — the password will not be shown again.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { setShowAddPartner(false); setPartnerForm({ name: "", email: "", phone: "", password: "", tier: "read_only" }); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={creatingPartner || !partnerForm.name.trim() || !partnerForm.email.trim() || !partnerForm.phone.trim() || partnerForm.password.length < 8}
                      className="gap-1.5 bg-amber text-background hover:bg-amber/90 font-semibold"
                    >
                      {creatingPartner ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</>
                      ) : (
                        <><Plus className="w-3.5 h-3.5" /> Add Partner</>
                      )}
                    </Button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleAddExistingPartner} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Partner *</Label>
                    <Select value={selectedExistingPartnerId} onValueChange={setSelectedExistingPartnerId}>
                      <SelectTrigger><SelectValue placeholder="Select a partner from another branch" /></SelectTrigger>
                      <SelectContent>
                        {existingPartners.map((p) => (
                          <SelectItem key={p.partnerId} value={p.partnerId}>
                            {p.name} ({p.email}) — on {p.linkedHostelNames.join(", ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:w-1/2 sm:pr-1.5">
                    <Label>Access level</Label>
                    <Select value={existingPartnerTier} onValueChange={(v) => setExistingPartnerTier(v as PartnerTier)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read_only">Read-only — view only</SelectItem>
                        <SelectItem value="standard">Standard — tenants, payments &amp; expenses</SelectItem>
                        <SelectItem value="full">Full — equal to owner on this branch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground/70">
                    Attaches this partner to the current branch with the access level above. Their existing access on other branches is unchanged.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { setShowAddPartner(false); setSelectedExistingPartnerId(""); setExistingPartnerTier("read_only"); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={addingExistingPartner || !selectedExistingPartnerId}
                      className="gap-1.5 bg-amber text-background hover:bg-amber/90 font-semibold"
                    >
                      {addingExistingPartner ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…</>
                      ) : (
                        <><Plus className="w-3.5 h-3.5" /> Add to {words.branch}</>
                      )}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Partner list */}
          {loadingPartners ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading partners…</span>
            </div>
          ) : partners.length === 0 && !showAddPartner ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <Handshake className="w-8 h-8 opacity-20" />
              <p className="text-sm">No partners yet</p>
              <p className="text-xs">Add a partner and choose their access level for this branch</p>
            </div>
          ) : partners.length > 0 ? (
            <div className="rounded-xl border border-sidebar-border overflow-hidden">
              {partners.map((p, idx) => (
                <div
                  key={p.partnership_id}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02] ${idx > 0 ? "border-t border-sidebar-border" : ""}`}
                >
                  {/* Avatar */}
                  <div className="flex items-center justify-center w-9 h-9 rounded-full bg-amber/10 border border-amber/20 text-amber text-sm font-semibold shrink-0">
                    {(p.full_name ?? p.email)[0]?.toUpperCase() ?? "P"}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground truncate">
                        {p.full_name ?? "Unknown"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      <p className="text-xs text-muted-foreground truncate">{p.email}</p>
                      {p.phone && (
                        <p className="text-xs text-muted-foreground">{p.phone}</p>
                      )}
                    </div>
                  </div>

                  {/* Access tier */}
                  <div className="shrink-0 w-[104px]">
                    <Select
                      value={p.tier}
                      onValueChange={(v) => handleUpdatePartnerTier(p.partnership_id, v as PartnerTier)}
                      disabled={updatingTierFor === p.partnership_id}
                    >
                      <SelectTrigger className="h-7 text-xs px-2"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read_only">Read-only</SelectItem>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="full">Full</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={buildWhatsAppLink({ name: p.full_name ?? "Partner", email: p.email, phone: p.phone })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#25D366]/10 border border-[#25D366]/25 text-[#25D366] text-xs font-medium hover:bg-[#25D366]/15 transition-colors"
                      title="Share via WhatsApp"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      <span className="hidden sm:inline">Share</span>
                    </a>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Remove partner"
                      disabled={removingPartner === p.partnership_id}
                      onClick={() => handleRemovePartner(p.partnership_id, p.full_name ?? p.email)}
                    >
                      {removingPartner === p.partnership_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Section>
      </>)}

      {/* Payment Recovery */}
      <Section title="Payment Recovery" icon={MessageCircle}>
        <PaymentMethodsForm
          bare
          initialPaymentMethods={hostel?.payment_methods ?? []}
          initialReminderTemplate={hostel?.reminder_template}
          hostelName={hostel?.name ?? "Your Hostel"}
          whatsappEnabled={hostel?.whatsapp_enabled}
          readOnly={!canFullTier}
          readOnlyNote={readOnlyNote}
        />
      </Section>

      {/* Tenant Welcome & WiFi */}
      <Section title={`${words.tenant} Welcome & WiFi`} icon={MessageCircle} description="Automatic WhatsApp message sent the moment a tenant becomes active — room, WiFi, and the monthly menu link.">
          <fieldset disabled={!canFullTier} className="space-y-6 min-w-0">

          {/* WiFi Networks */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-semibold">WiFi Networks</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Device name &amp; password shown to new tenants — add more than one if you have multiple networks.</p>
              </div>
              <Button size="sm" variant="outline" onClick={addWifiNetwork} className="gap-1.5 h-8 shrink-0">
                <Plus className="w-3.5 h-3.5" /> Add Network
              </Button>
            </div>
            {wifiNetworks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-sidebar-border p-4 text-center">
                <Globe className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No WiFi networks added yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {wifiNetworks.map((w) => {
                  const cov = w.coverage ?? [];
                  const chip = (on: boolean) =>
                    `px-2.5 py-1 rounded-full text-[11px] border transition ${on ? "bg-amber/20 border-amber/50 text-amber" : "border-sidebar-border text-muted-foreground hover:border-amber/40"}`;
                  // Plain-language summary of who this network reaches, so the
                  // meaning is never implicit.
                  const selFloors = cov.filter((t) => t.startsWith("floor:")).map((t) => `Floor ${t.slice(6)}`);
                  const selRooms = cov.filter((t) => t.startsWith("room:")).map((t) => `Room ${t.slice(5)}`);
                  const coverSummary =
                    cov.length === 0
                      ? "Everyone — shown to all residents in this branch."
                      : `Only residents in ${[...selFloors, ...selRooms].join(", ")}.`;
                  return (
                  <div key={w.id} className="rounded-xl border border-sidebar-border bg-card/50 p-3 space-y-3">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Device Name</p>
                        <Input
                          placeholder="e.g. Hostel_5G"
                          value={w.name}
                          onChange={(e) => updateWifiNetwork(w.id, { name: e.target.value })}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Password</p>
                        <Input
                          placeholder="hostel123"
                          value={w.password ?? ""}
                          onChange={(e) => updateWifiNetwork(w.id, { password: e.target.value })}
                          className="h-9 text-sm"
                        />
                      </div>
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => removeWifiNetwork(w.id)}
                        className="h-9 w-9 text-muted-foreground hover:text-rose-400 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    {/* Covers — who this network is shown to. "Everyone" (nothing
                        picked) means the whole hostel; pick floors/rooms to limit it
                        so a resident only sees the WiFi that reaches where they sleep. */}
                    <div className="space-y-1.5 border-t border-sidebar-border/60 pt-2.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Covers</p>
                      <div className="flex flex-wrap gap-1.5">
                        {/* Everyone = whole hostel. Active when nothing is scoped;
                            tapping it clears any floor/room selection. */}
                        <button type="button" onClick={() => updateWifiNetwork(w.id, { coverage: [] })} className={chip(cov.length === 0)}>
                          Everyone
                        </button>
                        {coverageFloors.map((f) => {
                          const tok = floorToken(f);
                          return (
                            <button key={tok} type="button" onClick={() => toggleWifiCoverage(w.id, tok)} className={chip(cov.includes(tok))}>
                              Floor {f}
                            </button>
                          );
                        })}
                        {coverageRoomNumbers.map((rn) => {
                          const tok = roomToken(rn);
                          return (
                            <button key={tok} type="button" onClick={() => toggleWifiCoverage(w.id, tok)} className={chip(cov.includes(tok))}>
                              Room {rn}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-muted-foreground/70">{coverSummary}</p>
                      {coverageFloors.length === 0 && coverageRoomNumbers.length === 0 && (
                        <p className="text-[11px] text-muted-foreground/50">Add rooms to this branch to limit a network to specific floors or rooms.</p>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Meal Times */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Meal Times</Label>
            <p className="text-xs text-muted-foreground -mt-1">Shown in the welcome message via {"{meal_times}"} — leave a meal&apos;s From/To blank to leave it out (not every hostel serves lunch).</p>
            <MealTimesFields value={mealTimes} onChange={updateMealTime} />
          </div>

          {/* Welcome Message Template */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Welcome Message Template</Label>
            <textarea
              value={welcomeTemplate}
              onChange={(e) => setWelcomeTemplate(e.target.value)}
              rows={8}
              className="w-full rounded-xl border border-sidebar-border bg-card p-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 resize-y"
            />
            <p className="text-[11px] text-muted-foreground">
              Placeholders:&nbsp;
              {["{name}", "{hostel}", "{room}", "{wifi}", "{menu}", "{meal_times}"].map((p) => (
                <code key={p} className="text-foreground mx-0.5 px-1 py-0.5 rounded bg-white/5">{p}</code>
              ))}
            </p>
            {!hostel?.listing_enabled && (
              <p className="text-[11px] text-muted-foreground/70">
                {"{menu}"} will be left out of the message until your public listing page is enabled — the monthly menu link needs that page turned on.
              </p>
            )}
          </div>

          {/* WhatsApp status — same curated whatsapp_enabled gate as reminders/announcements */}
          {hostel?.whatsapp_enabled && (
          <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] p-3">
            <p className="text-xs font-semibold text-emerald-400">Auto Welcome Message — Active</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Every tenant gets this message the moment they become active — a brand-new active tenant, or a
              waiting-list tenant whose room finally gets assigned.
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
              <pre className="whitespace-pre-wrap text-sm font-sans text-foreground leading-relaxed">{welcomePreview}</pre>
            </div>
          </div>

          </fieldset>
          {canFullTier ? (
            <Button onClick={saveWelcomeSettingsHandler} disabled={savingWelcome} className="gap-2">
              {savingWelcome ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Welcome Settings
            </Button>
          ) : readOnlyNote}
      </Section>

      {/* Profile */}
      <Section title="Your Profile" icon={User} description="Update your personal information">
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              {!editingEmail ? (
                <div className="flex items-center gap-2">
                  <Input value={(profile as unknown as { email?: string })?.email ?? ""} disabled className="bg-muted flex-1" />
                  <Button type="button" variant="outline" onClick={() => { setEditingEmail(true); setNewEmail(""); }}>Change</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    type="email"
                    placeholder="new@email.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newEmail.trim() && !sendingEmailChange) void submitEmailChange(); } }}
                    disabled={sendingEmailChange}
                    autoComplete="email"
                  />
                  <p className="text-xs text-muted-foreground">
                    We&apos;ll send a confirmation link to the new address. Your sign-in email changes only after you click it.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button type="button" onClick={submitEmailChange} disabled={sendingEmailChange || !newEmail.trim()} className="gap-2">
                      {sendingEmailChange ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Send confirmation
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => { setEditingEmail(false); setNewEmail(""); }} disabled={sendingEmailChange}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input placeholder="Your name" value={profileForm.full_name} onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })} />
            </div>
            <Button type="submit" disabled={savingProfile} className="gap-2">
              {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Profile
            </Button>
          </form>
      </Section>

      {/* Danger zone — delete this branch. Owner-only, and never the last branch
          (an account keeps at least one). Deletion is confirmed by an emailed link. */}
      {!isPartner && hostels.length > 1 && (
        <Section title={`Delete this ${words.branch.toLowerCase()}`} icon={Trash2} danger description={`Permanently delete "${hostel?.name}" and everything in it. We'll email you a confirmation link — nothing is deleted until you click it.`}>
              <Button variant="destructive" onClick={requestDeleteBranch} disabled={requestingDelete} className="gap-2">
                {requestingDelete ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete this {words.branch.toLowerCase()}…
              </Button>
              <p className="text-xs text-muted-foreground">
                This permanently deletes the {words.branch.toLowerCase()} and all its rooms, {words.tenants.toLowerCase()} and payment records. Your last {words.branch.toLowerCase()} can&apos;t be deleted.
              </p>
        </Section>
      )}
    </div>
  );
}
