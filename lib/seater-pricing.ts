// Seater pricing: automatic room pricing keyed by seat count (1-7) x AC
// status. Lets a hostel price rooms by capacity once instead of typing a
// rent into every individual room. Purely additive — resolves to null when
// unconfigured for a given capacity, so callers fall back to existing
// pricing sources (package_prices.space_only, then room.monthly_rent).

export interface SeaterRate {
  no_ac: number;
  ac: number;
  deposit_no_ac?: number;
  deposit_ac?: number;
}

export type SeaterPrices = Partial<Record<string, SeaterRate>>;

export const SEATER_CAPACITIES = ["1", "2", "3", "4", "5", "6", "7"] as const;

export const SEATER_LABELS: Record<string, string> = {
  "1": "Single Seater",
  "2": "Double Seater",
  "3": "Third Seater",
  "4": "Fourth Seater",
  "5": "Fifth Seater",
  "6": "Sixth Seater",
  "7": "Seventh Seater",
};

export function getSeaterPrice(
  capacity: number,
  hasAc: boolean,
  seaterPrices: SeaterPrices | null | undefined
): number | null {
  if (!seaterPrices) return null;
  const rate = seaterPrices[String(capacity)];
  if (!rate) return null;
  const val = hasAc ? Number(rate.ac) : Number(rate.no_ac);
  return val > 0 ? val : null;
}

export function getSeaterDeposit(
  capacity: number,
  hasAc: boolean,
  seaterPrices: SeaterPrices | null | undefined
): number | null {
  if (!seaterPrices) return null;
  const rate = seaterPrices[String(capacity)];
  if (!rate) return null;
  const val = hasAc ? Number(rate.deposit_ac) : Number(rate.deposit_no_ac);
  return val > 0 ? val : null;
}
