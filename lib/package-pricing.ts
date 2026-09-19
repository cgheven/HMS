import type { PackageTier } from "@/types";

export type PkgPriceEntry = { no_ac: string; ac: string; deposit_no_ac: string; deposit_ac: string };
export type PkgPriceForm = Record<PackageTier, PkgPriceEntry>;

export const PACKAGE_TIER_CONFIGS: { tier: PackageTier; label: string; desc: string; hasAcVariant: boolean }[] = [
  { tier: "space_only",          label: "Space Only",                  desc: "No meals",                  hasAcVariant: true  },
  { tier: "space_food",          label: "Space + Breakfast & Dinner",  desc: "2 meals / day",             hasAcVariant: true  },
  { tier: "space_3meals",        label: "Space + 3 Meals",             desc: "Breakfast, lunch & dinner", hasAcVariant: true  },
  { tier: "space_meals_cooler",  label: "Space + Meals + Cooler",      desc: "Meals + cooler",            hasAcVariant: false },
];

export function emptyPriceForm(): PkgPriceForm {
  return {
    space_only:         { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" },
    space_food:         { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" },
    space_3meals:       { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" },
    space_food_ac:      { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" }, // kept for DB compatibility; not shown in UI
    space_meals_cooler: { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" },
  };
}
