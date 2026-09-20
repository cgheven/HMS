"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Building2, Save, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ACCOMMODATION_TYPES, ACCOMMODATION_TYPE_VALUES } from "@/lib/validation";

type HostelInfo = {
  name: string; address: string; city: string; area: string;
  phone: string; whatsapp: string; email: string; total_capacity: string; hostel_type: string;
};

export function HostelInfoForm({
  hostelId, country, readOnly = false, readOnlyNote, onSaved, bare = false,
}: {
  hostelId: string;
  country?: string | null;
  readOnly?: boolean;
  readOnlyNote?: ReactNode;
  onSaved?: () => void;
  /** Render just the form, without the outer Card/header (for the welcome wizard). */
  bare?: boolean;
}) {
  const isPk = (country ?? "PK").toUpperCase() === "PK";
  const [form, setForm] = useState<HostelInfo>({
    name: "", address: "", city: "", area: "", phone: "", whatsapp: "", email: "", total_capacity: "", hostel_type: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hostelId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("hms_hostels")
        .select("name, address, city, area, phone, whatsapp, email, total_capacity, hostel_type")
        .eq("id", hostelId)
        .maybeSingle();
      if (cancelled) return;
      const h = data as Record<string, unknown> | null;
      if (h) {
        setForm({
          name: (h.name as string) ?? "",
          address: (h.address as string) ?? "",
          city: (h.city as string) ?? "",
          area: (h.area as string) ?? "",
          phone: (h.phone as string) ?? "",
          whatsapp: (h.whatsapp as string) ?? "",
          email: (h.email as string) ?? "",
          total_capacity: h.total_capacity != null ? String(h.total_capacity) : "",
          hostel_type: (h.hostel_type as string) ?? "",
        });
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [hostelId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId) return;
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase.from("hms_hostels").update({
      name: form.name,
      address: form.address || null,
      city: form.city || null,
      area: form.area || null,
      phone: form.phone || null,
      whatsapp: form.whatsapp || null,
      email: form.email || null,
      total_capacity: parseInt(form.total_capacity) || 0,
      hostel_type: (ACCOMMODATION_TYPE_VALUES as readonly string[]).includes(form.hostel_type) ? form.hostel_type : null,
    }).eq("id", hostelId).select("id");
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    toast({ title: "Hostel information saved" });
    onSaved?.();
  }

  const formEl = (
          <form onSubmit={save} className="space-y-4">
            <fieldset disabled={readOnly || !loaded} className="space-y-4 min-w-0">
            <div className="space-y-1.5">
              <Label>Hostel Name *</Label>
              <Input placeholder="My Hostel" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input placeholder="Street address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input placeholder="Your city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Area / Neighbourhood</Label>
                <Input placeholder="Gulshan-e-Iqbal" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Who can live here?</Label>
              <Select value={form.hostel_type || undefined} onValueChange={(v) => setForm({ ...form, hostel_type: v })}>
                <SelectTrigger><SelectValue placeholder="Select accommodation type" /></SelectTrigger>
                <SelectContent>
                  {ACCOMMODATION_TYPES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={isPk ? "space-y-1.5" : "space-y-1.5 sm:col-span-2"}>
                <Label>Phone</Label>
                <Input placeholder="+92 300 0000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              {isPk && (
                <div className="space-y-1.5">
                  <Label>WhatsApp</Label>
                  <Input placeholder="+92 300 0000000" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" placeholder="hostel@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Total Capacity</Label>
                <Input type="number" placeholder="0" min="0" value={form.total_capacity} onChange={(e) => setForm({ ...form, total_capacity: e.target.value })} />
              </div>
            </div>
            </fieldset>
            {!readOnly ? (
              <Button type="submit" disabled={saving || !loaded} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Hostel
              </Button>
            ) : readOnlyNote}
          </form>
  );

  if (bare) return <div className="min-w-0">{formEl}</div>;
  return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-muted-foreground" /><CardTitle className="text-base">Hostel Information</CardTitle></div>
          <CardDescription>Update your hostel details</CardDescription>
        </CardHeader>
        <CardContent>{formEl}</CardContent>
      </Card>
  );
}
