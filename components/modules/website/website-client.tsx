"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2, Check, ExternalLink, Globe, ImagePlus, Loader2, Moon, Save,
  ShieldCheck, Sun, Trash2, AtSign,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useHostelContext } from "@/contexts/hostel-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { HostelType } from "@/types";
import {
  claimMySubdomain, saveWebsiteBranding, saveWebsitePublicTheme, saveWebsiteSocials,
} from "@/app/actions/website";
import { SUBDOMAIN_ROOT, normalizeSubdomain, subdomainError, suggestSubdomain, subdomainUrl } from "@/lib/subdomain";
import { facebookError, instagramError, normalizeFacebook, normalizeInstagram } from "@/lib/social";

const HOSTEL_TYPES: { value: HostelType; label: string }[] = [
  { value: "boys",   label: "Boys Only" },
  { value: "girls",  label: "Girls Only" },
];

const ALL_AMENITIES = [
  "WiFi", "AC", "Generator / UPS", "Meals Included", "Laundry",
  "Parking", "CCTV", "Hot Water", "Study Room", "Attached Bath", "Security Guard", "Cupboard",
];

interface Props {
  hostelId: string | null;
  initialSubdomain: string | null;
  initialBusinessName: string;
  initialLogoUrl: string | null;
  initialInstagram: string;
  initialFacebook: string;
  initialTheme: "light" | "dark";
}

export function WebsiteClient({
  hostelId,
  initialSubdomain,
  initialBusinessName,
  initialLogoUrl,
  initialInstagram,
  initialFacebook,
  initialTheme,
}: Props) {
  const { profile, hostel, hostels, partnerTier } = useHostelContext();
  const router = useRouter();

  // Account-level cards (web address, social links, appearance) are owner-only,
  // exactly as the subdomain card was in Settings. Branch configuration is
  // full-tier only at the DB level; below that the Public Listing card renders
  // read-only rather than letting a save silently affect zero rows. Branding is
  // never gated — it writes the caller's own profile row.
  const isPartner = profile?.role === "partner";
  const canFullTier = !partnerTier || partnerTier === "full";
  const readOnlyNote = (
    <p className="text-xs text-muted-foreground/70">
      View only — your access level doesn&apos;t allow changing this. Ask the owner if it needs updating.
    </p>
  );

  // ── Branded subdomain (owner-level, one time only) ───────────────────────
  const [subdomain, setSubdomain] = useState<string | null>(initialSubdomain);
  const [subdomainInput, setSubdomainInput] = useState("");
  const [claimingSubdomain, setClaimingSubdomain] = useState(false);
  const [subdomainConfirm, setSubdomainConfirm] = useState(false);
  const subdomainCandidate = normalizeSubdomain(subdomainInput);
  const subdomainInvalid = subdomainInput.trim() === "" ? null : subdomainError(subdomainInput);

  // ── Branding ─────────────────────────────────────────────────────────────
  const [brandingForm, setBrandingForm] = useState({ business_name: initialBusinessName });
  const [savingBranding, setSavingBranding] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // ── Appearance ───────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [savingTheme, setSavingTheme] = useState<"light" | "dark" | null>(null);

  // ── Social links ─────────────────────────────────────────────────────────
  const [socialsForm, setSocialsForm] = useState({ instagram: initialInstagram, facebook: initialFacebook });
  const [savingSocials, setSavingSocials] = useState(false);
  // Normalize ONCE, here, and let the field, the error and the save all read the
  // same result. instagramError/facebookError take an already-normalized handle
  // precisely so there is no second pass: normalizeInstagram strips one leading
  // '@' per call, so a validator that normalized again would judge "@najam" and
  // pass, while the field still held "@@najam" and the save stored "najam".
  const instagramValue = normalizeInstagram(socialsForm.instagram);
  const facebookValue = normalizeFacebook(socialsForm.facebook);
  const instagramInvalid = instagramError(instagramValue);
  // Facebook's only length floor is 5, so every valid page name is "too short"
  // while it is being typed. Hold the message until the field has been left
  // once, rather than painting the border red and disabling Save on keystroke 1.
  const [facebookTouched, setFacebookTouched] = useState(false);
  const facebookInvalid = facebookTouched ? facebookError(facebookValue) : null;

  // Blur tidies a pasted URL into the bare handle, but ONLY when that handle is
  // already valid. A valid handle is a fixed point of its normalizer — it holds
  // no '@', no scheme and no trailing slash — so writing it back cannot change
  // what the next render validates. Writing back an INVALID one would: "@@najam"
  // normalizes to "@najam", and re-normalizing that on the following render
  // yields a clean "najam", clearing the error and re-enabling Save on a value
  // the owner never typed. So an invalid entry keeps its raw text and its
  // message until the owner fixes it.
  const settleHandle = (raw: string, normalized: string, problem: string | null) =>
    problem ? raw : normalized;

  // ── Public listing (branch-scoped) ───────────────────────────────────────
  const [listingForm, setListingForm] = useState({
    listing_enabled: true,
    maps_url: "",
    description: "",
    hostel_type: "" as HostelType | "",
    amenities: [] as string[],
    food_closed_on_sundays: false,
  });
  const [savingListing, setSavingListing] = useState(false);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Every effect below re-syncs on VALUES, never on the identity of the context
  // `hostel`/`profile` object. Four handlers on this page call router.refresh()
  // and three server actions call revalidatePath("/website"), so the dashboard
  // layout re-runs and HostelProvider's useMemo hands down freshly-deserialized
  // objects with new identities on every save. An effect keyed on the object
  // would therefore fire after ANY save on this page and overwrite whatever is
  // half-typed in an unrelated card — worst of all springing the "Listed
  // publicly" toggle back to its stored state, so an owner who unlisted and then
  // saved their branding would believe they had unlisted when they had not.
  //
  // Keying on the values keeps branch switching working — hostel.id changes, so
  // the listing effect refires with the new branch's data (rule 8) — while
  // making a cross-card refresh a no-op.
  const serverListing = {
    id: hostel?.id ?? null,
    listing_enabled: hostel?.listing_enabled ?? true,
    maps_url: hostel?.maps_url ?? "",
    description: hostel?.description ?? "",
    hostel_type: (hostel?.hostel_type ?? "") as HostelType | "",
    amenities: hostel?.amenities ?? [],
    food_closed_on_sundays: hostel?.food_closed_on_sundays ?? false,
    cover_image_url: hostel?.cover_image_url ?? null,
  };
  // The amenity LIST is a fresh array literal every render, so it can only be
  // compared as a string. The effect still copies the array itself.
  const serverAmenityKey = serverListing.amenities.join("|");

  // Branch-scoped state hydrates in an effect, never in a lazy initialiser: an
  // initialiser freezes on whichever branch was active at mount and would leave
  // this page showing the previous branch's listing after a switch. The
  // key={hostelId} on the page is belt to these braces.
  useEffect(() => {
    if (!serverListing.id) return;
    setListingForm({
      listing_enabled: serverListing.listing_enabled,
      maps_url: serverListing.maps_url,
      description: serverListing.description,
      hostel_type: serverListing.hostel_type,
      amenities: [...serverListing.amenities],
      food_closed_on_sundays: serverListing.food_closed_on_sundays,
    });
    setCoverImageUrl(serverListing.cover_image_url);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately the
    // values, not the object they were read off; see the comment above.
  }, [
    serverListing.id,
    serverListing.listing_enabled,
    serverListing.maps_url,
    serverListing.description,
    serverListing.hostel_type,
    serverAmenityKey,
    serverListing.food_closed_on_sundays,
    serverListing.cover_image_url,
  ]);

  const serverSubdomain = profile?.subdomain ?? null;
  const serverBusinessName = profile?.business_name ?? "";
  const serverLogoUrl = profile?.logo_url ?? null;
  const serverInstagram = profile?.instagram_handle ?? "";
  const serverFacebook = profile?.facebook_handle ?? "";
  const serverTheme: "light" | "dark" = profile?.public_theme === "dark" ? "dark" : "light";

  useEffect(() => { setSubdomain(serverSubdomain); }, [serverSubdomain]);
  useEffect(() => { setBrandingForm({ business_name: serverBusinessName }); }, [serverBusinessName]);
  useEffect(() => { setLogoUrl(serverLogoUrl); }, [serverLogoUrl]);
  useEffect(() => { setTheme(serverTheme); }, [serverTheme]);
  useEffect(() => {
    setSocialsForm({ instagram: serverInstagram, facebook: serverFacebook });
  }, [serverInstagram, serverFacebook]);

  async function handleClaimSubdomain() {
    if (subdomainInvalid || !subdomainCandidate) return;
    setClaimingSubdomain(true);
    const res = await claimMySubdomain(subdomainCandidate);
    setClaimingSubdomain(false);
    setSubdomainConfirm(false);
    if (res.error) {
      toast({ title: "Could not set subdomain", description: res.error, variant: "destructive" });
      return;
    }
    setSubdomain(res.subdomain ?? null);
    setSubdomainInput("");
    router.refresh();
    toast({ title: "Subdomain is live", description: subdomainUrl(res.subdomain!) });
  }

  async function saveBranding(e: React.FormEvent) {
    e.preventDefault();
    setSavingBranding(true);
    const res = await saveWebsiteBranding({ business_name: brandingForm.business_name });
    setSavingBranding(false);
    if (res.error) {
      toast({ title: "Error", description: res.error, variant: "destructive" });
      return;
    }
    router.refresh();
    toast({ title: "Branding saved", description: "Your public page now uses this name." });
  }

  // Saves on click rather than behind a Save button: it is a single two-state
  // visual choice with no companion field, so there is nothing to batch and
  // nothing to lose. Optimistic, and reverted on failure — a swatch that lags a
  // round trip reads as a dead control.
  async function chooseTheme(next: "light" | "dark") {
    if (next === theme || savingTheme) return;
    const previous = theme;
    setTheme(next);
    setSavingTheme(next);
    const res = await saveWebsitePublicTheme(next);
    setSavingTheme(null);
    if (res.error) {
      setTheme(previous);
      toast({ title: "Could not change appearance", description: res.error, variant: "destructive" });
      return;
    }
    router.refresh();
    toast({
      title: next === "dark" ? "Your page is now dark" : "Your page is now light",
      description: "Visitors see the new look on their next visit.",
    });
  }

  async function saveSocials(e: React.FormEvent) {
    e.preventDefault();
    // Facebook's error is suppressed until the field has been left once, so a
    // submit straight off the first keystroke has to reveal it rather than
    // letting a value the server will reject through.
    const facebookProblem = facebookError(facebookValue);
    if (facebookProblem) setFacebookTouched(true);
    if (instagramInvalid || facebookProblem) return;
    setSavingSocials(true);
    const instagram = instagramValue;
    const facebook = facebookValue;
    const res = await saveWebsiteSocials({ instagram, facebook });
    setSavingSocials(false);
    if (res.error) {
      toast({ title: "Could not save social links", description: res.error, variant: "destructive" });
      return;
    }
    setSocialsForm({ instagram, facebook });
    router.refresh();
    toast({
      title: "Social links saved",
      description: instagram || facebook
        ? "They now appear on your public page."
        : "Your public page no longer shows social links.",
    });
  }

  // ── Public Listing writes ────────────────────────────────────────────────
  //
  // These five deliberately stay on the browser client instead of becoming
  // server actions. The members_update_hostels RLS policy (migration 094) is
  // the ONLY tier check on the listing path, and the hostel-covers bucket
  // policies are the only check on the uploads. Rewriting them as service-role
  // server actions without an explicit tier + ownership check would be
  // privilege escalation dressed up as a CLAUDE.md cleanup. The `.select("id")`
  // + zero-rows "Not permitted" branch in each one IS the enforcement being
  // surfaced — do not remove it.
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
    // Every hostel already gets a slug from hms_set_hostel_slug on creation
    // (a short id-derived code, see migration 140) — this is just a safety
    // net for any legacy row that predates that trigger and still has none.
    if (listingForm.listing_enabled && !hostel?.slug) {
      updatePayload.slug = hostelId.replace(/-/g, "").slice(0, 8);
    }
    const { data, error } = await supabase.from("hms_hostels").update(updatePayload).eq("id", hostelId).select("id");
    setSavingListing(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    // Only here, and only after the form is persisted: Settings' Tenant Welcome
    // preview reads listing_enabled off the shared context hostel, so it would
    // otherwise stay stale until a hard reload. Deliberately NOT in the cover
    // handlers below, which do not save this form — refreshing there would hand
    // down a new hostel object and wipe an unsaved description.
    router.refresh();
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

  /**
   * Client logo for their public site.
   *
   * Stored in the EXISTING hostel-covers bucket at {hostelId}/logo.{ext}: its
   * policies already scope writes on the first path segment being a hostel the
   * caller owns, so a new bucket would mean duplicating three policies to gain
   * nothing. The resulting public URL is saved on the profile, because branding
   * is account-level while the storage path is simply somewhere they can write.
   */
  async function uploadLogo(file: File) {
    if (!profile || !hostelId) return;
    setUploadingLogo(true);
    const supabase = createClient();

    // Extension from the filename, not file.type — the same rule the cover
    // upload above follows, since file.type is browser-supplied and can be empty.
    const fname = file.name.toLowerCase();
    const ext = fname.endsWith(".png") ? "png" : fname.endsWith(".webp") ? "webp" : "jpg";
    const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

    const path = `${hostelId}/logo.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("hostel-covers")
      .upload(path, file, { upsert: true, contentType });
    if (upErr) {
      setUploadingLogo(false);
      toast({ title: "Upload failed", description: upErr.message, variant: "destructive" });
      return;
    }

    // Cache-busted: the path is fixed, so a replacement logo would otherwise
    // keep serving the old image from the CDN and the browser cache.
    const { data: { publicUrl } } = supabase.storage.from("hostel-covers").getPublicUrl(path);
    const busted = `${publicUrl}?v=${Date.now()}`;

    const { data, error } = await supabase
      .from("hms_profiles").update({ logo_url: busted }).eq("id", profile.id).select("id");
    setUploadingLogo(false);
    if (error || !data?.length) {
      toast({ title: "Error", description: error?.message ?? "Could not save the logo.", variant: "destructive" });
      return;
    }
    setLogoUrl(busted);
    toast({ title: "Logo updated", description: "It now appears on your public page." });
  }

  async function removeLogo() {
    if (!profile) return;
    setUploadingLogo(true);
    const supabase = createClient();
    const { error } = await supabase.from("hms_profiles").update({ logo_url: null }).eq("id", profile.id);
    setUploadingLogo(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setLogoUrl(null);
    toast({ title: "Logo removed" });
  }

  function toggleAmenity(a: string) {
    setListingForm((f) => ({
      ...f,
      amenities: f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a],
    }));
  }

  // Everything below the web address only actually reaches the public through
  // {label}.hostels.yourpulse.io, which does not exist until the address is
  // claimed. Say so rather than letting an owner configure into a void.
  const noAddressYetSocials = (
    <p className="text-xs text-muted-foreground">
      These appear on your own web address page. Set your web address above to switch it on.
    </p>
  );
  // Its own sentence: "These appear" has no antecedent under a light/dark choice.
  const noAddressYetAppearance = (
    <p className="text-xs text-muted-foreground">
      This applies to your own web address page. Set your web address above to switch it on.
    </p>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-serif font-normal tracking-tight">Website</h1>
        <p className="text-muted-foreground text-sm mt-1">Your public page, web address and branding</p>
      </div>

      {/* Branded Subdomain — owner-level, covers every branch, one time only.
          Hidden from partners: claimMySubdomain is requireOwnerOrAbove. */}
      {!isPartner && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Your Own Web Address</CardTitle>
              </div>
              <CardDescription>
                A branded address for your business — easier to share and remember than a link with a code in it.
                {hostels.length > 1
                  ? ` One address for all ${hostels.length} of your branches, not per branch — set it here or on any other branch, it's the same address.`
                  : " Covers your whole business, including any branches you add later."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {subdomain ? (
                <div className="flex items-center justify-between gap-3 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Your address</p>
                    <p className="text-sm font-mono font-medium text-foreground truncate mt-0.5">
                      {subdomain}.{SUBDOMAIN_ROOT}
                    </p>
                  </div>
                  <a
                    href={subdomainUrl(subdomain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-sidebar-border text-xs font-medium text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Visit
                  </a>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-amber/5 border border-amber/20 text-xs">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">
                      <strong className="text-amber">You can only set this once.</strong> It cannot be changed
                      or undone afterwards, because you will be printing it on signs and sending it to residents.
                      Choose the name of your business, and check the spelling carefully.
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Choose your address</Label>
                    <div className="flex items-stretch">
                      <Input
                        value={subdomainInput}
                        onChange={(e) => { setSubdomainInput(e.target.value); setSubdomainConfirm(false); }}
                        // Suggest from EVERY branch, not the one being viewed —
                        // this address covers the business, so "Syed Residencies
                        // Branch UMT" must not steer them to a campus name.
                        placeholder={
                          suggestSubdomain(hostels.length > 0 ? hostels.map((h) => h.name) : [hostel?.name ?? ""])
                          || "yourhostel"
                        }
                        autoComplete="off"
                        spellCheck={false}
                        className={`rounded-r-none font-mono ${subdomainInvalid ? "border-rose-500/50" : ""}`}
                      />
                      <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-sidebar-border bg-white/[0.03] text-xs text-muted-foreground whitespace-nowrap">
                        .{SUBDOMAIN_ROOT}
                      </span>
                    </div>
                    {subdomainInvalid ? (
                      <p className="text-xs text-rose-400">{subdomainInvalid}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Lowercase letters, numbers and hyphens · 3–63 characters
                      </p>
                    )}
                  </div>

                  {/* Show the finished address before they commit — reading it
                      whole is what catches a typo, not re-reading the input. */}
                  {subdomainCandidate && !subdomainInvalid && (
                    <div className="p-4 rounded-xl border border-sidebar-border bg-white/[0.02]">
                      <p className="text-xs text-muted-foreground">Your address will be</p>
                      <p className="text-base font-mono font-semibold text-amber break-all mt-1">
                        {subdomainCandidate}.{SUBDOMAIN_ROOT}
                      </p>
                    </div>
                  )}

                  {subdomainConfirm ? (
                    <div className="p-4 rounded-xl border border-amber/30 bg-amber/5 space-y-3">
                      <p className="text-sm text-foreground">
                        Set your address to{" "}
                        <strong className="font-mono">{subdomainCandidate}.{SUBDOMAIN_ROOT}</strong> permanently?
                      </p>
                      <p className="text-xs text-muted-foreground">This cannot be undone.</p>
                      <div className="flex gap-2">
                        <Button onClick={handleClaimSubdomain} disabled={claimingSubdomain} className="gap-2">
                          {claimingSubdomain ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          Yes, set it permanently
                        </Button>
                        <Button variant="outline" onClick={() => setSubdomainConfirm(false)} disabled={claimingSubdomain}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      onClick={() => setSubdomainConfirm(true)}
                      disabled={!subdomainCandidate || !!subdomainInvalid}
                      className="gap-2"
                    >
                      <Globe className="w-4 h-4" /> Set my address
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Separator />
        </>
      )}

      {/* Public page branding — deliberately ungated, exactly as it was in the
          Your Profile card: it writes the caller's own profile row. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ImagePlus className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Public page branding</CardTitle>
          </div>
          <CardDescription>Shown to anyone visiting your public page.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveBranding} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Business Name</Label>
              <Input
                placeholder="e.g. Najam Hostels"
                maxLength={80}
                value={brandingForm.business_name}
                onChange={(e) => setBrandingForm({ business_name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {brandingForm.business_name.trim()
                  ? "This is the heading on your public page."
                  : `Leave blank and your public page shows "${profile?.full_name || "your name"}" instead.`}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Logo</Label>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl border border-sidebar-border bg-white/[0.02] flex items-center justify-center overflow-hidden shrink-0">
                  {logoUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- Supabase storage host */
                    <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    <ImagePlus className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label
                    className={
                      "inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-sidebar-border text-xs cursor-pointer hover:bg-white/5 transition-colors" +
                      (uploadingLogo ? " opacity-50 pointer-events-none" : "")
                    }
                  >
                    {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                    {logoUrl ? "Replace" : "Upload logo"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void uploadLogo(f);
                      }}
                    />
                  </label>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={removeLogo}
                      disabled={uploadingLogo}
                      className="h-9 px-3 rounded-md border border-sidebar-border text-xs text-muted-foreground hover:text-rose-400 transition-colors disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Square works best. PNG with a transparent background looks cleanest.
              </p>
            </div>

            <Button type="submit" disabled={savingBranding} className="gap-2">
              {savingBranding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save branding
            </Button>
          </form>
        </CardContent>
      </Card>

      <Separator />

      {/* Appearance — account-level like the web address, so owner-only. */}
      {!isPartner && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Appearance</CardTitle>
              </div>
              <CardDescription>
                How your public page looks to visitors. This does not change Pulse itself — your dashboard
                stays dark either way.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div role="radiogroup" aria-label="Public page appearance" className="grid grid-cols-2 gap-3">
                {([
                  { value: "light", label: "Light", hint: "White page, dark text", Icon: Sun,
                    swatch: "bg-white border-[#a7adb8]", bar: "bg-[#000f27]", line: "bg-[#c4c6cf]" },
                  { value: "dark", label: "Dark", hint: "Deep navy, light text", Icon: Moon,
                    swatch: "bg-[#0D1117] border-[#1E2D40]", bar: "bg-[#F5A623]", line: "bg-[#1E2D40]" },
                ] as const).map((opt) => {
                  const selected = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => chooseTheme(opt.value)}
                      disabled={savingTheme !== null}
                      className={cn(
                        "text-left p-3 rounded-xl border transition-colors disabled:opacity-60",
                        selected
                          ? "border-amber/40 bg-amber/[0.06]"
                          : "border-sidebar-border bg-white/[0.02] hover:border-sidebar-border/80"
                      )}
                    >
                      {/* A miniature of the page itself. Two words cannot
                          describe a colour scheme to someone who has never seen
                          their own page on a phone at night. */}
                      <span className={cn("block h-14 rounded-lg border p-2 space-y-1.5", opt.swatch)}>
                        <span className={cn("block h-2 w-1/2 rounded-full", opt.bar)} />
                        <span className={cn("block h-1.5 w-full rounded-full", opt.line)} />
                        <span className={cn("block h-1.5 w-2/3 rounded-full", opt.line)} />
                      </span>
                      <span className="flex items-center gap-1.5 mt-2.5 text-sm font-medium text-foreground">
                        <opt.Icon className="w-3.5 h-3.5 text-muted-foreground" />
                        {opt.label}
                        {savingTheme === opt.value ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber" />
                        ) : selected ? (
                          <Check className="w-3.5 h-3.5 text-amber" />
                        ) : null}
                      </span>
                      <span className="block text-xs text-muted-foreground mt-0.5">{opt.hint}</span>
                    </button>
                  );
                })}
              </div>
              {subdomain ? (
                <p className="text-xs text-muted-foreground">
                  Applies to your main page at{" "}
                  <a
                    href={subdomainUrl(subdomain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-amber hover:underline"
                  >
                    {subdomain}.{SUBDOMAIN_ROOT}
                  </a>
                  {" "}— every page on it, including each branch and the application form.
                </p>
              ) : (
                noAddressYetAppearance
              )}
            </CardContent>
          </Card>

          <Separator />
        </>
      )}

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
                    <strong className="text-foreground">Hostel Information</strong> in{" "}
                    <Link href="/settings" className="text-amber hover:underline">Settings</Link> — no need to enter them again.
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

      {/* Social links — account-level like the web address, so owner-only. */}
      {!isPartner && (
        <>
          <Separator />

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <AtSign className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Social links</CardTitle>
              </div>
              <CardDescription>
                Add your Instagram and Facebook so visitors can follow you.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveSocials} className="space-y-4">
                {/* The prefix is a static span, not part of the value: we store
                    the handle and build the link ourselves, and the field should
                    say so rather than inviting a full URL. Pasting one still
                    works — normalizeInstagram/normalizeFacebook strip it.

                    onBlur settles the field on the normalized handle only when
                    that handle is valid (see settleHandle), so the field, the
                    warning and the stored bytes can never disagree. */}
                <div className="space-y-1.5">
                  <Label>Instagram</Label>
                  <div className="flex items-stretch">
                    <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-sidebar-border bg-white/[0.03] text-xs text-muted-foreground whitespace-nowrap">
                      instagram.com/
                    </span>
                    <Input
                      value={socialsForm.instagram}
                      onChange={(e) => setSocialsForm((f) => ({ ...f, instagram: e.target.value }))}
                      onBlur={() => setSocialsForm((f) => ({
                        ...f,
                        instagram: settleHandle(f.instagram, instagramValue, instagramInvalid),
                      }))}
                      placeholder="najamhostels"
                      autoComplete="off"
                      spellCheck={false}
                      className={`rounded-l-none font-mono ${instagramInvalid ? "border-rose-500/50" : ""}`}
                    />
                  </div>
                  {instagramInvalid ? (
                    <p className="text-xs text-rose-400">{instagramInvalid}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Your username, or paste the link to your profile.</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Facebook</Label>
                  <div className="flex items-stretch">
                    <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-sidebar-border bg-white/[0.03] text-xs text-muted-foreground whitespace-nowrap">
                      facebook.com/
                    </span>
                    <Input
                      value={socialsForm.facebook}
                      onChange={(e) => setSocialsForm((f) => ({ ...f, facebook: e.target.value }))}
                      // facebookError, not facebookInvalid: this is the blur that
                      // sets facebookTouched, so the suppressed value is still
                      // null in this render.
                      onBlur={() => {
                        setFacebookTouched(true);
                        setSocialsForm((f) => ({
                          ...f,
                          facebook: settleHandle(f.facebook, facebookValue, facebookError(facebookValue)),
                        }));
                      }}
                      placeholder="najamhostels"
                      autoComplete="off"
                      spellCheck={false}
                      className={`rounded-l-none font-mono ${facebookInvalid ? "border-rose-500/50" : ""}`}
                    />
                  </div>
                  {facebookInvalid ? (
                    <p className="text-xs text-rose-400">{facebookInvalid}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Your page name, or paste the link — a page with no name works too.
                    </p>
                  )}
                </div>

                {subdomain ? (
                  <p className="text-xs text-muted-foreground">
                    These appear on your page at{" "}
                    <a
                      href={subdomainUrl(subdomain)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-amber hover:underline"
                    >
                      {subdomain}.{SUBDOMAIN_ROOT}
                    </a>
                    , beside the contact buttons. Clear both fields and save to remove them.
                  </p>
                ) : (
                  noAddressYetSocials
                )}

                <Button
                  type="submit"
                  disabled={savingSocials || !!instagramInvalid || !!facebookInvalid}
                  className="gap-2"
                >
                  {savingSocials ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save social links
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
