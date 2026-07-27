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

  // Attached washroom is a flat add-on on top of whatever base price a tier
  // resolves to — same amount regardless of package tier or seater count,
  // only applied when the room's own flag is set. Defaults to 0, so hostels
  // that never set it see no change. Never added to a tier that isn't priced
  // at all (disabled stays at 0, not 0 + premium).
  const washroomAddOn = room.has_attached_washroom ? (config?.washroom_premium ?? 0) : 0;
  function withWashroom(base: number | null): number {
    return base != null ? base + washroomAddOn : 0;
  }

  // Seater price (by room capacity + AC) takes priority when configured — it's
  // the most specific, intentional pricing signal. Falls back to the flat
  // "Space Only" package price, then the room's own manual rent, exactly as
  // before for hostels that never set seater pricing.
  const spaceOnlyBase = getSeaterPrice(room.capacity, room.has_ac, config?.seater_prices) ?? pkgPrice("space_only") ?? room.monthly_rent;

  const options: PackageOption[] = [
    {
      tier: "space_only",
      label: "Space Only",
      subtitle: "Bed + room facilities",
      price: withWashroom(spaceOnlyBase),
      extra: null,
      disabled: false,
    },
    {
      tier: "space_food",
      label: "Space + Breakfast & Dinner",
      subtitle: "Bed + 2 meals daily",
      price: withWashroom(pkgPrice("space_food")),
      extra: null,
      disabled: !pkgPrice("space_food"),
    },
    {
      tier: "space_3meals",
      label: "Space + 3 Meals",
      subtitle: "Bed + breakfast, lunch & dinner",
      price: withWashroom(pkgPrice("space_3meals")),
      extra: null,
      disabled: !pkgPrice("space_3meals"),
    },
  ];

  if (room.has_cooler) {
    options.push({
      tier: "space_meals_cooler",
      label: "Space + Meals + Cooler",
      subtitle: "Bed + meals + cooler included",
      price: withWashroom(pkgPrice("space_meals_cooler")),
      extra: null,
      disabled: !pkgPrice("space_meals_cooler"),
    });
  }

  return options;
}
