// Shared preset list for city fields — same idea as lib/lead-sources.ts, so the
// options never drift between the places that collect a city.
//
// Free-typing a city produced exactly the mess you would expect: "Pindi" instead of
// Rawalpindi, "Lahore" and "LAHORE" as separate cities, and — twice — a branch count
// ("1", "4") typed into the city box. A preset list makes leads groupable by city.
export const PK_CITIES = [
  "Karachi", "Lahore", "Islamabad", "Peshawar", "Quetta",
  "Rawalpindi", "Faisalabad", "Multan", "Hyderabad", "Sialkot",
  "Gujranwala", "Bahawalpur", "Sukkur", "Abbottabad", "Mardan",
] as const;

export const CITY_OTHER = "Other";

/** True when a stored value needs the "Other" free-text box to round-trip unchanged. */
export function isPresetCity(city: string | null | undefined): boolean {
  return !!city && (PK_CITIES as readonly string[]).includes(city);
}
