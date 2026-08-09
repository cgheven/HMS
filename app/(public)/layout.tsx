import "./public-theme.css";

/**
 * Theme boundary for the public, tenant-facing listing site.
 *
 * A NESTED layout, not a root layout — app/layout.tsx remains the only file
 * that renders <html>/<body>, so fonts and <Toaster/> are still loaded once for
 * the whole app. The route group is URL-transparent: /find/{slug},
 * /join/{slug}, /s/{label} and friends all keep their exact paths, and
 * middleware.ts's rewrite to /s/{label} is untouched.
 *
 * Scoping the stylesheet here is now this file's ONLY job — it is what keeps
 * the sheet off every dashboard/admin/portal route. The wrapper div that used
 * to live here moved into <PublicShell>, which each page renders for itself,
 * because the branded subdomain page's appearance is chosen by its owner and a
 * layout that wraps every public route can neither vary that nor be opted out
 * of from below. Any new page added to this group must render <PublicShell>.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
