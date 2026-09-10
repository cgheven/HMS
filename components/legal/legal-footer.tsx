import Link from "next/link";

/**
 * Footer with the legal links Paddle requires on the checkout domain
 * (terms / privacy / refund). Rendered on the public entry points (login,
 * pricing) and on the legal pages themselves.
 */
export function LegalFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-10 border-t border-sidebar-border/60 pt-5 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 px-4 sm:flex-row">
        <p>© {year} PulseHub Private Limited. All rights reserved.</p>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Notice</Link>
          <Link href="/refund" className="hover:text-foreground transition-colors">Refund Policy</Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
