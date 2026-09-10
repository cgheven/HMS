import Link from "next/link";
import { LegalFooter } from "./legal-footer";

/**
 * Layout for a public legal page. Plain, readable prose — no dashboard chrome.
 */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-12">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Pulse</Link>
        <h1 className="mt-6 text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Last updated: {updated}</p>
        <div className="legal-prose mt-8 space-y-5 text-sm leading-relaxed text-foreground/90">
          {children}
        </div>
        <LegalFooter />
      </div>
    </div>
  );
}
