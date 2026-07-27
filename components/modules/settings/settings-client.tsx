"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Building2, User, Save, Loader2, Globe, ExternalLink, Clock, Phone, RefreshCw, Utensils, GitBranch, Plus, Check, ArrowRightLeft, Handshake, Eye, EyeOff, Trash2, X, Pencil, FormInput, ImagePlus, MessageCircle, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useHostelContext } from "@/contexts/hostel-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { getOwnedHostels, switchActiveHostel, renameBranch } from "@/app/actions/branches";
import { listPartners, createPartner, removePartner, updatePartnerTier, updatePartnerFeatureFlags, getExistingPartnersForOwner, addPartnerToHostel } from "@/app/actions/partners";
import type { PartnerRow, ExistingPartnerOption } from "@/app/actions/partners";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PARTNER_TIER_LABELS } from "@/lib/partner-tier-labels";
import type { HostelType, Hostel, FormConfig, FormFieldConfig, PaymentMethodAccount, PackageTier, PartnerTier, PartnerFeatureFlags, WifiNetwork, MealTimes } from "@/types";
import { DEFAULT_FORM_CONFIG } from "@/types";
import { savePaymentRecoverySettings, saveWelcomeSettings } from "@/app/actions/settings";
import { DEFAULT_REMINDER_TEMPLATE, formatAccounts, buildReminderMessage } from "@/lib/whatsapp-reminder";
import { DEFAULT_WELCOME_TEMPLATE, buildWelcomeMessage } from "@/lib/whatsapp-welcome";
import { SEATER_CAPACITIES, SEATER_LABELS } from "@/lib/seater-pricing";

const HOSTEL_TYPES: { value: HostelType; label: string }[] = [
  { value: "boys",   label: "Boys Only" },
  { value: "girls",  label: "Girls Only" },
  { value: "mixed",  label: "Mixed" },
  { value: "family", label: "Family" },
];

const ALL_AMENITIES = [
  "WiFi", "AC", "Generator / UPS", "Meals Included", "Laundry",
  "Parking", "CCTV", "Hot Water", "Study Room", "Attached Bath", "Security Guard", "Cupboard",
];

type PkgPriceEntry = { no_ac: string; ac: string; deposit_no_ac: string; deposit_ac: string };
type PkgPriceForm = Record<PackageTier, PkgPriceEntry>;

const PACKAGE_TIER_CONFIGS: { tier: PackageTier; label: string; desc: string; hasAcVariant: boolean }[] = [
  { tier: "space_only",          label: "Space Only",                  desc: "No meals",                  hasAcVariant: true  },
  { tier: "space_food",          label: "Space + Breakfast & Dinner",  desc: "2 meals / day",             hasAcVariant: true  },
  { tier: "space_3meals",        label: "Space + 3 Meals",             desc: "Breakfast, lunch & dinner", hasAcVariant: true  },
  { tier: "space_meals_cooler",  label: "Space + Meals + Cooler",      desc: "Meals + cooler",            hasAcVariant: false },
];

function emptyPriceForm(): PkgPriceForm {
  return {
    space_only:         { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" },
    space_food:         { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" },
    space_3meals:       { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" },
    space_food_ac:      { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" }, // kept for DB compatibility; not shown in UI
    space_meals_cooler: { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" },
  };
}

export function SettingsClient() {
  const { profile, hostel, partnerTier } = useHostelContext();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const hostelId = hostel?.id ?? null;
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
  type OwnedHostel = Hostel & { is_primary: boolean };
  const [branches, setBranches] = useState<OwnedHostel[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [savingRename, setSavingRename] = useState(false);

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
  const [updatingFlagsFor, setUpdatingFlagsFor] = useState<string | null>(null);
  // Other branches' partners this owner can attach to the current branch
  const [existingPartners, setExistingPartners] = useState<ExistingPartnerOption[]>([]);
  const [selectedExistingPartnerId, setSelectedExistingPartnerId] = useState("");
  const [existingPartnerTier, setExistingPartnerTier] = useState<PartnerTier>("read_only");
  const [addingExistingPartner, setAddingExistingPartner] = useState(false);
  // lastCreatedPartner holds credentials for WhatsApp share — cleared on dialog close
  const [lastCreatedPartner, setLastCreatedPartner] = useState<{ name: string; email: string; phone: string; password: string } | null>(null);

  const [hostelForm, setHostelForm] = useState({
    name: "", address: "", city: "", area: "", phone: "", whatsapp: "", email: "", total_capacity: "",
  });
  const [listingForm, setListingForm] = useState({
    listing_enabled: true,
    maps_url: "",
    description: "",
    hostel_type: "" as HostelType | "",
    amenities: [] as string[],
    food_closed_on_sundays: false,
  });
  const [profileForm, setProfileForm] = useState({ full_name: "" });
  const [savingHostel, setSavingHostel] = useState(false);
  const [savingListing, setSavingListing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [packageForm, setPackageForm] = useState<{ ac_per_unit_rate: string; security_deposit: string; notice_period_days: string; prices: PkgPriceForm }>({
    ac_per_unit_rate: "", security_deposit: "", notice_period_days: "30", prices: emptyPriceForm(),
  });
  const [foodAddonForm, setFoodAddonForm] = useState<{ breakfast: string; lunch: string; dinner: string; allMeals: string }>({
    breakfast: "", lunch: "", dinner: "", allMeals: "",
  });
  const [seaterForm, setSeaterForm] = useState<Record<string, { no_ac: string; ac: string; deposit_no_ac: string; deposit_ac: string }>>(
    Object.fromEntries(SEATER_CAPACITIES.map((c) => [c, { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" }]))
  );
  const [customRows, setCustomRows] = useState<Array<{ id: string; name: string; no_ac: string; ac: string; deposit_no_ac: string; deposit_ac: string }>>([]);
  const [savingPackage, setSavingPackage] = useState(false);
  const [packageLoaded, setPackageLoaded] = useState(false);

  const [formConfig, setFormConfig] = useState<Required<FormConfig>>({ ...DEFAULT_FORM_CONFIG });
  const [savingFormConfig, setSavingFormConfig] = useState(false);

  // Payment Recovery state
  function uid() { return Math.random().toString(36).slice(2, 10); }
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodAccount[]>(
    () => (hostel?.payment_methods ?? []).map((m) => ({ ...m, id: m.id || uid() }))
  );
  const [reminderTemplate, setReminderTemplate] = useState(
    hostel?.reminder_template ?? DEFAULT_REMINDER_TEMPLATE
  );
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
    if (result.success) toast({ title: "Payment recovery settings saved" });
    else toast({ title: "Error", description: result.error, variant: "destructive" });
  }
  const recoveryPreview = buildReminderMessage({
    template: reminderTemplate,
    tenantName: "Ali Raza",
    amount: 15000,
    month: new Date().toLocaleDateString("en-PK", { month: "long", year: "numeric" }),
    hostelName: hostel?.name ?? "Your Hostel",
    accounts: paymentMethods,
  });

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

  function addWifiNetwork() {
    setWifiNetworks((prev) => [...prev, { id: uid(), name: "", password: "" }]);
  }
  function updateWifiNetwork(id: string, patch: Partial<WifiNetwork>) {
    setWifiNetworks((prev) => prev.map((w) => w.id === id ? { ...w, ...patch } : w));
  }
  function removeWifiNetwork(id: string) {
    setWifiNetworks((prev) => prev.filter((w) => w.id !== id));
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
    if (result.success) toast({ title: "Tenant welcome settings saved" });
    else toast({ title: "Error", description: result.error, variant: "destructive" });
  }
  const welcomePreview = buildWelcomeMessage({
    template: welcomeTemplate,
    tenantName: "Ali Raza",
    hostelName: hostel?.name ?? "Your Hostel",
    room: "5",
    wifiNetworks,
    menuUrl: hostel?.listing_enabled && hostel?.slug ? `https://hms.yourpulse.io/find/${hostel.slug}` : null,
    mealTimes,
  });

  type WaitlistEntry = { id: string; name: string; phone: string; created_at: string };
  const [waitlist, setWaitlist]           = useState<WaitlistEntry[]>([]);
  const [loadingWaitlist, setLoadingWaitlist] = useState(false);

  async function fetchWaitlist(id: string) {
    setLoadingWaitlist(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("hms_waitlist")
      .select("id, name, phone, created_at")
      .eq("hostel_id", id)
      .order("created_at", { ascending: false });
    setWaitlist((data ?? []) as WaitlistEntry[]);
    setLoadingWaitlist(false);
  }

  async function fetchPackageConfig(id: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("hms_package_configs")
      .select("ac_per_unit_rate, security_deposit, notice_period_days, package_prices, food_breakfast_rate, food_lunch_rate, food_dinner_rate, food_all_meals_rate, seater_prices")
      .eq("hostel_id", id)
      .maybeSingle();
    if (data) {
      const raw = (data.package_prices ?? {}) as Record<string, unknown>;
      const prices = emptyPriceForm();
      for (const cfg of PACKAGE_TIER_CONFIGS) {
        const s = raw[cfg.tier] as { no_ac: number; ac: number; deposit_no_ac?: number; deposit_ac?: number } | undefined;
        if (s) {
          prices[cfg.tier] = {
            no_ac:         s.no_ac > 0               ? String(s.no_ac)         : "",
            ac:            s.ac    > 0               ? String(s.ac)            : "",
            deposit_no_ac: (s.deposit_no_ac ?? 0) > 0 ? String(s.deposit_no_ac) : "",
            deposit_ac:    (s.deposit_ac    ?? 0) > 0 ? String(s.deposit_ac)    : "",
          };
        }
      }
      setPackageForm({
        ac_per_unit_rate: data.ac_per_unit_rate?.toString() ?? "0",
        security_deposit: data.security_deposit > 0 ? String(data.security_deposit) : "",
        notice_period_days: data.notice_period_days != null ? String(data.notice_period_days) : "30",
        prices,
      });
      const customData = (raw._custom ?? []) as Array<{
        id: string; name: string; no_ac: number; ac: number;
        deposit_no_ac?: number; deposit_ac?: number;
      }>;
      setCustomRows(customData.map((c) => ({
        id: c.id || crypto.randomUUID(),
        name: c.name ?? "",
        no_ac: c.no_ac > 0 ? String(c.no_ac) : "",
        ac: c.ac > 0 ? String(c.ac) : "",
        deposit_no_ac: (c.deposit_no_ac ?? 0) > 0 ? String(c.deposit_no_ac) : "",
        deposit_ac: (c.deposit_ac ?? 0) > 0 ? String(c.deposit_ac) : "",
      })));
      setFoodAddonForm({
        breakfast: data.food_breakfast_rate > 0 ? String(data.food_breakfast_rate) : "",
        lunch: data.food_lunch_rate > 0 ? String(data.food_lunch_rate) : "",
        dinner: data.food_dinner_rate > 0 ? String(data.food_dinner_rate) : "",
        allMeals: data.food_all_meals_rate > 0 ? String(data.food_all_meals_rate) : "",
      });
      const rawSeater = (data.seater_prices ?? {}) as Record<string, { no_ac?: number; ac?: number; deposit_no_ac?: number; deposit_ac?: number }>;
      setSeaterForm(Object.fromEntries(SEATER_CAPACITIES.map((c) => [
        c,
        {
          no_ac: (rawSeater[c]?.no_ac ?? 0) > 0 ? String(rawSeater[c]!.no_ac) : "",
          ac: (rawSeater[c]?.ac ?? 0) > 0 ? String(rawSeater[c]!.ac) : "",
          deposit_no_ac: (rawSeater[c]?.deposit_no_ac ?? 0) > 0 ? String(rawSeater[c]!.deposit_no_ac) : "",
          deposit_ac: (rawSeater[c]?.deposit_ac ?? 0) > 0 ? String(rawSeater[c]!.deposit_ac) : "",
        },
      ])));
    }
    setPackageLoaded(true);
  }

  async function fetchBranches() {
    setLoadingBranches(true);
    const { hostels: list } = await getOwnedHostels();
    setBranches(list);
    setLoadingBranches(false);
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

  async function handleToggleFeatureFlag(partnershipId: string, key: keyof PartnerFeatureFlags, label: string, enabled: boolean) {
    const previous = partners;
    const target = partners.find((p) => p.partnership_id === partnershipId);
    // Send the full merged flags object, not just the changed key — the two
    // flags are independently toggleable and the server action overwrites
    // feature_flags wholesale, so a partial payload would silently drop the other flag.
    const nextFlags = { ...target?.feature_flags, [key]: enabled };
    setPartners((prev) => prev.map((p) => (p.partnership_id === partnershipId ? { ...p, feature_flags: nextFlags } : p)));
    setUpdatingFlagsFor(partnershipId);
    const result = await updatePartnerFeatureFlags(partnershipId, nextFlags);
    setUpdatingFlagsFor(null);
    if (result.error) {
      setPartners(previous);
      toast({ title: "Failed to update feature", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: `${label} ${enabled ? "enabled" : "disabled"}` });
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

  async function handleSwitchBranch(branchId: string) {
    if (branchId === hostelId) return;
    setSwitchingBranch(branchId);
    const result = await switchActiveHostel(branchId);
    setSwitchingBranch(null);
    if (result.error) {
      toast({ title: "Could not switch branch", description: result.error, variant: "destructive" });
      return;
    }
    startTransition(() => { router.refresh(); });
  }

  function startEditBranch(b: OwnedHostel) {
    setEditingBranchId(b.id);
    setEditName(b.name);
    setEditCity(b.city ?? "");
    setEditAddress(b.address ?? "");
  }

  async function handleRenameBranch(hostelId: string) {
    if (!editName.trim()) return;
    setSavingRename(true);
    const result = await renameBranch({ hostelId, name: editName, city: editCity, address: editAddress });
    setSavingRename(false);
    if (result.error) {
      toast({ title: "Failed to rename", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Branch renamed", description: `"${editName}" saved.` });
    setEditingBranchId(null);
    await fetchBranches();
  }


  useEffect(() => {
    // Branches/Partners cards are owner-only, and both actions are guarded
    // owner-only server-side — fetching them as a partner is a wasted round
    // trip that can only come back as an error.
    if (!isPartner) fetchBranches();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPartner]);

  useEffect(() => {
    if (hostel) {
      setHostelForm({
        name: hostel.name ?? "",
        address: hostel.address ?? "",
        city: hostel.city ?? "",
        area: hostel.area ?? "",
        phone: hostel.phone ?? "",
        whatsapp: hostel.whatsapp ?? "",
        email: hostel.email ?? "",
        total_capacity: hostel.total_capacity?.toString() ?? "",
      });
      setListingForm({
        listing_enabled: hostel.listing_enabled ?? true,
        maps_url: hostel.maps_url ?? "",
        description: hostel.description ?? "",
        hostel_type: hostel.hostel_type ?? "",
        amenities: hostel.amenities ?? [],
        food_closed_on_sundays: hostel.food_closed_on_sundays ?? false,
      });
      setCoverImageUrl(hostel.cover_image_url ?? null);
      fetchWaitlist(hostel.id);
      fetchPackageConfig(hostel.id);
      if (!isPartner) fetchPartners(hostel.id);
      if (hostel.form_config) {
        setFormConfig({ ...DEFAULT_FORM_CONFIG, ...(hostel.form_config as FormConfig) });
      }
    }
  }, [hostel]);

  useEffect(() => {
    if (profile) setProfileForm({ full_name: profile.full_name ?? "" });
  }, [profile]);

  async function saveHostel(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId) return;
    setSavingHostel(true);
    const supabase = createClient();
    const { data, error } = await supabase.from("hms_hostels").update({
      name: hostelForm.name,
      address: hostelForm.address || null,
      city: hostelForm.city || null,
      area: hostelForm.area || null,
      phone: hostelForm.phone || null,
      whatsapp: hostelForm.whatsapp || null,
      email: hostelForm.email || null,
      total_capacity: parseInt(hostelForm.total_capacity) || 0,
    }).eq("id", hostelId).select("id");
    setSavingHostel(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    toast({ title: "Hostel settings saved" });
  }

  async function saveListing(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId) return;
    setSavingListing(true);
    const supabase = createClient();
    const updatePayload: Record<string, unknown> = {
      listing_enabled: listingForm.listing_enabled,
      maps_url: listingForm.maps_url || null,
      description: listingForm.description || null,
      hostel_type: listingForm.hostel_type || null,
      amenities: listingForm.amenities,
      food_closed_on_sundays: listingForm.food_closed_on_sundays,
    };
    // Auto-generate slug if enabling listing and no slug exists yet
    if (listingForm.listing_enabled && !hostel?.slug) {
      const base = (hostelForm.name || hostel?.name || "hostel")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, "-")
        .replace(/^-+|-+$/g, "");
      updatePayload.slug = base || hostelId.slice(0, 8);
    }
    const { data, error } = await supabase.from("hms_hostels").update(updatePayload).eq("id", hostelId).select("id");
    setSavingListing(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    toast({
      title: listingForm.listing_enabled ? "Listing published" : "Listing hidden",
      description: listingForm.listing_enabled
        ? "Your hostel is now visible on the public directory. The application form link is now active."
        : "Your hostel has been removed from the public directory.",
    });
  }

  async function uploadCoverImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !hostelId) return;
    if (file.size > 3 * 1024 * 1024) {
      toast({ title: "File too large", description: "Cover image must be under 3 MB.", variant: "destructive" });
      return;
    }
    setUploadingCover(true);
    const supabase = createClient();
    // Derive MIME type from file name extension — not file.type which is browser-determined and can be empty/spoofed
    const fname = file.name.toLowerCase();
    const ext = fname.endsWith(".png") ? "png" : fname.endsWith(".webp") ? "webp" : "jpg";
    const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const path = `${hostelId}/cover.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("hostel-covers")
      .upload(path, file, { upsert: true, contentType });
    if (uploadErr) {
      toast({ title: "Upload failed", description: uploadErr.message, variant: "destructive" });
      setUploadingCover(false);
      return;
    }
    const { data: { publicUrl } } = supabase.storage.from("hostel-covers").getPublicUrl(path);
    const { data: updated, error: updateErr } = await supabase
      .from("hms_hostels")
      .update({ cover_image_url: publicUrl })
      .eq("id", hostelId)
      .select("id");
    if (updateErr) {
      toast({ title: "Error", description: updateErr.message, variant: "destructive" });
    } else if (!updated || updated.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
    } else {
      setCoverImageUrl(publicUrl);
      toast({ title: "Cover image updated" });
    }
    setUploadingCover(false);
    if (coverInputRef.current) coverInputRef.current.value = "";
  }

  async function removeCoverImage() {
    if (!hostelId) return;
    const supabase = createClient();
    // Delete the storage object across all possible extensions to avoid orphaned files
    await Promise.all(["jpg", "jpeg", "png", "webp"].map((ext) =>
      supabase.storage.from("hostel-covers").remove([`${hostelId}/cover.${ext}`])
    ));
    const { data, error } = await supabase.from("hms_hostels").update({ cover_image_url: null }).eq("id", hostelId).select("id");
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    setCoverImageUrl(null);
    toast({ title: "Cover image removed" });
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSavingProfile(true);
    const supabase = createClient();
    const { data, error } = await supabase.from("hms_profiles").update({ full_name: profileForm.full_name }).eq("id", profile.id).select("id");
    setSavingProfile(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not saved", description: "Your profile could not be updated. Please try again.", variant: "destructive" });
      return;
    }
    toast({ title: "Profile updated" });
  }

  async function savePackageConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId) return;
    setSavingPackage(true);
    const supabase = createClient();
    const dbPayload: Record<string, unknown> = {};
    for (const cfg of PACKAGE_TIER_CONFIGS) {
      const p = packageForm.prices[cfg.tier];
      dbPayload[cfg.tier] = {
        no_ac:         parseFloat(p.no_ac)         || 0,
        ac:            parseFloat(p.ac)            || 0,
        deposit_no_ac: parseFloat(p.deposit_no_ac) || 0,
        deposit_ac:    parseFloat(p.deposit_ac)    || 0,
      };
    }
    const validCustom = customRows.filter((c) => c.name.trim());
    if (validCustom.length > 0) {
      dbPayload._custom = validCustom.map((c) => ({
        id: c.id,
        name: c.name.trim(),
        no_ac: parseFloat(c.no_ac) || 0,
        ac: parseFloat(c.ac) || 0,
        deposit_no_ac: parseFloat(c.deposit_no_ac) || 0,
        deposit_ac: parseFloat(c.deposit_ac) || 0,
      }));
    }
    const seaterPayload: Record<string, { no_ac: number; ac: number; deposit_no_ac: number; deposit_ac: number }> = {};
    for (const c of SEATER_CAPACITIES) {
      const no_ac = parseFloat(seaterForm[c]?.no_ac) || 0;
      const ac = parseFloat(seaterForm[c]?.ac) || 0;
      const deposit_no_ac = parseFloat(seaterForm[c]?.deposit_no_ac) || 0;
      const deposit_ac = parseFloat(seaterForm[c]?.deposit_ac) || 0;
      if (no_ac > 0 || ac > 0 || deposit_no_ac > 0 || deposit_ac > 0) {
        seaterPayload[c] = { no_ac, ac, deposit_no_ac, deposit_ac };
      }
    }

    const { data, error } = await supabase
      .from("hms_package_configs")
      .upsert(
        {
          hostel_id:            hostelId,
          ac_per_unit_rate:     parseFloat(packageForm.ac_per_unit_rate) || 0,
          security_deposit:     parseFloat(packageForm.security_deposit) || 0,
          notice_period_days:   parseInt(packageForm.notice_period_days, 10) || 30,
          package_prices:       dbPayload,
          food_breakfast_rate:  parseFloat(foodAddonForm.breakfast) || 0,
          food_lunch_rate:      parseFloat(foodAddonForm.lunch) || 0,
          food_dinner_rate:     parseFloat(foodAddonForm.dinner) || 0,
          food_all_meals_rate:  parseFloat(foodAddonForm.allMeals) || 0,
          seater_prices:        seaterPayload,
          updated_at:           new Date().toISOString(),
        },
        { onConflict: "hostel_id" }
      )
      .select("hostel_id");
    setSavingPackage(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    toast({ title: "Package pricing saved" });
  }

  async function saveFormConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId) return;
    setSavingFormConfig(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hms_hostels")
      .update({ form_config: formConfig })
      .eq("id", hostelId)
      .select("id");
    setSavingFormConfig(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    toast({ title: "Form fields saved" });
  }

  function toggleAmenity(a: string) {
    setListingForm((f) => ({
      ...f,
      amenities: f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a],
    }));
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-serif font-normal tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your hostel and profile</p>
      </div>

      {/* Hostel Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-muted-foreground" /><CardTitle className="text-base">Hostel Information</CardTitle></div>
          <CardDescription>Update your hostel details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveHostel} className="space-y-4">
            <fieldset disabled={!canFullTier} className="space-y-4 min-w-0">
            <div className="space-y-1.5">
              <Label>Hostel Name *</Label>
              <Input placeholder="My Hostel" value={hostelForm.name} onChange={(e) => setHostelForm({ ...hostelForm, name: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input placeholder="Street address" value={hostelForm.address} onChange={(e) => setHostelForm({ ...hostelForm, address: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input placeholder="Karachi" value={hostelForm.city} onChange={(e) => setHostelForm({ ...hostelForm, city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Area / Neighbourhood</Label>
                <Input placeholder="Gulshan-e-Iqbal" value={hostelForm.area} onChange={(e) => setHostelForm({ ...hostelForm, area: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="+92 300 0000000" value={hostelForm.phone} onChange={(e) => setHostelForm({ ...hostelForm, phone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp</Label>
                <Input placeholder="+92 300 0000000" value={hostelForm.whatsapp} onChange={(e) => setHostelForm({ ...hostelForm, whatsapp: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" placeholder="hostel@example.com" value={hostelForm.email} onChange={(e) => setHostelForm({ ...hostelForm, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Total Capacity</Label>
                <Input type="number" placeholder="0" min="0" value={hostelForm.total_capacity} onChange={(e) => setHostelForm({ ...hostelForm, total_capacity: e.target.value })} />
              </div>
            </div>
            </fieldset>
            {canFullTier ? (
              <Button type="submit" disabled={savingHostel} className="gap-2">
                {savingHostel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Hostel
              </Button>
            ) : readOnlyNote}
          </form>
        </CardContent>
      </Card>

      <Separator />

      {/* Public Listing */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Public Listing</CardTitle>
          </div>
          <CardDescription>
            Publish your own page so tenants can view rooms and apply directly — share the link on WhatsApp, Facebook, or anywhere else.{" "}
            <a href="/find" target="_blank" className="inline-flex items-center gap-0.5 text-amber hover:underline">
              Preview my page <ExternalLink className="w-3 h-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveListing} className="space-y-5">
            <fieldset disabled={!canFullTier} className="space-y-5 min-w-0">
            {/* Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-sidebar-border bg-white/[0.02]">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {listingForm.listing_enabled ? "Listed publicly" : "Not listed"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {listingForm.listing_enabled
                    ? "Your hostel appears in the public directory."
                    : "Enable to appear in the public hostel directory."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setListingForm((f) => ({ ...f, listing_enabled: !f.listing_enabled }))}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none ${
                  listingForm.listing_enabled ? "bg-amber" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                    listingForm.listing_enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {listingForm.listing_enabled && (
              <>
                {/* Info notice */}
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-amber/5 border border-amber/15 text-xs text-muted-foreground">
                  <Building2 className="w-3.5 h-3.5 text-amber shrink-0 mt-0.5" />
                  <span>
                    Name, city, area, phone, email, and capacity are pulled from{" "}
                    <strong className="text-foreground">Hostel Information</strong> above — no need to enter them again.
                  </span>
                </div>

                {/* Cover Image */}
                <div className="space-y-2">
                  <Label>Cover Image</Label>
                  <p className="text-xs text-muted-foreground">Shown on the /find directory card. JPEG, PNG or WebP · max 3 MB.</p>
                  {coverImageUrl ? (
                    <div className="relative w-full h-36 rounded-xl overflow-hidden border border-white/[0.08] group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={coverImageUrl} alt="Cover" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => coverInputRef.current?.click()}
                          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium backdrop-blur-sm transition-colors"
                        >
                          {uploadingCover ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={removeCoverImage}
                          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-medium backdrop-blur-sm transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      disabled={uploadingCover}
                      className="w-full h-28 rounded-xl border-2 border-dashed border-white/[0.08] hover:border-amber/30 hover:bg-amber/[0.02] flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-all"
                    >
                      {uploadingCover
                        ? <Loader2 className="w-5 h-5 animate-spin text-amber" />
                        : <ImagePlus className="w-5 h-5" />}
                      <span className="text-xs">{uploadingCover ? "Uploading…" : "Click to upload cover image"}</span>
                    </button>
                  )}
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={uploadCoverImage}
                  />
                </div>

                {/* Google Maps link */}
                <div className="space-y-1.5">
                  <Label>Google Maps Link</Label>
                  <Input type="url" placeholder="https://maps.google.com/…" value={listingForm.maps_url} onChange={(e) => setListingForm({ ...listingForm, maps_url: e.target.value })} />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <Label>Short Description</Label>
                  <textarea
                    rows={3}
                    placeholder="Tell prospective tenants about your hostel…"
                    value={listingForm.description}
                    onChange={(e) => setListingForm({ ...listingForm, description: e.target.value })}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                  />
                </div>

                {/* Hostel Type */}
                <div className="space-y-2">
                  <Label>Hostel Type</Label>
                  <div className="flex flex-wrap gap-2">
                    {HOSTEL_TYPES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setListingForm((f) => ({ ...f, hostel_type: f.hostel_type === t.value ? "" : t.value }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          listingForm.hostel_type === t.value
                            ? "bg-amber/10 text-amber border-amber/30"
                            : "border-sidebar-border text-muted-foreground hover:text-foreground hover:border-sidebar-border/80"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amenities */}
                <div className="space-y-2">
                  <Label>Amenities</Label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_AMENITIES.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => toggleAmenity(a)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          listingForm.amenities.includes(a)
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "border-sidebar-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Kitchen / Sunday food */}
                <div className="flex items-center justify-between p-3.5 rounded-xl border border-sidebar-border bg-white/[0.02]">
                  <div>
                    <p className="text-sm font-medium text-foreground">Kitchen closed on Sundays</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Enable if meals are not served on Sundays — shown on your public page</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setListingForm((f) => ({ ...f, food_closed_on_sundays: !f.food_closed_on_sundays }))}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none ${
                      listingForm.food_closed_on_sundays ? "bg-amber" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                        listingForm.food_closed_on_sundays ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </>
            )}

            </fieldset>
            {canFullTier ? (
              <Button type="submit" disabled={savingListing} className="gap-2">
                {savingListing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Listing
              </Button>
            ) : readOnlyNote}
          </form>
        </CardContent>
      </Card>

      <Separator />

      {/* Form Builder */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FormInput className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Application Form Fields</CardTitle>
          </div>
          <CardDescription>
            Choose which fields appear on your public tenant application form. Full Name and WhatsApp are always required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveFormConfig} className="space-y-4">
            <fieldset disabled={!canFullTier} className="space-y-4 min-w-0">
            {(
              [
                { key: "email",              label: "Email Address",        description: "Tenant's email for correspondence" },
                { key: "cnic",               label: "CNIC",                 description: "National ID number (42101-XXXXXXX-X)" },
                { key: "type",               label: "Type",                 description: "Student / Professional / General" },
                { key: "room_preference",    label: "Room Selection",       description: "Lets applicants pick a specific available room" },
                { key: "move_in_date",       label: "Preferred Move-in Date", description: "Requested check-in date" },
                { key: "emergency_contact",  label: "Emergency Contact",    description: "Contact name, phone, and relationship" },
                { key: "notes",              label: "Message / Questions",  description: "Free text for special requests" },
              ] as { key: keyof FormConfig; label: string; description: string }[]
            ).map(({ key, label, description }) => {
              const field: FormFieldConfig = formConfig[key] ?? { enabled: true, required: false };
              return (
                <div key={key} className={`rounded-xl border p-4 transition-colors ${field.enabled ? "border-sidebar-border bg-white/[0.02]" : "border-sidebar-border/40 bg-transparent opacity-60"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                      {field.enabled && (
                        <button
                          type="button"
                          onClick={() =>
                            setFormConfig((c) => ({ ...c, [key]: { ...field, required: !field.required } }))
                          }
                          className={`mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                            field.required
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20"
                              : "bg-white/5 text-muted-foreground border-white/10 hover:text-foreground hover:border-white/20"
                          }`}
                        >
                          {field.required ? "Required" : "Optional"}
                        </button>
                      )}
                    </div>
                    {/* Enable/disable toggle */}
                    <button
                      type="button"
                      onClick={() =>
                        setFormConfig((c) => ({
                          ...c,
                          [key]: { ...field, enabled: !field.enabled, required: !field.enabled ? false : field.required },
                        }))
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none mt-0.5 ${
                        field.enabled ? "bg-amber" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                          field.enabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}

            <p className="text-xs text-muted-foreground">
              Disabled fields won&apos;t appear on the form. Required fields must be filled before submission.
            </p>

            </fieldset>
            {canFullTier ? (
              <Button type="submit" disabled={savingFormConfig} className="gap-2">
                {savingFormConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Form Fields
              </Button>
            ) : readOnlyNote}
          </form>
        </CardContent>
      </Card>

      <Separator />

      {/* Waitlist */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Waitlist</CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => hostelId && fetchWaitlist(hostelId)}
              disabled={loadingWaitlist}
              className="gap-1.5 h-8 text-xs"
            >
              <RefreshCw className={`w-3 h-3 ${loadingWaitlist ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          <CardDescription>
            People waiting for a bed at this hostel — {waitlist.length} {waitlist.length === 1 ? "person" : "people"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {waitlist.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <Clock className="w-8 h-8 opacity-20" />
              <p className="text-sm">No one on the waitlist yet</p>
            </div>
          ) : (
            <div className="rounded-xl border border-sidebar-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sidebar-border bg-white/[0.02]">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Name</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Phone / WhatsApp</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sidebar-border">
                  {waitlist.map((entry) => (
                    <tr key={entry.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground text-sm">{entry.name}</td>
                      <td className="px-4 py-3">
                        <a
                          href={`https://wa.me/${entry.phone.replace(/\D/g, "").replace(/^0/, "92")}?text=${encodeURIComponent(`Hi ${entry.name}! A bed has opened up at our hostel. Are you still interested?`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-[#25D366] hover:underline"
                        >
                          <Phone className="w-3 h-3" />
                          {entry.phone}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Package Pricing */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Utensils className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Package Pricing</CardTitle>
          </div>
          <CardDescription>
            Set the monthly rent for each package. Selecting a package when adding a tenant will auto-fill the rent. Food charges are added on top automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePackageConfig} className="space-y-6">
            <fieldset disabled={!canFullTier} className="space-y-6 min-w-0">

            {/* Per-package price table */}
            <div className="rounded-lg border border-border overflow-hidden">
              {/* Header row */}
              {/* Header row — two column groups: Monthly Rent | Security Deposit */}
              <div className="grid grid-cols-[1fr_90px_90px_90px_90px_32px] gap-px bg-border">
                <div className="bg-card px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Package</span>
                </div>
                <div className="bg-card px-2 py-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rent (Std)</span>
                </div>
                <div className="bg-card px-2 py-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rent (AC)</span>
                </div>
                <div className="bg-card px-2 py-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dep (Std)</span>
                </div>
                <div className="bg-card px-2 py-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dep (AC)</span>
                </div>
                <div className="bg-card" />
              </div>
              {/* Predefined package rows */}
              {PACKAGE_TIER_CONFIGS.map((cfg) => (
                <div key={cfg.tier} className="grid grid-cols-[1fr_90px_90px_90px_90px_32px] gap-px bg-border">
                  <div className="bg-card px-3 py-2.5">
                    <p className="text-sm font-medium leading-tight">{cfg.label}</p>
                    <p className="text-xs text-muted-foreground">{cfg.desc}</p>
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="0"
                      value={packageForm.prices[cfg.tier].no_ac}
                      onChange={(e) => setPackageForm({
                        ...packageForm,
                        prices: { ...packageForm.prices, [cfg.tier]: { ...packageForm.prices[cfg.tier], no_ac: e.target.value } },
                      })}
                      disabled={!packageLoaded}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    {cfg.hasAcVariant ? (
                      <Input
                        type="number" min="0" step="1" placeholder="0"
                        value={packageForm.prices[cfg.tier].ac}
                        onChange={(e) => setPackageForm({
                          ...packageForm,
                          prices: { ...packageForm.prices, [cfg.tier]: { ...packageForm.prices[cfg.tier], ac: e.target.value } },
                        })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground w-full text-center">metered</span>
                    )}
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="—"
                      value={packageForm.prices[cfg.tier].deposit_no_ac}
                      onChange={(e) => setPackageForm({
                        ...packageForm,
                        prices: { ...packageForm.prices, [cfg.tier]: { ...packageForm.prices[cfg.tier], deposit_no_ac: e.target.value } },
                      })}
                      disabled={!packageLoaded}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    {cfg.hasAcVariant ? (
                      <Input
                        type="number" min="0" step="1" placeholder="—"
                        value={packageForm.prices[cfg.tier].deposit_ac}
                        onChange={(e) => setPackageForm({
                          ...packageForm,
                          prices: { ...packageForm.prices, [cfg.tier]: { ...packageForm.prices[cfg.tier], deposit_ac: e.target.value } },
                        })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground w-full text-center">—</span>
                    )}
                  </div>
                  <div className="bg-card" />
                </div>
              ))}
              {/* Custom package rows */}
              {customRows.map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_90px_90px_90px_90px_32px] gap-px bg-border">
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      placeholder="Package name"
                      value={row.name}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, name: e.target.value } : r))}
                      className="h-7 text-xs px-2"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="0"
                      value={row.no_ac}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, no_ac: e.target.value } : r))}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="0"
                      value={row.ac}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, ac: e.target.value } : r))}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="—"
                      value={row.deposit_no_ac}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, deposit_no_ac: e.target.value } : r))}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="—"
                      value={row.deposit_ac}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, deposit_ac: e.target.value } : r))}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => setCustomRows((prev) => prev.filter((r) => r.id !== row.id))}
                      className="text-muted-foreground hover:text-rose-400 transition-colors p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {/* Add Package button */}
              <div className="bg-card border-t border-border">
                <button
                  type="button"
                  onClick={() => setCustomRows((prev) => [...prev, { id: crypto.randomUUID(), name: "", no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" }])}
                  disabled={!packageLoaded}
                  className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.02] transition-colors disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Package
                </button>
              </div>
            </div>

            {/* AC rate + Security Deposit */}
            <div className="flex flex-wrap gap-6">
              <div className="space-y-1.5">
                <Label className="text-xs">AC Per Unit Rate (Rs. / unit consumed)</Label>
                <Input
                  type="number" min="0" step="0.01" placeholder="e.g. 80"
                  value={packageForm.ac_per_unit_rate}
                  onChange={(e) => setPackageForm({ ...packageForm, ac_per_unit_rate: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                />
                <p className="text-xs text-muted-foreground">Billed on top of the monthly rate for AC rooms.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Default Security Deposit (Rs.)</Label>
                <Input
                  type="number" min="0" step="1" placeholder="e.g. 10000"
                  value={packageForm.security_deposit}
                  onChange={(e) => setPackageForm({ ...packageForm, security_deposit: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                />
                <p className="text-xs text-muted-foreground">Fallback when no per-package deposit is set above. Shown on the public hostel page.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Required Notice Period (days)</Label>
                <Input
                  type="number" min="0" step="1" placeholder="e.g. 30"
                  value={packageForm.notice_period_days}
                  onChange={(e) => setPackageForm({ ...packageForm, notice_period_days: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                />
                <p className="text-xs text-muted-foreground">Minimum notice a tenant should give before checking out.</p>
              </div>
            </div>

            {/* Food Add-on Pricing — independent of package tiers */}
            <div className="space-y-3 pt-2 border-t border-sidebar-border">
              <div>
                <Label className="text-xs font-semibold">Food Add-on Pricing <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Let tenants add specific meals on top of any room package, priced independently — separate from the bundled packages above. Leave blank if you don&apos;t offer this.
                </p>
              </div>
              <div className="flex flex-wrap gap-6">
                <div className="space-y-1.5">
                  <Label className="text-xs">Breakfast (Rs. / month)</Label>
                  <Input
                    type="number" min="0" step="1" placeholder="e.g. 5000"
                    value={foodAddonForm.breakfast}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, breakfast: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Lunch (Rs. / month)</Label>
                  <Input
                    type="number" min="0" step="1" placeholder="e.g. 5000"
                    value={foodAddonForm.lunch}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, lunch: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Dinner (Rs. / month)</Label>
                  <Input
                    type="number" min="0" step="1" placeholder="e.g. 5000"
                    value={foodAddonForm.dinner}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, dinner: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">All 3 Meals Bundle (Rs. / month)</Label>
                  <Input
                    type="number" min="0" step="1" placeholder="e.g. 15000"
                    value={foodAddonForm.allMeals}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, allMeals: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  />
                  <p className="text-xs text-muted-foreground">Used automatically when cheaper than the sum of all 3.</p>
                </div>
              </div>
            </div>

            {/* Seater Pricing — automatic per-room pricing by capacity */}
            <div className="space-y-3 pt-2 border-t border-sidebar-border">
              <div>
                <Label className="text-xs font-semibold">Seater Pricing <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Set a rent and deposit by seat count and every room on your public page prices itself automatically, based on its own capacity — no need to price each room by hand. Leave blank to keep using the pricing above.
                </p>
              </div>
              <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
                <div className="grid grid-cols-[1fr_90px_90px_90px_90px] gap-px bg-border min-w-[560px]">
                  <div className="bg-card px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Seater</span>
                  </div>
                  <div className="bg-card px-2 py-2 text-center">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rent (Non-AC)</span>
                  </div>
                  <div className="bg-card px-2 py-2 text-center">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rent (AC)</span>
                  </div>
                  <div className="bg-card px-2 py-2 text-center">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dep (Non-AC)</span>
                  </div>
                  <div className="bg-card px-2 py-2 text-center">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dep (AC)</span>
                  </div>
                </div>
                {SEATER_CAPACITIES.map((c) => (
                  <div key={c} className="grid grid-cols-[1fr_90px_90px_90px_90px] gap-px bg-border min-w-[560px]">
                    <div className="bg-card px-3 py-2.5 flex items-center">
                      <p className="text-sm font-medium">{SEATER_LABELS[c]}</p>
                    </div>
                    <div className="bg-card px-2 py-2 flex items-center">
                      <Input
                        type="number" min="0" step="1" placeholder="0"
                        value={seaterForm[c]?.no_ac ?? ""}
                        onChange={(e) => setSeaterForm({ ...seaterForm, [c]: { ...seaterForm[c], no_ac: e.target.value } })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    </div>
                    <div className="bg-card px-2 py-2 flex items-center">
                      <Input
                        type="number" min="0" step="1" placeholder="0"
                        value={seaterForm[c]?.ac ?? ""}
                        onChange={(e) => setSeaterForm({ ...seaterForm, [c]: { ...seaterForm[c], ac: e.target.value } })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    </div>
                    <div className="bg-card px-2 py-2 flex items-center">
                      <Input
                        type="number" min="0" step="1" placeholder="—"
                        value={seaterForm[c]?.deposit_no_ac ?? ""}
                        onChange={(e) => setSeaterForm({ ...seaterForm, [c]: { ...seaterForm[c], deposit_no_ac: e.target.value } })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    </div>
                    <div className="bg-card px-2 py-2 flex items-center">
                      <Input
                        type="number" min="0" step="1" placeholder="—"
                        value={seaterForm[c]?.deposit_ac ?? ""}
                        onChange={(e) => setSeaterForm({ ...seaterForm, [c]: { ...seaterForm[c], deposit_ac: e.target.value } })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Leave a deposit blank to fall back to the Default Security Deposit below.</p>
            </div>

            </fieldset>
            {canFullTier ? (
              <Button type="submit" disabled={savingPackage || !packageLoaded} className="gap-2">
                {savingPackage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Package Pricing
              </Button>
            ) : readOnlyNote}
          </form>
        </CardContent>
      </Card>

      {/* Branches + Partners — account-level, owner-only. A partner manages
          their branch, not the account's branch list or partner roster. */}
      {!isPartner && (<>
      <Separator />

      {/* Branches */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Branches</CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchBranches}
              disabled={loadingBranches || isPending}
              className="gap-1.5 h-8 text-xs"
            >
              <RefreshCw className={`w-3 h-3 ${loadingBranches ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          <CardDescription>
            Manage all your hostel branches — {branches.length} {branches.length === 1 ? "branch" : "branches"} registered
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Branch list */}
          {loadingBranches ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading branches…</span>
            </div>
          ) : branches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <GitBranch className="w-8 h-8 opacity-20" />
              <p className="text-sm">No branches yet</p>
            </div>
          ) : (
            <div className="rounded-xl border border-sidebar-border overflow-hidden">
              {branches.map((b, idx) => {
                const isActive = b.id === hostelId;
                const isSwitching = switchingBranch === b.id;
                const isEditing = editingBranchId === b.id;
                return (
                  <div
                    key={b.id}
                    className={`transition-colors ${idx > 0 ? "border-t border-sidebar-border" : ""} ${isActive ? "bg-amber/[0.04]" : "hover:bg-white/[0.02]"}`}
                  >
                    {isEditing ? (
                      <div className="px-4 py-3 space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Branch Name *</Label>
                          <Input
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleRenameBranch(b.id); if (e.key === "Escape") setEditingBranchId(null); }}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1.5">
                            <Label className="text-xs">City</Label>
                            <Input placeholder="Lahore" value={editCity} onChange={(e) => setEditCity(e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Address</Label>
                            <Input placeholder="Street, area" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingBranchId(null)}>Cancel</Button>
                          <Button
                            size="sm"
                            onClick={() => handleRenameBranch(b.id)}
                            disabled={savingRename || !editName.trim()}
                            className="gap-1.5 bg-amber text-background hover:bg-amber/90 font-semibold"
                          >
                            {savingRename ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${
                          isActive ? "bg-amber/15 border border-amber/25" : "bg-white/5 border border-white/10"
                        }`}>
                          <Building2 className={`w-4 h-4 ${isActive ? "text-amber" : "text-muted-foreground"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`text-sm font-medium truncate ${isActive ? "text-amber" : "text-foreground"}`}>
                              {b.name}
                            </p>
                            {b.is_primary && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber/15 text-amber border border-amber/25">
                                Primary
                              </span>
                            )}
                            {isActive && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                                <Check className="w-2.5 h-2.5" /> Active
                              </span>
                            )}
                          </div>
                          {(b.city || b.address) && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {[b.city, b.address].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEditBranch(b)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            title="Rename branch"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {!isActive && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSwitchBranch(b.id)}
                              disabled={isSwitching || isPending}
                              className="h-7 text-xs gap-1.5"
                            >
                              {isSwitching ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightLeft className="w-3 h-3" />}
                              Switch
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Partners */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Handshake className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Partners</CardTitle>
            </div>
            <div className="flex items-center gap-2">
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
          </div>
          <CardDescription>
            Grant partners branch-scoped access — from read-only up to full owner-equal rights — {partners.length} {partners.length === 1 ? "partner" : "partners"} active
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

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
                        <><Plus className="w-3.5 h-3.5" /> Add to Branch</>
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

                  {/* Custom features: daily expense/income breakdown (opt-in, per-partner, independent toggles) */}
                  <label
                    className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground cursor-pointer select-none"
                    title="Show a day-by-day expense breakdown on this partner's Dashboard (custom, opt-in feature)"
                  >
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded border-sidebar-border accent-amber"
                      checked={!!p.feature_flags?.daily_expenses}
                      disabled={updatingFlagsFor === p.partnership_id}
                      onChange={(e) => handleToggleFeatureFlag(p.partnership_id, "daily_expenses", "Daily expenses", e.target.checked)}
                    />
                    <span className="hidden lg:inline">Daily expenses</span>
                  </label>

                  <label
                    className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground cursor-pointer select-none"
                    title="Show a day-by-day income breakdown on this partner's Dashboard (custom, opt-in feature)"
                  >
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded border-sidebar-border accent-amber"
                      checked={!!p.feature_flags?.daily_income}
                      disabled={updatingFlagsFor === p.partnership_id}
                      onChange={(e) => handleToggleFeatureFlag(p.partnership_id, "daily_income", "Daily income", e.target.checked)}
                    />
                    <span className="hidden lg:inline">Daily income</span>
                  </label>

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
        </CardContent>
      </Card>
      </>)}

      <Separator />

      {/* Payment Recovery */}
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
        <CardContent className="space-y-6">
          <fieldset disabled={!canFullTier} className="space-y-6 min-w-0">

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
                    {/* Row 1: Bank label + Account title */}
                    <div className="grid grid-cols-2 gap-2 mb-2">
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
                    </div>
                    {/* Row 2: Account number + IBAN + Delete */}
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
              className="w-full rounded-xl border border-sidebar-border bg-card p-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 resize-y scrollbar-thin"
            />
            <p className="text-[11px] text-muted-foreground">
              Placeholders:&nbsp;
              {["{name}", "{amount}", "{month}", "{hostel}", "{accounts}"].map((p) => (
                <code key={p} className="text-foreground mx-0.5 px-1 py-0.5 rounded bg-white/5">{p}</code>
              ))}
            </p>
          </div>

          {/* Auto Reminders status — a curated feature Super Admin grants per branch;
              fully automatic once granted, nothing here for the owner to configure. */}
          {hostel?.whatsapp_enabled && (
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
          {canFullTier ? (
            <Button onClick={saveRecoverySettings} disabled={savingRecovery} className="gap-2">
              {savingRecovery ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Recovery Settings
            </Button>
          ) : readOnlyNote}
        </CardContent>
      </Card>

      <Separator />

      {/* Tenant Welcome & WiFi */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Tenant Welcome &amp; WiFi</CardTitle>
          </div>
          <CardDescription>
            Automatic WhatsApp message sent the moment a tenant becomes active — room, WiFi, and the monthly menu link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
                {wifiNetworks.map((w) => (
                  <div key={w.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end rounded-xl border border-sidebar-border bg-card/50 p-3">
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
                ))}
              </div>
            )}
          </div>

          {/* Meal Times */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Meal Times</Label>
            <p className="text-xs text-muted-foreground -mt-1">Shown in the welcome message via {"{meal_times}"} — leave a meal&apos;s From/To blank to leave it out (not every hostel serves lunch).</p>
            <div className="space-y-2">
              {([
                { key: "breakfast" as const, label: "Breakfast" },
                { key: "lunch" as const, label: "Lunch" },
                { key: "dinner" as const, label: "Dinner" },
              ]).map(({ key, label }) => (
                <div key={key} className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center">
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                  <Input
                    placeholder="From, e.g. 7:00 AM"
                    value={mealTimes[key]?.from ?? ""}
                    onChange={(e) => updateMealTime(key, "from", e.target.value)}
                    className="h-9 text-sm"
                  />
                  <Input
                    placeholder="To, e.g. 9:00 AM"
                    value={mealTimes[key]?.to ?? ""}
                    onChange={(e) => updateMealTime(key, "to", e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Welcome Message Template */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Welcome Message Template</Label>
            <textarea
              value={welcomeTemplate}
              onChange={(e) => setWelcomeTemplate(e.target.value)}
              rows={8}
              className="w-full rounded-xl border border-sidebar-border bg-card p-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 resize-y scrollbar-thin"
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
        </CardContent>
      </Card>

      <Separator />

      {/* Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" /><CardTitle className="text-base">Your Profile</CardTitle></div>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={(profile as unknown as { email?: string })?.email ?? ""} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">Email cannot be changed here</p>
            </div>
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input placeholder="Your name" value={profileForm.full_name} onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })} />
            </div>
            <Button type="submit" disabled={savingProfile} className="gap-2">
              {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Profile
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
