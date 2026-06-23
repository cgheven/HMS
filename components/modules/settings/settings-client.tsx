"use client";
import { useEffect, useState } from "react";
import { Building2, User, Save, Loader2, Globe, ExternalLink, Clock, Phone, RefreshCw, Utensils } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useHostelContext } from "@/contexts/hostel-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import type { HostelType } from "@/types";

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
  const hostelId = hostel?.id ?? null;

  const [hostelForm, setHostelForm] = useState({
    name: "", address: "", city: "", area: "", phone: "", email: "", total_capacity: "",
  });
  const [listingForm, setListingForm] = useState({
    listing_enabled: false,
    maps_url: "",
    description: "",
    hostel_type: "" as HostelType | "",
    amenities: [] as string[],
  });
  const [profileForm, setProfileForm] = useState({ full_name: "" });
  const [savingHostel, setSavingHostel] = useState(false);
  const [savingListing, setSavingListing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [packageForm, setPackageForm] = useState({ food_monthly_rate: "", ac_per_unit_rate: "" });
  const [savingPackage, setSavingPackage] = useState(false);
  const [packageLoaded, setPackageLoaded] = useState(false);

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
      .select("food_monthly_rate, ac_per_unit_rate")
      .eq("hostel_id", id)
      .maybeSingle();
    if (data) {
      setPackageForm({
        food_monthly_rate: data.food_monthly_rate?.toString() ?? "0",
        ac_per_unit_rate: data.ac_per_unit_rate?.toString() ?? "0",
      });
    }
    setPackageLoaded(true);
  }

  useEffect(() => {
    if (hostel) {
      setHostelForm({
        name: hostel.name ?? "",
        address: hostel.address ?? "",
        city: hostel.city ?? "",
        area: hostel.area ?? "",
        phone: hostel.phone ?? "",
        email: hostel.email ?? "",
        total_capacity: hostel.total_capacity?.toString() ?? "",
      });
      setListingForm({
        listing_enabled: hostel.listing_enabled ?? false,
        maps_url: hostel.maps_url ?? "",
        description: hostel.description ?? "",
        hostel_type: hostel.hostel_type ?? "",
        amenities: hostel.amenities ?? [],
      });
      fetchWaitlist(hostel.id);
      fetchPackageConfig(hostel.id);
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
    const { error } = await supabase.from("hms_hostels").update({
      listing_enabled: listingForm.listing_enabled,
      maps_url: listingForm.maps_url || null,
      description: listingForm.description || null,
      hostel_type: listingForm.hostel_type || null,
      amenities: listingForm.amenities,
    }).eq("id", hostelId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({
      title: listingForm.listing_enabled ? "Listing published" : "Listing hidden",
      description: listingForm.listing_enabled
        ? "Your hostel is now visible on the public directory."
        : "Your hostel has been removed from the public directory.",
    });
    setSavingListing(false);
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
          food_monthly_rate: parseFloat(packageForm.food_monthly_rate) || 0,
          ac_per_unit_rate: parseFloat(packageForm.ac_per_unit_rate) || 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "hostel_id" }
      );
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Package pricing saved" });
    setSavingPackage(false);
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
                <Label>Email</Label>
                <Input type="email" placeholder="hostel@example.com" value={hostelForm.email} onChange={(e) => setHostelForm({ ...hostelForm, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Total Capacity</Label>
              <Input type="number" placeholder="0" min="0" value={hostelForm.total_capacity} onChange={(e) => setHostelForm({ ...hostelForm, total_capacity: e.target.value })} />
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
            Set monthly rates used when calculating tenant charges for Space + Food and Space + Food + AC packages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePackageConfig} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Food Monthly Rate (Rs.)</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={packageForm.food_monthly_rate}
                  onChange={(e) => setPackageForm({ ...packageForm, food_monthly_rate: e.target.value })}
                  disabled={!packageLoaded}
                />
                <p className="text-xs text-muted-foreground">Charged per tenant per month on food-inclusive packages</p>
              </div>
              <div className="space-y-1.5">
                <Label>AC Per-Unit Rate (Rs./unit)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={packageForm.ac_per_unit_rate}
                  onChange={(e) => setPackageForm({ ...packageForm, ac_per_unit_rate: e.target.value })}
                  disabled={!packageLoaded}
                />
                <p className="text-xs text-muted-foreground">Multiplied by kWh consumed when marking AC-tier payments</p>
              </div>
            </div>
            <Button type="submit" disabled={savingPackage || !packageLoaded} className="gap-2">
              {savingPackage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Package Pricing
            </Button>
          </form>
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
              <Input value={profile?.email ?? ""} disabled className="bg-muted" />
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
