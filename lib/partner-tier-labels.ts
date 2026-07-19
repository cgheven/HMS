import type { PartnerTier } from "@/types";

// Shared, client-and-server-safe display metadata for partner tiers — kept in
// one place so the owner-side settings UI and the partner portal shell never
// drift on wording or color.

export const PARTNER_TIER_LABELS: Record<PartnerTier, string> = {
  read_only: "Read-only",
  standard: "Standard",
  full: "Full",
};

export const PARTNER_TIER_BADGE_VARIANT: Record<PartnerTier, "secondary" | "info" | "warning"> = {
  read_only: "secondary",
  standard: "info",
  full: "warning",
};

export const PARTNER_TIER_DESCRIPTIONS: Record<PartnerTier, { title: string; body: string }> = {
  read_only: {
    title: "Read-only access",
    body: "You can view but not modify data.",
  },
  standard: {
    title: "Standard access",
    body: "You can manage tenants, payments & expenses. Checkout and edits are owner-only.",
  },
  full: {
    title: "Full access",
    body: "You have equal rights to the owner on this branch.",
  },
};
