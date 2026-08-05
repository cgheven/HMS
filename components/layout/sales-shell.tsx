"use client"

import Image from "next/image"
import Link from "next/link"
import { LogOut } from "lucide-react"
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
        {/* Same lockup as the owner sidebar (components/layout/sidebar.tsx) —
            real logo mark, not an icon stand-in. overflow-hidden clips the
            asset's square corners to the rounded container. */}
        <Link href="/sales" className="flex items-center gap-2.5 group">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20 transition-all group-hover:bg-amber/15 overflow-hidden">
            <Image src="/logo-mark.jpg" alt="Pulse" width={32} height={32} className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="text-foreground font-bold text-sm tracking-tight leading-none">Pulse</p>
            <p className="text-amber/70 text-[10px] mt-0.5 font-semibold tracking-[0.15em] uppercase">Pulse of Your Business</p>
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
