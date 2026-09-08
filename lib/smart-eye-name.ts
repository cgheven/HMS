/**
 * What the government guest-registration system is called where a hostel is.
 *
 * It's one federal-style requirement branded differently per province:
 *   Punjab → "Smart Eye"   ·   Sindh → "Hotel Eye"
 * so the app shows each owner the name they actually know it by.
 *
 * There is no province column on a hostel, only `city`, so province is inferred
 * from the city. An unknown or blank city falls back to "Hotel Eye" — the name
 * of the underlying portal (hoteleye.*), which reads as generic rather than wrong.
 */

const PROVINCE_BY_CITY: Record<string, string> = {
  // Punjab
  lahore: "Punjab", faisalabad: "Punjab", rawalpindi: "Punjab", multan: "Punjab",
  gujranwala: "Punjab", sialkot: "Punjab", bahawalpur: "Punjab", sargodha: "Punjab",
  sahiwal: "Punjab", sheikhupura: "Punjab", jhang: "Punjab", gujrat: "Punjab",
  kasur: "Punjab", okara: "Punjab", "rahim yar khan": "Punjab", "dera ghazi khan": "Punjab",
  // Sindh
  karachi: "Sindh", hyderabad: "Sindh", sukkur: "Sindh", larkana: "Sindh",
  "mirpur khas": "Sindh", mirpurkhas: "Sindh", nawabshah: "Sindh", "shaheed benazirabad": "Sindh",
  // Others
  islamabad: "Islamabad", peshawar: "Khyber Pakhtunkhwa", quetta: "Balochistan",
};

const NAME_BY_PROVINCE: Record<string, string> = {
  Punjab: "Smart Eye",
  Sindh: "Hotel Eye",
};

const DEFAULT_NAME = "Hotel Eye";

export function provinceFromCity(city: string | null | undefined): string | null {
  const key = (city ?? "").trim().toLowerCase();
  return key ? PROVINCE_BY_CITY[key] ?? null : null;
}

/** Accepts a province name directly, or falls back to city inference. */
export function smartEyeName(opts: { province?: string | null; city?: string | null }): string {
  const province = opts.province || provinceFromCity(opts.city);
  return (province && NAME_BY_PROVINCE[province]) || DEFAULT_NAME;
}
