"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Crown, LayoutDashboard, Building2, Inbox, Search, GraduationCap, MessageCircle,
  Menu, X, LogOut, Users2, ShieldCheck, ClipboardCheck, Megaphone,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const superAdminNav = [
  { href: "/super-admin",           label: "Dashboard",        icon: LayoutDashboard },
  { href: "/super-admin/hostels",   label: "All Hostels",      icon: Building2 },
  { href: "/super-admin/students",  label: "Students",         icon: GraduationCap },
  { href: "/super-admin/onboarding", label: "Onboarding",      icon: ClipboardCheck },
  { href: "/super-admin/leads",     label: "Client Leads",     icon: Inbox },
  { href: "/super-admin/marketing", label: "Marketing",        icon: Megaphone },
  { href: "/super-admin/sales-team", label: "Sales Team",      icon: Users2 },
  { href: "/super-admin/directory", label: "Public Directory", icon: Search },
  { href: "/super-admin/whatsapp",  label: "WhatsApp",         icon: MessageCircle },
  { href: "/super-admin/audit",     label: "Audit Trail",      icon: ShieldCheck },
];

function SuperAdminSidebar({
  open,
  onClose,
  email,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
}) {
  const pathname = usePathname();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
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
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber/10 border border-amber/20 flex items-center justify-center overflow-hidden">
              <Image src="/logo-mark.jpg" alt="Pulse" width={32} height={32} className="w-full h-full object-cover" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-none">Pulse</p>
              <p className="text-amber/70 text-[10px] mt-0.5 font-semibold tracking-[0.15em] uppercase">Pulse of Your Business</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2.5 overflow-y-auto space-y-0.5">
          <p className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest px-3 mb-2 mt-1">
            Platform
          </p>
          {superAdminNav.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/super-admin"
                ? pathname === href
                : pathname === href || pathname.startsWith(href + "/");
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
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-sidebar-border space-y-0.5">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign Out
          </button>
          <div className="px-3 pt-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <p className="text-xs text-muted-foreground">Super admin session</p>
            </div>
            <p className="text-xs text-muted-foreground/60 truncate">{email}</p>
          </div>
        </div>
      </aside>
    </>
  );
}

export function SuperAdminShell({
  children,
  email,
}: {
  children: React.ReactNode;
  email: string;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <SuperAdminSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        email={email}
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
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber" />
            <span className="font-semibold text-sm text-foreground">Super Admin</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
