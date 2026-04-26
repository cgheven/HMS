"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, BedDouble, Users, CreditCard, Receipt,
  ChefHat, UtensilsCrossed, FileText, Settings, X, Shield, Home,
  MessageSquareWarning, Megaphone, BarChart3, UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/hooks/use-is-admin";

const navGroups = [
  {
    label: "Residents",
    items: [
      { href: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard },
      { href: "/spaces",        label: "Spaces",         icon: BedDouble },
      { href: "/tenants",       label: "Tenants",        icon: Users },
      { href: "/payments",      label: "Payments",       icon: CreditCard },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/expenses",      label: "Expenses",       icon: Receipt },
      { href: "/kitchen",       label: "Kitchen",        icon: ChefHat },
      { href: "/food",          label: "Food List",      icon: UtensilsCrossed },
      { href: "/bills",         label: "Bills",          icon: FileText },
      { href: "/staff",         label: "Staff",          icon: UserCog },
      { href: "/complaints",    label: "Complaints",     icon: MessageSquareWarning },
      { href: "/announcements", label: "Announcements",  icon: Megaphone },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/reports",       label: "Reports",        icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/settings",      label: "Settings",       icon: Settings },
    ],
  },
];

interface SidebarProps { open: boolean; onClose: () => void; }

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { isAdmin } = useIsAdmin();

  function NavLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof LayoutDashboard }) {
    const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
    return (
      <Link
        href={href}
        onClick={onClose}
        className={cn(
          "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
          active
            ? "bg-amber/10 text-amber"
            : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-amber" />
        )}
        <Icon className={cn("w-4 h-4 shrink-0 transition-colors", active ? "text-amber" : "text-muted-foreground group-hover:text-foreground")} />
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:z-auto",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-sidebar-border">
          <Link href="/dashboard" className="flex items-center gap-3 group" onClick={onClose}>
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber/10 border border-amber/20 transition-all group-hover:bg-amber/15">
              <Home className="w-4.5 h-4.5 text-amber" />
            </div>
            <div>
              <p className="text-foreground font-bold text-sm tracking-tight leading-none">HMS</p>
              <p className="text-muted-foreground text-xs mt-0.5">Management</p>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-4 scrollbar-hide">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest px-3 mb-1.5">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} {...item} />
                ))}
              </div>
            </div>
          ))}

          {isAdmin && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest px-3 mb-1.5">Admin</p>
              <NavLink href="/admin/users" label="User Management" icon={Shield} />
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-xs text-muted-foreground">System online</p>
          </div>
        </div>
      </aside>
    </>
  );
}
