"use client";
import { Home } from "lucide-react";
import { HostelCard } from "./public/hostel-card";
import type { PublicHostel } from "@/types";

interface Props {
  slug: string;
  ownerName: string | null;
  branches: PublicHostel[];
  /** Where branch links point. Defaults to /find/{slug}; the branded-subdomain
   *  route passes "" so links stay on the client's own domain as /{branchSlug}. */
  hrefBase?: string;
}

export function BusinessClient({ slug, ownerName, branches, hrefBase }: Props) {
  const heading = ownerName ?? branches[0]?.name ?? "Our Branches";

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/[0.08] border border-primary/20 flex items-center justify-center shrink-0">
            <Home className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <h1 className="font-serif text-xl sm:text-2xl font-medium text-foreground leading-tight">{heading}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {branches.length} {branches.length === 1 ? "branch" : "branches"} · Direct contact · No fees
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {branches.map((h) => (
            <HostelCard key={h.id} h={h} hrefBase={hrefBase ?? `/find/${slug}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
