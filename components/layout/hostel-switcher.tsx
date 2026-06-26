"use client";
import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Check, Loader2, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { getOwnedHostels, switchActiveHostel } from "@/app/actions/branches";
import { toast } from "@/hooks/use-toast";
import type { Hostel } from "@/types";

type OwnedHostel = Hostel & { is_primary: boolean };

interface Props {
  activeHostel: Hostel | null;
}

export function HostelSwitcher({ activeHostel }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [hostels, setHostels] = useState<OwnedHostel[]>([]);
  const [loadingHostels, setLoadingHostels] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  // Optimistic name shown immediately on click, before server refresh completes
  const [optimisticName, setOptimisticName] = useState<string | null>(null);

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
    const target = hostels.find((h) => h.id === hostelId);
    // Show new name immediately — feels instant to the user
    setOptimisticName(target?.name ?? null);
    setOpen(false);
    setSwitching(hostelId);
    const result = await switchActiveHostel(hostelId);
    setSwitching(null);
    if (result.error) {
      setOptimisticName(null);
      toast({ title: "Could not switch branch", description: result.error, variant: "destructive" });
      return;
    }
    startTransition(() => { router.refresh(); });
  }

  // Clear optimistic name once the server refresh delivers the real activeHostel
  useEffect(() => {
    setOptimisticName(null);
  }, [activeHostel?.id]);

  // Single-hostel: just show the name, no switcher needed
  if (!multiHostel && !loadingHostels) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-amber/10 border border-amber/20 shrink-0">
          <Home className="w-3.5 h-3.5 text-amber" />
        </div>
        <span className="font-semibold text-sm truncate text-foreground">
          {optimisticName ?? activeHostel?.name ?? "My Hostel"}
        </span>
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
          {optimisticName ?? (loadingHostels ? "Loading…" : (activeHostel?.name ?? "My Hostel"))}
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
            <div className="p-1 max-h-64 overflow-y-auto scrollbar-thin">
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
          </div>
        </>
      )}
    </div>
  );
}
