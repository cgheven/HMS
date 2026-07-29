"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  UserPlus, CreditCard, Receipt, Menu, X, LogOut, Home, ShieldCheck, ChefHat,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { HostelSwitcher } from "@/components/layout/hostel-switcher"
import type { Manager, StaffPermission, Hostel } from "@/types"

interface PortalShellProps {
  manager: Manager
  permissions: StaffPermission[]
  hostels: { id: string; name: string }[]
  activeHostel: { id: string; name: string } | null
  children: React.ReactNode
}

const navItems = [
  { href: "/portal/tenants",  label: "Add Member", icon: UserPlus,   permission: "add_members"          as StaffPermission },
  { href: "/portal/payments", label: "Payments",   icon: CreditCard, permission: "collect_payments"      as StaffPermission },
  { href: "/portal/expenses", label: "Expenses",   icon: Receipt,    permission: "add_expenses"          as StaffPermission },
  { href: "/portal/kitchen",  label: "Kitchen",    icon: ChefHat,    permission: "add_kitchen_expenses"  as StaffPermission },
]

function PortalSidebar({
  open,
  onClose,
  manager,
  permissions,
}: {
  open: boolean
  onClose: () => void
  manager: Manager
  permissions: StaffPermission[]
}) {
  const pathname = usePathname()
  const permSet = new Set(permissions)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = "/login"
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
          <Link href="/portal" className="flex items-center gap-2.5 group" onClick={onClose}>
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20 transition-all group-hover:bg-amber/15">
              <Home className="w-4 h-4 text-amber" />
            </div>
            <div className="min-w-0">
              <p className="text-foreground font-bold text-sm tracking-tight leading-none truncate">
                Pulse
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <ShieldCheck className="w-2.5 h-2.5 text-amber/70 shrink-0" />
                <p className="text-amber/70 text-[10px] font-semibold tracking-[0.1em] uppercase">
                  Manager Portal
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
            Actions
          </p>
          <div className="space-y-0.5">
            {navItems.filter((item) => permSet.has(item.permission)).map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + "/")
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
              )
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-sidebar-border">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign Out
          </button>
          <div className="px-3 pt-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <p className="text-xs text-muted-foreground">Manager session</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

export function PortalShell({ manager, permissions, hostels, activeHostel, children }: PortalShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Cast to the shape HostelSwitcher expects — it only reads id, name, city, is_primary
  const switcherHostels = hostels as unknown as Hostel[]
  const switcherActive  = activeHostel as unknown as Hostel | null

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <PortalSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        manager={manager}
        permissions={permissions}
      />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top navbar — mirrors the main dashboard navbar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 px-4 sm:px-6 h-14 bg-sidebar/90 backdrop-blur-md border-b border-sidebar-border shrink-0">
          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Branch switcher — same position as main dashboard */}
          <HostelSwitcher activeHostel={switcherActive} hostels={switcherHostels} />

          {/* Manager name + session indicator on the right */}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="text-xs text-muted-foreground hidden sm:block">Manager session</span>
            </div>
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber/15 border border-amber/25 text-amber text-xs font-semibold">
              {manager.name.slice(0, 2).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
