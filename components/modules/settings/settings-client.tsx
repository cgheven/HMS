"use client";
import { useEffect, useState } from "react";
import { Building2, User, Save, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useHostelContext } from "@/contexts/hostel-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";

export function SettingsClient() {
  const { profile, hostel } = useHostelContext();
  const hostelId = hostel?.id ?? null;

  const [hostelForm, setHostelForm] = useState({ name: "", address: "", phone: "", email: "", total_capacity: "" });
  const [profileForm, setProfileForm] = useState({ full_name: "" });
  const [savingHostel, setSavingHostel] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (hostel) setHostelForm({ name: hostel.name ?? "", address: hostel.address ?? "", phone: hostel.phone ?? "", email: hostel.email ?? "", total_capacity: hostel.total_capacity?.toString() ?? "" });
  }, [hostel]);

  useEffect(() => {
    if (profile) setProfileForm({ full_name: profile.full_name ?? "" });
  }, [profile]);

  async function saveHostel(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId) return;
    setSavingHostel(true);
    const supabase = createClient();
    const { error } = await supabase.from("hms_hostels").update({ name: hostelForm.name, address: hostelForm.address || null, phone: hostelForm.phone || null, email: hostelForm.email || null, total_capacity: parseInt(hostelForm.total_capacity) || 0 }).eq("id", hostelId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Hostel settings saved" });
    setSavingHostel(false);
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your hostel and profile</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-muted-foreground" /><CardTitle className="text-base">Hostel Information</CardTitle></div>
          <CardDescription>Update your hostel details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveHostel} className="space-y-4">
            <div className="space-y-1.5"><Label>Hostel Name *</Label><Input placeholder="My Hostel" value={hostelForm.name} onChange={(e) => setHostelForm({ ...hostelForm, name: e.target.value })} required /></div>
            <div className="space-y-1.5"><Label>Address</Label><Input placeholder="Street, City" value={hostelForm.address} onChange={(e) => setHostelForm({ ...hostelForm, address: e.target.value })} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Phone</Label><Input placeholder="+92 300 0000000" value={hostelForm.phone} onChange={(e) => setHostelForm({ ...hostelForm, phone: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" placeholder="hostel@example.com" value={hostelForm.email} onChange={(e) => setHostelForm({ ...hostelForm, email: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Total Capacity</Label><Input type="number" placeholder="0" min="0" value={hostelForm.total_capacity} onChange={(e) => setHostelForm({ ...hostelForm, total_capacity: e.target.value })} /></div>
            <Button type="submit" disabled={savingHostel} className="gap-2">
              {savingHostel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Hostel
            </Button>
          </form>
        </CardContent>
      </Card>

      <Separator />

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
            <div className="space-y-1.5"><Label>Full Name</Label><Input placeholder="Your name" value={profileForm.full_name} onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })} /></div>
            <Button type="submit" disabled={savingProfile} className="gap-2">
              {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Profile
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
