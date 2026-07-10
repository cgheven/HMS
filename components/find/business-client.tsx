"use client";
import { Home } from "lucide-react";
import { HostelCard } from "./find-client";
import type { PublicHostel } from "@/types";

interface Props {
  slug: string;
  ownerName: string | null;
  branches: PublicHostel[];
}

export function BusinessClient({ slug, ownerName, branches }: Props) {
  const heading = ownerName ?? branches[0]?.name ?? "Our Branches";

  return (
    <div className="min-h-screen bg-[#0A0A0B]">
      <div className="border-b border-white/[0.06] bg-[#0D0D0F]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber/15 border border-amber/25 flex items-center justify-center shrink-0">
            <Home className="w-4.5 h-4.5 text-amber" />
          </div>
          <div>
            <h1 className="font-serif text-xl sm:text-2xl font-medium text-foreground leading-tight">{heading}</h1>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              {branches.length} {branches.length === 1 ? "branch" : "branches"} · Direct contact · No fees
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {branches.map((h) => (
            <HostelCard key={h.id} h={h} hrefBase={`/find/${slug}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
