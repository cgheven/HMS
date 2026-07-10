"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Menu, LogOut, ChevronDown, Shield, Users, Home, Building2, ClipboardList, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { HostelSwitcher } from "@/components/layout/hostel-switcher";
import type { Profile, Hostel } from "@/types";

const ADMIN_LINKS = [
  { href: "/admin/users",     label: "User Management",  icon: Users },
  { href: "/admin/hostels",   label: "Hostels",          icon: Building2 },
  { href: "/admin/prospects", label: "Hostel Pipeline",  icon: Home },
  { href: "/admin/audit",     label: "Audit Log",        icon: ClipboardList },
  { href: "/admin/directory", label: "Public Directory", icon: Search },
];

interface NavbarProps {
  onMenuClick: () => void;
  profile: Profile | null;
  hostel: Hostel | null;
  hostels: Hostel[];
  setActiveHostel: (id: string) => void;
}

export function Navbar({ onMenuClick, profile, hostel, hostels }: NavbarProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [adminDrop, setAdminDrop] = useState(false);

  // Compute display name / initials from profile; fall back gracefully
  const displayName = profile?.full_name ?? (profile as unknown as { email?: string })?.email ?? "Owner";
  const displayEmail = (profile as unknown as { email?: string })?.email ?? "";
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Detect is_admin on the profile — support both legacy (is_admin bool) and new (role) shapes
  const isAdmin =
    (profile as unknown as { is_admin?: boolean })?.is_admin === true ||
    profile?.role === "super_admin";

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 px-4 sm:px-6 h-14 bg-sidebar/90 backdrop-blur-md border-b border-sidebar-border">
      {/* Mobile hamburger */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Hostel switcher */}
      <HostelSwitcher activeHostel={hostel} hostels={hostels} />

      {/* Admin quick-access */}
      {isAdmin && (
        <div className="relative ml-auto">
          <button
            onClick={() => setAdminDrop((p) => !p)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border",
              adminDrop
                ? "bg-amber/10 text-amber border-amber/30"
                : "text-muted-foreground border-sidebar-border hover:text-amber hover:bg-amber/5 hover:border-amber/20"
            )}
            title="Admin Panel"
          >
            <Shield className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Admin</span>
          </button>

          {adminDrop && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAdminDrop(false)} />
              <div className="absolute right-0 top-full mt-2 w-52 z-20 rounded-xl border border-sidebar-border bg-sidebar shadow-2xl overflow-hidden animate-fade-up">
                <div className="px-3 py-2.5 border-b border-sidebar-border">
                  <p className="text-xs font-semibold text-amber uppercase tracking-wide flex items-center gap-1.5">
                    <Shield className="w-3 h-3" /> Admin Panel
                  </p>
                </div>
                <div className="p-1">
                  {ADMIN_LINKS.map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setAdminDrop(false)}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Avatar + dropdown */}
      <div className={cn("flex items-center gap-2 relative", !isAdmin && "ml-auto")}>
        <button
          onClick={() => setDropOpen((p) => !p)}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors group"
        >
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber/15 border border-amber/25 text-amber text-xs font-semibold">
            {initials}
          </div>
          <span className="hidden sm:block text-sm text-muted-foreground group-hover:text-foreground transition-colors truncate max-w-[120px]">
            {displayName}
          </span>
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 text-muted-foreground transition-transform duration-200",
              dropOpen && "rotate-180"
            )}
          />
        </button>

        {dropOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setDropOpen(false)} />
            <div className="absolute right-0 top-full mt-2 w-52 z-20 rounded-xl border border-sidebar-border bg-sidebar shadow-2xl overflow-hidden animate-fade-up">
              <div className="px-4 py-3 border-b border-sidebar-border">
                <p className="text-xs font-medium text-foreground truncate">{displayName}</p>
                {displayEmail && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{displayEmail}</p>
                )}
              </div>
              <div className="p-1">
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
