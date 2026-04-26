"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, LogOut, User, Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { Profile, Hostel } from "@/types";

interface NavbarProps {
  onMenuClick: () => void;
  profile: Profile | null;
  hostel: Hostel | null;
}

export function Navbar({ onMenuClick, profile, hostel }: NavbarProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 px-4 sm:px-6 h-16 bg-background border-b border-border">
      {/* Hamburger */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-md hover:bg-accent transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Hostel name */}
      <div className="flex items-center gap-2 min-w-0">
        <Building2 className="w-4 h-4 text-muted-foreground shrink-0 hidden sm:block" />
        <span className="font-semibold text-sm truncate">{hostel?.name ?? "My Hostel"}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* User info */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted">
          <User className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground truncate max-w-[140px]">
            {profile?.full_name ?? profile?.email ?? "Owner"}
          </span>
        </div>

        {/* Sign out */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          disabled={signingOut}
          className="gap-2"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
