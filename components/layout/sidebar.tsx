"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2, LayoutDashboard, BedDouble, Receipt,
  ChefHat, UtensilsCrossed, FileText, Settings, X, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/spaces", label: "Spaces", icon: BedDouble },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/kitchen", label: "Kitchen", icon: ChefHat },
  { href: "/food", label: "Food List", icon: UtensilsCrossed },
  { href: "/bills", label: "Bills", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

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
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
          active
            ? "bg-white/15 text-white"
            : "text-white/60 hover:bg-white/[0.08] hover:text-white"
        )}
      >
        <Icon className={cn("w-4 h-4 shrink-0", active ? "text-white" : "text-white/60")} />
        {label}
        {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />}
      </Link>
    );
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={onClose} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:z-auto",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-sidebar-border">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={onClose}>
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-none">HMS</p>
              <p className="text-white/50 text-xs mt-0.5">Management</p>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1 scrollbar-hide">
          {navItems.map((item) => <NavLink key={item.href} {...item} />)}

          {/* Admin section — only visible to admins */}
          {isAdmin && (
            <>
              <div className="pt-3 pb-1 px-3">
                <Separator className="bg-sidebar-border" />
                <p className="text-white/30 text-xs font-medium mt-3 uppercase tracking-wider">Admin</p>
              </div>
              <NavLink href="/admin/users" label="User Management" icon={Shield} />
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-sidebar-border">
          {isAdmin && (
            <div className="flex items-center justify-center gap-1.5 mb-2">
              <Shield className="w-3 h-3 text-white/40" />
              <p className="text-white/40 text-xs">Admin Mode</p>
            </div>
          )}
          <p className="text-white/30 text-xs text-center">HMS v1.0</p>
        </div>
      </aside>
    </>
  );
}
