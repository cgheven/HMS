"use client";
import { memo } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { REDFLAG_ENABLED } from "@/lib/redflag-flag";
import {
  LayoutDashboard, BedDouble, Users, CreditCard, Receipt,
  ChefHat, UtensilsCrossed, FileText, Settings, X, Shield, Home,
  MessageSquareWarning, Megaphone, BarChart3, UserCog, Building2, Globe,
  ClipboardList, ShieldCheck, Search, Wallet, Flag, MessageSquareHeart,
  LayoutTemplate, Layers, Share2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useHostelContext } from "@/contexts/hostel-context";

// A partner is an owner of their branch, so they see every branch-scoped page.
// ownerOnly marks the two exceptions, which are ACCOUNT-level rather than
// branch-level:
//   Managers — creating/deleting manager logins writes hms_profiles (auth users)
//   Billing  — the account holder's SaaS subscription with Pulse across every
//              branch, keyed to owner_id, so a partner would see an empty page
// Settings is shown, but its Branches and Partners cards are hidden inside the
// page for the same reason (see settings-client.tsx).
// multiBranchOnly hides an item that has nothing to say with a single branch.
// It is a UX decision, not a security control — /overview enforces owner-only
// access with requireOwnerOrAbove() on the page AND inside its server action.
// referralOnly is the same kind of flag for the per-branch referral entitlement
// (hms_hostels.referral_enabled, Super Admin only): /marketing renders its own
// explanatory empty state and every action re-checks the flag server-side, so
// hiding the item is about not advertising a feature the branch hasn't bought.
interface NavItem { href: string; label: string; icon: typeof LayoutDashboard; ownerOnly?: boolean; multiBranchOnly?: boolean; referralOnly?: boolean; newTab?: boolean }



// RedFlag is behind a rollout flag — the migration can be applied without
// the feature appearing for anyone. See lib/redflag-flag.ts.
// One page, one item: searching the registry IS the check, and "My Reports" is
// a filter on that same list rather than a screen of its own.
const REDFLAG_GROUP: { label: string; items: NavItem[] } = {
    label: "RedFlag",
    items: [
      { href: "/redflag", label: "RedFlag", icon: Flag },
    ],
  }

const navGroups: { label: string; items: NavItem[] }[] = [
  ...(REDFLAG_ENABLED ? [REDFLAG_GROUP] : []),
  {
    label: "Residents",
    items: [
      { href: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard },
      { href: "/spaces",        label: "Spaces",        icon: BedDouble },
      { href: "/tenants",       label: "Tenants",       icon: Users },
      { href: "/payments",      label: "Payments",      icon: CreditCard },
      // Sits with the residents it is about, not down in Operations. Referrals
      // are how the next tenant arrives, and buried under Kitchen and Bills the
      // owner never opened the page at all. Still ownerOnly + referralOnly: a
      // referral link goes out under the account's name to people who are not
      // customers yet, so the flags travel with it unchanged.
      { href: "/marketing",     label: "Marketing",     icon: Share2, ownerOnly: true, referralOnly: true },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/expenses",      label: "Expenses",      icon: Receipt },
      { href: "/kitchen",       label: "Kitchen",       icon: ChefHat },
      { href: "/food",          label: "Food List",     icon: UtensilsCrossed },
      { href: "/bills",         label: "Bills",         icon: FileText },
      { href: "/staff",         label: "Staff",         icon: UserCog },
      { href: "/managers",      label: "Managers",      icon: ShieldCheck, ownerOnly: true },
      { href: "/complaints",    label: "Complaints",    icon: MessageSquareWarning },
      // Sits with Complaints because both are "what residents told us".
      // MessageSquareHeart pairs with MessageSquareWarning; deliberately not a
      // star, which would imply a public rating — this feature is private.
      // Not ownerOnly: that flag is for account-level pages, and a partner owns
      // their branch. Managers never reach this sidebar at all (the dashboard
      // layout redirects them), which is what keeps staff from reading their own
      // performance ratings in question 3.
      { href: "/feedback",      label: "Feedback",      icon: MessageSquareHeart },
      { href: "/announcements", label: "Announcements", icon: Megaphone },
    ],
  },
  {
    label: "Analytics",
    items: [
      // The zoom-out sits above Reports, which is the zoom-in.
      { href: "/overview", label: "All Branches", icon: Layers, ownerOnly: true, multiBranchOnly: true },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/billing",  label: "Billing",          icon: Wallet, ownerOnly: true },
      { href: "/settings", label: "Settings",         icon: Settings },
      // Not ownerOnly: that flag is for account-level pages a partner has no
      // row in. Partners edit the Public Listing and the branding here, exactly
      // as they did when both lived in Settings.
      { href: "/website",  label: "Website",          icon: LayoutTemplate },
      { href: "/find",     label: "My Public Page",   icon: Globe, newTab: true },
    ],
  },
];

interface NavLinkProps { href: string; label: string; icon: typeof LayoutDashboard; pathname: string; onClose: () => void; newTab?: boolean }

const NavLink = memo(function NavLink({ href, label, icon: Icon, pathname, onClose, newTab }: NavLinkProps) {
  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  const className = cn(
    "relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 group",
    active ? "bg-amber/10 text-amber" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
  );
  const content = (
    <>
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-amber" />
      )}
      <Icon className={cn("w-4 h-4 shrink-0 transition-colors", active ? "text-amber" : "text-muted-foreground group-hover:text-foreground")} />
      <span>{label}</span>
    </>
  );

  if (newTab) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClose} className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} onClick={onClose} className={className}>
      {content}
    </Link>
  );
});

interface SidebarProps { open: boolean; onClose: () => void; }

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { isAdmin } = useIsAdmin();
  const { profile, hostels, hostel } = useHostelContext();
  // Link straight at the public page instead of at /find, which exists only to
  // resolve this slug server-side and redirect. That hop costs a full round trip
  // plus a getAuthContext query before anything paints — and the slug is already
  // in this context. Falls back to /find when the branch has no slug or is not
  // listed, so the not-published and no-slug cases keep their existing handling.
  const publicPageHref =
    hostel?.slug && hostel.listing_enabled ? `/find/${hostel.slug}` : "/find";
  const isPartner = profile?.role === "partner";
  const singleBranch = (hostels?.length ?? 0) < 2;
  const referralEnabled = hostel?.referral_enabled === true;

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !(isPartner && item.ownerOnly) &&
          !(singleBranch && item.multiBranchOnly) &&
          !(item.referralOnly && !referralEnabled)
      ).map((item) => (item.href === "/find" ? { ...item, href: publicPageHref } : item)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:z-auto",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-sidebar-border">
          <Link href="/dashboard" className="flex items-center gap-2.5 group" onClick={onClose}>
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20 transition-all group-hover:bg-amber/15 overflow-hidden">
              <Image src="/logo-mark.jpg" alt="Pulse" width={32} height={32} className="w-full h-full object-cover" />
            </div>
            <div>
              <p className="text-foreground font-bold text-sm tracking-tight leading-none">Pulse</p>
              <p className="text-amber/70 text-[10px] mt-0.5 font-semibold tracking-[0.15em] uppercase">Pulse of Your Business</p>
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
        <nav className="flex-1 overflow-y-auto overscroll-contain py-3 px-2.5 space-y-3">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest px-3 mb-1 mt-1">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} {...item} pathname={pathname} onClose={onClose} />
                ))}
              </div>
            </div>
          ))}

          {isAdmin && !isPartner && (
            <div>
              <div className="flex items-center gap-1.5 px-3 mb-1">
                <Shield className="w-3 h-3 text-amber/60" />
                <p className="text-[10px] font-semibold text-amber/60 uppercase tracking-widest">Admin</p>
              </div>
              <div className="space-y-0.5 rounded-lg border border-amber/10 bg-amber/[0.04] p-1">
                <NavLink href="/admin/users"     label="User Management" icon={Shield}       pathname={pathname} onClose={onClose} />
                <NavLink href="/admin/hostels"   label="Hostels"         icon={Building2}    pathname={pathname} onClose={onClose} />
                <NavLink href="/admin/prospects" label="Hostel Pipeline" icon={Home}         pathname={pathname} onClose={onClose} />
                <NavLink href="/admin/audit"     label="Audit Log"       icon={ClipboardList} pathname={pathname} onClose={onClose} />
                <NavLink href="/admin/directory" label="Public Directory" icon={Search}      pathname={pathname} onClose={onClose} />
              </div>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-xs text-muted-foreground">Pulse is online</p>
          </div>
        </div>
      </aside>
    </>
  );
}
