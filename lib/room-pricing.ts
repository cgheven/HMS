// Shared package/price computation for a single room — used by the public
// room detail modal AND the join/application form, so both ever compute a
// room's price the exact same way (one source of truth, no drift).

import { getSeaterPrice } from "@/lib/seater-pricing";
import type { PublicRoom, PackageConfig, PackageTier } from "@/types";

export interface PackageOption {
  tier: string;
  label: string;
  subtitle: string;
  price: number;
  extra: string | null;
  disabled: boolean;
}

export function buildPackageOptions(room: PublicRoom, config: PackageConfig | null): PackageOption[] {
  const pkgPrices = config?.package_prices ?? {};

  function pkgPrice(tier: PackageTier): number | null {
    const p = pkgPrices[tier];
    if (p) {
      const val = room.has_ac ? p.ac : p.no_ac;
      if (val > 0) return val;
    }
    return null;
  }

  // Seater price (by room capacity + AC) takes priority when configured — it's
  // the most specific, intentional pricing signal. Falls back to the flat
  // "Space Only" package price, then the room's own manual rent, exactly as
  // before for hostels that never set seater pricing.
  const spaceOnlyPrice = getSeaterPrice(room.capacity, room.has_ac, config?.seater_prices) ?? pkgPrice("space_only") ?? room.monthly_rent;

  const options: PackageOption[] = [
    {
      tier: "space_only",
      label: "Space Only",
      subtitle: "Bed + room facilities",
      price: spaceOnlyPrice,
      extra: null,
      disabled: false,
    },
    {
      tier: "space_food",
      label: "Space + Breakfast & Dinner",
      subtitle: "Bed + 2 meals daily",
      price: pkgPrice("space_food") ?? 0,
      extra: null,
      disabled: !pkgPrice("space_food"),
    },
    {
      tier: "space_3meals",
      label: "Space + 3 Meals",
      subtitle: "Bed + breakfast, lunch & dinner",
      price: pkgPrice("space_3meals") ?? 0,
      extra: null,
      disabled: !pkgPrice("space_3meals"),
    },
  ];

  if (room.has_cooler) {
    options.push({
      tier: "space_meals_cooler",
      label: "Space + Meals + Cooler",
      subtitle: "Bed + meals + cooler included",
      price: pkgPrice("space_meals_cooler") ?? 0,
      extra: null,
      disabled: !pkgPrice("space_meals_cooler"),
    });
  }

  return options;
}
