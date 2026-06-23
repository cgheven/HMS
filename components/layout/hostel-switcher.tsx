"use client";
import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Check, Plus, Loader2, Home, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getOwnedHostels, switchActiveHostel, createBranch } from "@/app/actions/branches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import type { Hostel } from "@/types";

type OwnedHostel = Hostel & { is_primary: boolean };

interface Props {
  /** The currently-active hostel (passed from server context) */
  activeHostel: Hostel | null;
}

export function HostelSwitcher({ activeHostel }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [hostels, setHostels] = useState<OwnedHostel[]>([]);
  const [loadingHostels, setLoadingHostels] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  // Branch creation form
  const [branchName, setBranchName] = useState("");
  const [branchCity, setBranchCity] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [creating, setCreating] = useState(false);

  // Fetch owned hostels on mount (once)
  useEffect(() => {
    let mounted = true;
    setLoadingHostels(true);
    getOwnedHostels().then(({ hostels: list, error }) => {
      if (!mounted) return;
      if (error) console.warn("[HostelSwitcher] fetch error:", error);
      setHostels(list);
      setLoadingHostels(false);
    });
    return () => { mounted = false; };
  }, []);

  const multiHostel = hostels.length > 1;

  async function handleSwitch(hostelId: string) {
    if (hostelId === activeHostel?.id) {
      setOpen(false);
      return;
    }
    setSwitching(hostelId);
    const result = await switchActiveHostel(hostelId);
    setSwitching(null);
    setOpen(false);
    if (result.error) {
      toast({ title: "Could not switch branch", description: result.error, variant: "destructive" });
      return;
    }
    startTransition(() => { router.refresh(); });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!branchName.trim()) return;
    setCreating(true);
    const result = await createBranch({
      name: branchName,
      city: branchCity,
      address: branchAddress,
    });
    setCreating(false);
    if (result.error) {
      toast({ title: "Failed to create branch", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Branch created", description: `"${branchName}" is ready.` });
    setBranchName("");
    setBranchCity("");
    setBranchAddress("");
    setAddOpen(false);
    setOpen(false);
    // Refresh hostels list
    const { hostels: updated } = await getOwnedHostels();
    setHostels(updated);
    // Switch to the new branch automatically
    if (result.hostel) {
      await handleSwitch(result.hostel.id);
    }
  }

  // Single-hostel: just show the name
  if (!multiHostel && !loadingHostels) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-amber/10 border border-amber/20 shrink-0">
          <Home className="w-3.5 h-3.5 text-amber" />
        </div>
        <span className="font-semibold text-sm truncate text-foreground">
          {activeHostel?.name ?? "My Hostel"}
        </span>
        {/* Allow adding a branch even from single-hostel view */}
        <button
          onClick={() => setAddOpen(true)}
          title="Add new branch"
          className="ml-1 p-1 rounded-md text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
        {addOpen && (
          <AddBranchModal
            onClose={() => setAddOpen(false)}
            onSubmit={handleCreate}
            creating={creating}
            name={branchName}
            setName={setBranchName}
            city={branchCity}
            setCity={setBranchCity}
            address={branchAddress}
            setAddress={setBranchAddress}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2 min-w-0">
      <div className="flex items-center justify-center w-6 h-6 rounded-md bg-amber/10 border border-amber/20 shrink-0">
        {multiHostel ? (
          <Building2 className="w-3.5 h-3.5 text-amber" />
        ) : (
          <Home className="w-3.5 h-3.5 text-amber" />
        )}
      </div>

      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 font-semibold text-sm text-foreground hover:text-amber transition-colors"
        disabled={loadingHostels || isPending}
      >
        <span className="truncate max-w-[140px]">
          {loadingHostels ? "Loading…" : (activeHostel?.name ?? "My Hostel")}
        </span>
        {loadingHostels || isPending ? (
          <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
        ) : (
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 shrink-0",
              open && "rotate-180"
            )}
          />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 w-64 z-20 rounded-xl border border-sidebar-border bg-sidebar shadow-2xl overflow-hidden animate-fade-up">
            <div className="px-3 py-2.5 border-b border-sidebar-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Switch Branch
              </p>
            </div>
            <div className="p-1 max-h-64 overflow-y-auto">
              {hostels.map((h) => {
                const isActive = h.id === activeHostel?.id;
                const isSwitching = switching === h.id;
                return (
                  <button
                    key={h.id}
                    onClick={() => handleSwitch(h.id)}
                    disabled={isSwitching}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors text-left",
                      isActive
                        ? "bg-amber/10 text-amber"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-medium">{h.name}</p>
                        {h.is_primary && (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber/15 text-amber border border-amber/25">
                            Primary
                          </span>
                        )}
                      </div>
                      {h.city && (
                        <p className="text-xs opacity-60 truncate">{h.city}</p>
                      )}
                    </div>
                    {isSwitching ? (
                      <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                    ) : isActive ? (
                      <Check className="w-3.5 h-3.5 shrink-0" />
                    ) : null}
                  </button>
                );
              })}
            </div>
            {/* Add Branch */}
            <div className="border-t border-sidebar-border p-1">
              <button
                onClick={() => { setAddOpen(true); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Branch
              </button>
            </div>
          </div>
        </>
      )}

      {/* Add Branch Modal */}
      {addOpen && (
        <AddBranchModal
          onClose={() => setAddOpen(false)}
          onSubmit={handleCreate}
          creating={creating}
          name={branchName}
          setName={setBranchName}
          city={branchCity}
          setCity={setBranchCity}
          address={branchAddress}
          setAddress={setBranchAddress}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Branch Modal
// ---------------------------------------------------------------------------

interface AddBranchModalProps {
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  creating: boolean;
  name: string;
  setName: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  address: string;
  setAddress: (v: string) => void;
}

function AddBranchModal({
  onClose, onSubmit, creating,
  name, setName, city, setCity, address, setAddress,
}: AddBranchModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-sidebar-border bg-sidebar shadow-2xl overflow-hidden animate-fade-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-amber" />
            <h2 className="text-sm font-semibold text-foreground">Add New Branch</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Branch Name *</Label>
            <Input
              placeholder="Main Branch"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>City</Label>
            <Input
              placeholder="Karachi"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input
              placeholder="Street address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={creating || !name.trim()}
              className="flex-1 bg-amber text-background hover:bg-amber/90 font-semibold gap-2"
            >
              {creating ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</>
              ) : (
                <><Plus className="w-3.5 h-3.5" /> Create Branch</>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
