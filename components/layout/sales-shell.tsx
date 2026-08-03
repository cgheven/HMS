"use client"

import Link from "next/link"
import { Home, ShieldCheck, LogOut } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { SalesRep } from "@/types"

interface SalesShellProps {
  salesRep: SalesRep
  children: React.ReactNode
}

export function SalesShell({ salesRep, children }: SalesShellProps) {
  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = "/sales/login"
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 flex items-center gap-3 px-4 sm:px-6 h-14 bg-sidebar/90 backdrop-blur-md border-b border-sidebar-border shrink-0">
        <Link href="/sales" className="flex items-center gap-2.5 group">
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
                Sales Portal
              </p>
            </div>
          </div>
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-xs text-muted-foreground">{salesRep.name}</span>
          </div>
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber/15 border border-amber/25 text-amber text-xs font-semibold shrink-0">
            {salesRep.name.slice(0, 2).toUpperCase()}
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl">
          {children}
        </div>
      </main>
    </div>
  )
}
