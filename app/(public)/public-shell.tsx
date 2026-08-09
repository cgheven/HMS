import type { ReactNode } from "react";

/**
 * The public site's theme boundary. Every page under app/(public)/ renders it.
 *
 * `.pulse-public` activates the light token block in public-theme.css;
 * `.pulse-public-dark` activates the short override block beside it. Dark is
 * still not a second palette — it inherits the app's own tokens from globals.css
 * and overrides only the handful whose meaning inverts on a dark surface (see
 * the header of public-theme.css). It carries a class of its own rather than
 * being "no class" so those overrides have something to hang on.
 *
 * It lives on the PAGE rather than on app/(public)/layout.tsx because the theme
 * is per-OWNER and only the branded-subdomain routes know which owner is being
 * served. A layout wrapping every public route could not vary it, and no CSS can
 * remove an ancestor's class from below. Routes with no owner — /find and
 * /join — pass nothing and stay light exactly as they are today.
 *
 * Must never gain a transform, filter, backdrop-filter, perspective, contain or
 * will-change class: any of those create a containing block and would reposition
 * the three position:fixed bars in components/find/hostel-detail-client.tsx
 * against this div instead of the viewport.
 */
export function PublicShell({
  theme = "light",
  children,
}: {
  theme?: "light" | "dark";
  children: ReactNode;
}) {
  const scope = theme === "dark" ? "pulse-public-dark" : "pulse-public";
  return <div className={`${scope} min-h-screen bg-background text-foreground`}>{children}</div>;
}
