"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, CreditCard, Handshake,
  Menu, X, LogOut, Home,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const partnerNav = [
  { href: "/partner",           label: "Dashboard",  icon: LayoutDashboard, exact: true },
  { href: "/partner/tenants",   label: "Tenants",    icon: Users },
  { href: "/partner/payments",  label: "Payments",   icon: CreditCard },
];

function PartnerSidebar({
  open,
  onClose,
  hostelName,
}: {
  open: boolean;
  onClose: () => void;
  hostelName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/partner/login");
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:z-auto",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-sidebar-border">
          <Link href="/partner" className="flex items-center gap-2.5 group" onClick={onClose}>
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20 transition-all group-hover:bg-amber/15">
              <Home className="w-4 h-4 text-amber" />
            </div>
            <div className="min-w-0">
              <p className="text-foreground font-bold text-sm tracking-tight leading-none truncate">
                {hostelName || "Hostel"}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <Handshake className="w-2.5 h-2.5 text-amber/70 shrink-0" />
                <p className="text-amber/70 text-[10px] font-semibold tracking-[0.1em] uppercase">
                  Partner View
                </p>
              </div>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2.5 overflow-y-auto">
          <p className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest px-3 mb-1 mt-1">
            Overview
          </p>
          <div className="space-y-0.5">
            {partnerNav.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onClose}
                  className={cn(
                    "relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 group",
                    active
                      ? "bg-amber/10 text-amber"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-amber" />
                  )}
                  <Icon
                    className={cn(
                      "w-4 h-4 shrink-0 transition-colors",
                      active
                        ? "text-amber"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Read-only notice */}
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-lg bg-amber/[0.05] border border-amber/15">
          <p className="text-xs text-amber/80 font-medium">Read-only access</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            You can view but not modify data.
          </p>
        </div>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-sidebar-border">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign Out
          </button>
          <div className="px-3 pt-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <p className="text-xs text-muted-foreground">Partner session</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

export function PartnerShell({
  children,
  hostelName,
}: {
  children: React.ReactNode;
  hostelName: string;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <PartnerSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        hostelName={hostelName}
      />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-sidebar-border bg-sidebar/80 backdrop-blur-md shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Handshake className="w-4 h-4 text-amber shrink-0" />
            <span className="font-semibold text-sm text-foreground truncate">
              {hostelName || "Hostel"}
            </span>
          </div>
          <Badge variant="secondary" className="ml-auto text-xs shrink-0">
            Partner View
          </Badge>
        </div>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
