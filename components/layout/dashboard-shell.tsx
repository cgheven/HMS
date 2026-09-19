"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Navbar } from "@/components/layout/navbar";
import { useHostelContext } from "@/contexts/hostel-context";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { profile, hostel, hostels, setActiveHostel } = useHostelContext();

  // The scroll container is this inner <main>, not the window, so Next's
  // scroll-to-top on navigation never resets it — a page opened from a
  // scrolled-down list (e.g. the Quick Setup "Website" step) would otherwise
  // land mid-page. Reset it to the top on every route change.
  const mainRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Navbar
          onMenuClick={() => setSidebarOpen(true)}
          profile={profile}
          hostel={hostel}
          hostels={hostels}
          setActiveHostel={setActiveHostel}
        />
        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
