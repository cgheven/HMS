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
import { listPartners, createPartner, removePartner } from "@/app/actions/partners";
import type { PartnerRow } from "@/app/actions/partners";
import type { HostelType, Hostel, FormConfig, FormFieldConfig, PaymentMethodAccount } from "@/types";
import { DEFAULT_FORM_CONFIG } from "@/types";
import { savePaymentRecoverySettings } from "@/app/actions/settings";
import { DEFAULT_REMINDER_TEMPLATE, formatAccounts, buildReminderMessage } from "@/lib/whatsapp-reminder";

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

export function SettingsClient() {
  const { profile, hostel } = useHostelContext();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const hostelId = hostel?.id ?? null;

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
  const [partnerForm, setPartnerForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [showPartnerPassword, setShowPartnerPassword] = useState(false);
  const [creatingPartner, setCreatingPartner] = useState(false);
  const [removingPartner, setRemovingPartner] = useState<string | null>(null);
  // lastCreatedPartner holds credentials for WhatsApp share — cleared on dialog close
  const [lastCreatedPartner, setLastCreatedPartner] = useState<{ name: string; email: string; password: string } | null>(null);

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

  const [packageForm, setPackageForm] = useState({ food_bd_rate: "", food_3meals_rate: "", ac_per_unit_rate: "" });
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
      .select("food_monthly_rate, food_bd_rate, food_3meals_rate, ac_per_unit_rate")
      .eq("hostel_id", id)
      .maybeSingle();
    if (data) {
      // If explicit rates are set use them; otherwise fall back to legacy per-meal * multiplier
      const bdRate     = data.food_bd_rate     > 0 ? data.food_bd_rate     : (data.food_monthly_rate ?? 0) * 2;
      const meals3Rate = data.food_3meals_rate  > 0 ? data.food_3meals_rate  : (data.food_monthly_rate ?? 0) * 3;
      setPackageForm({
        food_bd_rate:     bdRate.toString(),
        food_3meals_rate: meals3Rate.toString(),
        ac_per_unit_rate: data.ac_per_unit_rate?.toString() ?? "0",
      });
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
    const result = await listPartners(id);
    if (result.error) {
      toast({ title: "Failed to load partners", description: result.error, variant: "destructive" });
    } else {
      setPartners(result.partners ?? []);
    }
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
    setLastCreatedPartner({ name: partnerForm.name, email: partnerForm.email, password: partnerForm.password });
    setPartnerForm({ name: "", email: "", phone: "", password: "" });
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

  function buildWhatsAppLink(partner: { name: string; email: string }) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const msg = `Assalam o Alaikum ${partner.name},\n\nYour partner access for *${hostel?.name ?? "the hostel"}* has been set up.\n\nLogin URL: ${origin}/partner/login\nEmail: ${partner.email}\n\nPlease ask the hostel owner for your password.\n\nYou can view tenants and payments for your hostel.\n\nWelcome aboard!`;
    return `https://wa.me/?text=${encodeURIComponent(msg)}`;
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
    fetchBranches();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      fetchPartners(hostel.id);
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
    const { error } = await supabase.from("hms_hostels").update({
      name: hostelForm.name,
      address: hostelForm.address || null,
      city: hostelForm.city || null,
      area: hostelForm.area || null,
      phone: hostelForm.phone || null,
      whatsapp: hostelForm.whatsapp || null,
      email: hostelForm.email || null,
      total_capacity: parseInt(hostelForm.total_capacity) || 0,
    }).eq("id", hostelId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Hostel settings saved" });
    setSavingHostel(false);
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
    const { error } = await supabase.from("hms_hostels").update(updatePayload).eq("id", hostelId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({
      title: listingForm.listing_enabled ? "Listing published" : "Listing hidden",
      description: listingForm.listing_enabled
        ? "Your hostel is now visible on the public directory. Share Form Link is now active."
        : "Your hostel has been removed from the public directory.",
    });
    setSavingListing(false);
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
    const { error: updateErr } = await supabase
      .from("hms_hostels")
      .update({ cover_image_url: publicUrl })
      .eq("id", hostelId);
    if (updateErr) {
      toast({ title: "Error", description: updateErr.message, variant: "destructive" });
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
    await supabase.from("hms_hostels").update({ cover_image_url: null }).eq("id", hostelId);
    setCoverImageUrl(null);
    toast({ title: "Cover image removed" });
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSavingProfile(true);
    const supabase = createClient();
    const { error } = await supabase.from("hms_profiles").update({ full_name: profileForm.full_name }).eq("id", profile.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Profile updated" });
    setSavingProfile(false);
  }

  async function savePackageConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId) return;
    setSavingPackage(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("hms_package_configs")
      .upsert(
        {
          hostel_id: hostelId,
          food_bd_rate:     parseFloat(packageForm.food_bd_rate)     || 0,
          food_3meals_rate: parseFloat(packageForm.food_3meals_rate) || 0,
          // Keep food_monthly_rate in sync — the billing trigger reads this column
          food_monthly_rate: parseFloat(packageForm.food_bd_rate) || 0,
          ac_per_unit_rate: parseFloat(packageForm.ac_per_unit_rate) || 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "hostel_id" }
      );
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Package pricing saved" });
    setSavingPackage(false);
  }

  async function saveFormConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId) return;
    setSavingFormConfig(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("hms_hostels")
      .update({ form_config: formConfig })
      .eq("id", hostelId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Form fields saved" });
    setSavingFormConfig(false);
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
            <Button type="submit" disabled={savingHostel} className="gap-2">
              {savingHostel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Hostel
            </Button>
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
            List your hostel on the public directory so tenants can discover you for free.{" "}
            <a href="/find" target="_blank" className="inline-flex items-center gap-0.5 text-amber hover:underline">
              Preview directory <ExternalLink className="w-3 h-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveListing} className="space-y-5">
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

            <Button type="submit" disabled={savingListing} className="gap-2">
              {savingListing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Listing
            </Button>
          </form>
        </CardContent>
      </Card>

      <Separator />

      {/* Form Builder */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FormInput className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Registration Form Fields</CardTitle>
          </div>
          <CardDescription>
            Choose which fields appear on your public tenant registration form. Full Name and WhatsApp are always required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveFormConfig} className="space-y-4">
            {(
              [
                { key: "email",           label: "Email Address",        description: "Tenant's email for correspondence" },
                { key: "cnic",            label: "CNIC",                 description: "National ID number (42101-XXXXXXX-X)" },
                { key: "package_tier",    label: "Package Preference",   description: "Space Only / Meals / AC / Cooler" },
                { key: "room_preference", label: "Room Type Preference", description: "Student / Professional / General" },
                { key: "move_in_date",    label: "Preferred Move-in Date", description: "Requested check-in date" },
                { key: "notes",           label: "Message / Questions",  description: "Free text for special requests" },
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

            <Button type="submit" disabled={savingFormConfig} className="gap-2">
              {savingFormConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Form Fields
            </Button>
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
        <CardContent>
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
            Controls what tenants see on the public hostel page when selecting a package. Room base rent is set per-room in Spaces.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePackageConfig} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Breakfast + Dinner / month (Rs.)</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 8000"
                  value={packageForm.food_bd_rate}
                  onChange={(e) => setPackageForm({ ...packageForm, food_bd_rate: e.target.value })}
                  disabled={!packageLoaded}
                />
                <p className="text-xs text-muted-foreground">Added on top of room rent for this package</p>
              </div>
              <div className="space-y-1.5">
                <Label>Breakfast + Lunch + Dinner / month (Rs.)</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 12000"
                  value={packageForm.food_3meals_rate}
                  onChange={(e) => setPackageForm({ ...packageForm, food_3meals_rate: e.target.value })}
                  disabled={!packageLoaded}
                />
                <p className="text-xs text-muted-foreground">Added on top of room rent for this package</p>
              </div>
              <div className="space-y-1.5">
                <Label>AC Per-Unit Rate (Rs. / unit consumed)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 80"
                  value={packageForm.ac_per_unit_rate}
                  onChange={(e) => setPackageForm({ ...packageForm, ac_per_unit_rate: e.target.value })}
                  disabled={!packageLoaded}
                />
                <p className="text-xs text-muted-foreground">Billed separately based on units consumed each month</p>
              </div>
            </div>

            {/* Live preview */}
            {packageLoaded && (parseFloat(packageForm.food_bd_rate) > 0 || parseFloat(packageForm.food_3meals_rate) > 0) && (
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">What tenants will see (room rent + food add-on)</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Space Only</span>
                    <span className="font-medium">Room rent only</span>
                  </div>
                  {parseFloat(packageForm.food_bd_rate) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Space + Breakfast + Dinner</span>
                      <span className="font-medium">Room rent + Rs. {parseFloat(packageForm.food_bd_rate).toLocaleString()}</span>
                    </div>
                  )}
                  {parseFloat(packageForm.food_3meals_rate) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Space + Breakfast + Lunch + Dinner</span>
                      <span className="font-medium">Room rent + Rs. {parseFloat(packageForm.food_3meals_rate).toLocaleString()}</span>
                    </div>
                  )}
                  {parseFloat(packageForm.ac_per_unit_rate) > 0 && (
                    <div className="flex justify-between pt-1.5 border-t border-border mt-1.5">
                      <span className="text-muted-foreground">AC (billed separately)</span>
                      <span className="font-medium">Rs. {parseFloat(packageForm.ac_per_unit_rate)} / unit</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <Button type="submit" disabled={savingPackage || !packageLoaded} className="gap-2">
              {savingPackage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Package Pricing
            </Button>
          </form>
        </CardContent>
      </Card>

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
            Grant partners read-only access to view tenants and payments — {partners.length} {partners.length === 1 ? "partner" : "partners"} active
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
              <p className="text-sm font-medium text-foreground mb-3">New Partner</p>
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
                <p className="text-xs text-muted-foreground/70">
                  The partner will get read-only access to tenants and payments.
                  Share their credentials via WhatsApp after creation — the password will not be shown again.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowAddPartner(false); setPartnerForm({ name: "", email: "", phone: "", password: "" }); }}
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
              <p className="text-xs">Add a partner to give them read-only access</p>
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
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        Partner
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      <p className="text-xs text-muted-foreground truncate">{p.email}</p>
                      {p.phone && (
                        <p className="text-xs text-muted-foreground">{p.phone}</p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={buildWhatsAppLink({ name: p.full_name ?? "Partner", email: p.email })}
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

          <Button onClick={saveRecoverySettings} disabled={savingRecovery} className="gap-2">
            {savingRecovery ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Recovery Settings
          </Button>
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
