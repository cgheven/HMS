// Food add-on pricing: an independent, optional charge (any Breakfast/Lunch/
// Dinner combination) layered on top of a tenant's room rent — separate from
// the bundled package-tier food logic (food_monthly_rate / FOOD_TIERS).
// Shared by billing sync, the tenant form, and the public room page so the
// bundle-discount rule is defined in exactly one place.

export interface FoodAddonFlags {
  food_breakfast: boolean;
  food_lunch: boolean;
  food_dinner: boolean;
}

export interface FoodAddonRates {
  food_breakfast_rate: number;
  food_lunch_rate: number;
  food_dinner_rate: number;
  food_all_meals_rate: number;
}

export function calcFoodAddonCharge(flags: FoodAddonFlags, rates: FoodAddonRates): number {
  const { food_breakfast: breakfast, food_lunch: lunch, food_dinner: dinner } = flags;
  if (!breakfast && !lunch && !dinner) return 0;

  const sum =
    (breakfast ? Number(rates.food_breakfast_rate) || 0 : 0) +
    (lunch ? Number(rates.food_lunch_rate) || 0 : 0) +
    (dinner ? Number(rates.food_dinner_rate) || 0 : 0);

  const allMeals = Number(rates.food_all_meals_rate) || 0;

  if (breakfast && lunch && dinner && allMeals > 0) {
    // All three selected and a bundle rate exists: charge whichever is
    // cheaper. When individual rates aren't configured at all (sum === 0,
    // a "bundle-only" hostel), the bundle rate is what applies — NOT zero.
    return sum > 0 ? Math.min(sum, allMeals) : allMeals;
  }
  return sum;
}

// Package tiers that already bundle food into the tier's own rent (billed via
// food_monthly_rate). The food add-on UI must not be offered for these — it
// would double-charge food, once via the bundled tier and once via the addon.
export const FOOD_INCLUSIVE_TIERS = new Set<string>([
  "space_food", "space_3meals", "space_food_ac", "space_meals_cooler",
]);

// Whether ANY food add-on rate is configured — gates whether the "Add Food"
// UI should render at all. Includes the bundle rate so a hostel that only
// wants to sell the all-3-meals bundle (no individual meal pricing) still
// surfaces a way to reach it.
export function hasFoodAddonRates(rates: FoodAddonRates): boolean {
  return (
    Number(rates.food_breakfast_rate) > 0 ||
    Number(rates.food_lunch_rate) > 0 ||
    Number(rates.food_dinner_rate) > 0 ||
    Number(rates.food_all_meals_rate) > 0
  );
}

// Whether any meal is individually priced. When false but hasFoodAddonRates()
// is true, the hostel only sells the all-3-meals bundle — the UI must render
// a single combined toggle instead of 3 separate checkboxes, since a partial
// (1-2 meal) selection has no defined price in that configuration.
export function hasIndividualFoodRates(rates: FoodAddonRates): boolean {
  return (
    Number(rates.food_breakfast_rate) > 0 ||
    Number(rates.food_lunch_rate) > 0 ||
    Number(rates.food_dinner_rate) > 0
  );
}
