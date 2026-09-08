import "server-only";

/**
 * Server-side client for a provincial HotelEye ("Smart Eye") portal.
 *
 * Ported from the reconnaissance client in hotel_eye_integration/, with one
 * deliberate difference: login is split in two so a HUMAN solves the CAPTCHA.
 * startLogin() fetches the login page and the CAPTCHA image and hands both back;
 * the owner types the characters; completeLogin() submits them. Nothing here
 * solves or bypasses the CAPTCHA — that control is left to the person it is for.
 *
 * The portal is a classic server-rendered CodeIgniter app: a rotating CSRF field
 * (random name, value mirrored in a cookie), a per-session form-action hash, and
 * a session cookie. All three are parsed live and carried forward. Node's fetch
 * has no cookie jar, so cookies are captured from Set-Cookie and replayed by hand.
 */

// ── tiny cookie jar ───────────────────────────────────────────────────────
export type CookieJar = Record<string, string>;

function absorb(jar: CookieJar, res: Response): CookieJar {
  const next = { ...jar };
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq > 0) next[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return next;
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

// ── login-page parsing ────────────────────────────────────────────────────
const FORM_RE = /<form\b[^>]*\bid=["']login["'][^>]*\baction=["']([^"']+)["']/i;
const FORM_RE2 = /<form\b[^>]*\baction=["']([^"']+)["'][^>]*\bid=["']login["']/i;
const INPUT_RE = /<input\b[^>]*>/gi;
const NAME_RE = /\bname=["']([^"']+)["']/i;
const VALUE_RE = /\bvalue=["']([^"']*)["']/i;
const IMG_RE = /<img\b[^>]*\bid=["']Imageid["'][^>]*\bsrc=["']([^"']+)["']/i;

const LOGIN_KNOWN = new Set(["txtusername", "txtpassword", "captcha", "g-recaptcha-response", "submit"]);

function absolute(base: string, path: string): string {
  try { return new URL(path, base).toString(); } catch { return path; }
}

interface LoginPage {
  action: string;
  fields: Record<string, string>;
  captchaUrl: string;
  csrfField: string | null;
}

function parseLoginPage(html: string, base: string): LoginPage {
  const form = FORM_RE.exec(html) ?? FORM_RE2.exec(html);
  if (!form) throw new Error("HotelEye login form not found — the portal layout may have changed.");
  const action = absolute(base, form[1]);

  const fields: Record<string, string> = {};
  for (const tag of html.match(INPUT_RE) ?? []) {
    const nm = NAME_RE.exec(tag);
    if (!nm) continue;
    fields[nm[1]] = VALUE_RE.exec(tag)?.[1] ?? "";
  }

  const img = IMG_RE.exec(html);
  if (!img) throw new Error("HotelEye CAPTCHA image not found on the login page.");

  const csrfField = Object.keys(fields).find((n) => !LOGIN_KNOWN.has(n) && fields[n]) ?? null;
  return { action, fields, captchaUrl: absolute(base, img[1]), csrfField };
}

// ── pending login (carried across the human CAPTCHA step) ─────────────────
export interface PendingLogin {
  portalUrl: string;
  action: string;
  fields: Record<string, string>;
  cookies: CookieJar;
  expiresAt: number;
}

export interface StartLoginResult {
  pending: PendingLogin;
  captcha: { base64: string; mediaType: string };
}

/** Step 1: fetch the login page and the CAPTCHA image for the owner to read. */
export async function startLogin(portalUrl: string): Promise<StartLoginResult> {
  const loginUrl = new URL("/login/", portalUrl).toString();
  const pageRes = await fetch(loginUrl, { headers: { "User-Agent": UA }, redirect: "manual" });
  if (!pageRes.ok) throw new Error(`HotelEye login page returned ${pageRes.status}.`);
  const cookies = absorb({}, pageRes);
  const page = parseLoginPage(await pageRes.text(), loginUrl);

  const imgRes = await fetch(page.captchaUrl, {
    headers: { "User-Agent": UA, Referer: loginUrl, Cookie: cookieHeader(cookies) },
  });
  if (!imgRes.ok) throw new Error(`HotelEye CAPTCHA image returned ${imgRes.status}.`);
  const base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
  const mediaType = imgRes.headers.get("content-type") || "image/jpeg";

  return {
    pending: {
      portalUrl,
      action: page.action,
      fields: page.fields,
      cookies: absorb(cookies, imgRes),
      // Short window: the owner types a few characters, not fills a form. The
      // CAPTCHA itself expires server-side anyway; this bounds the encrypted
      // blob's usefulness if it is ever intercepted.
      expiresAt: Date.now() + 5 * 60 * 1000,
    },
    captcha: { base64, mediaType },
  };
}

export interface LoginSession {
  portalUrl: string;
  cookies: CookieJar;
}

/** Step 2: submit credentials + the human-entered CAPTCHA. */
export async function completeLogin(
  pending: PendingLogin,
  username: string,
  password: string,
  captchaText: string
): Promise<{ authenticated: boolean; session: LoginSession | null; error?: string }> {
  if (Date.now() > pending.expiresAt) {
    return { authenticated: false, session: null, error: "The CAPTCHA expired. Start the sync again." };
  }
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(pending.fields)) body.set(k, v);
  body.set("txtusername", username);
  body.set("txtpassword", password);
  body.set("captcha", captchaText.trim());
  if (!body.has("submit")) body.set("submit", "");

  const res = await fetch(pending.action, {
    method: "POST",
    body,
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: new URL(pending.portalUrl).origin,
      Referer: new URL("/login/", pending.portalUrl).toString(),
      Cookie: cookieHeader(pending.cookies),
    },
  });
  const cookies = absorb(pending.cookies, res);
  const html = (await res.text()).toLowerCase();
  const stillLogin = html.includes('name="txtpassword"') || html.includes('id="imageid"');
  const errored = ["invalid", "incorrect", "captcha", "try again", "wrong"].some((k) => html.includes(k));

  if (stillLogin || errored) {
    // The portal re-renders the login form on any failure without saying which
    // of password or CAPTCHA was wrong, so neither can be named specifically.
    return {
      authenticated: false,
      session: null,
      error: "Login was rejected — check the username, password and CAPTCHA, then try again.",
    };
  }
  return { authenticated: true, session: { portalUrl: pending.portalUrl, cookies } };
}

const CNIC_RE = /\b\d{5}-?\d{7}-?\d\b/g;

/**
 * The CNICs this hotel has ALREADY filed, read from its watch list.
 *
 * Used to dedupe: a guest already on the portal is never posted again, so the
 * integration can't create a second entry — and existing manual filings are
 * recognised rather than re-sent. Digits only, so "34501-6752651-3" and
 * "3450167526513" compare equal. Returns null (not an empty set) if the list
 * can't be read, so the caller can tell "nobody filed" from "couldn't check".
 */
export async function listFiledCnics(session: LoginSession): Promise<Set<string> | null> {
  const listUrl = new URL("/hotel/hotelwatchList", session.portalUrl).toString();
  try {
    const res = await fetch(listUrl, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(session.cookies) },
      redirect: "follow",
    });
    if (!res.ok || res.url.toLowerCase().includes("/login")) return null;
    const html = await res.text();
    const set = new Set<string>();
    for (const m of html.match(CNIC_RE) ?? []) set.add(m.replace(/\D/g, ""));
    return set;
  } catch {
    return null;
  }
}

/** Is a stored session still logged in? One cheap GET — the portal bounces a
 *  dead session to /login. Used to decide whether a sync can skip the CAPTCHA. */
export async function probeSession(session: LoginSession): Promise<boolean> {
  const entryUrl = new URL("/hotel/addwatchentries", session.portalUrl).toString();
  try {
    const res = await fetch(entryUrl, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(session.cookies) },
      redirect: "follow",
    });
    return res.ok && !res.url.toLowerCase().includes("/login");
  } catch {
    return false;
  }
}

// ── guest submission ──────────────────────────────────────────────────────
export interface HotelEyeGuest {
  cnic: string;
  name: string;
  fatherName: string;
  address: string;
  gender: "Male" | "Female";
  cellNo: string;
  province: string;
  district: string; // the portal's numeric district value
  roomNo: string;
  checkInDate: string; // YYYY-MM-DD
  visitPurpose?: string;
  male?: string;
  female?: string;
  children?: string;
}

const HIDDEN_RE = /<input\b[^>]*type=["']hidden["'][^>]*>/gi;

function csrfFromEntryForm(html: string): { name: string; value: string } {
  for (const tag of html.match(HIDDEN_RE) ?? []) {
    const nm = NAME_RE.exec(tag)?.[1];
    const val = VALUE_RE.exec(tag)?.[1];
    if (nm && val && !nm.startsWith("data") && !LOGIN_KNOWN.has(nm) && nm !== "total") {
      return { name: nm, value: val };
    }
  }
  throw new Error("HotelEye entry-form CSRF token not found.");
}

/**
 * File one guest into the authenticated hotel's watch list.
 *
 * Only ever posts to the standard add-entry endpoint for the logged-in hotel —
 * no admin-scope fields, no record-id guessing, nothing from the reconnaissance
 * client beyond the documented public form. Success is the portal's own signal:
 * a redirect to the watch list.
 */
export async function addGuest(
  session: LoginSession,
  guest: HotelEyeGuest
): Promise<{ success: boolean; error?: string; authExpired?: boolean }> {
  const entryUrl = new URL("/hotel/addwatchentries", session.portalUrl).toString();
  const listUrl = new URL("/hotel/hotelwatchList", session.portalUrl).toString();

  const formRes = await fetch(entryUrl, {
    headers: { "User-Agent": UA, Referer: listUrl, Cookie: cookieHeader(session.cookies) },
    redirect: "follow",
  });
  // The portal bounces an expired session back to the login page. Distinguished
  // from a genuine rejection so the caller can ask for one fresh CAPTCHA and
  // resume, rather than marking every remaining guest as failed.
  if (formRes.url.toLowerCase().includes("/login")) {
    return { success: false, authExpired: true, error: "The portal session expired." };
  }
  if (!formRes.ok) return { success: false, error: `Entry form returned ${formRes.status}.` };
  let csrf: { name: string; value: string };
  try { csrf = csrfFromEntryForm(await formRes.text()); }
  catch (e) { return { success: false, error: e instanceof Error ? e.message : "CSRF token missing." }; }

  const body = new URLSearchParams({
    [csrf.name]: csrf.value,
    "data[gue_cnic]": guest.cnic,
    "data[gue_name_guest]": guest.name,
    "data[gue_father_name]": guest.fatherName,
    "data[gue_nadara]": "0",
    total: "1",
    "data[gue_p_address]": guest.address,
    "data[gue_gender]": guest.gender,
    "data[gue_cell_no]": guest.cellNo,
    "data[gue_p_province]": guest.province,
    "data[gue_p_district]": guest.district,
    "data[gue_t_address]": "",
    "data[gue_t_province]": "",
    "data[gue_t_district]": "",
    "data[gue_male]": guest.male ?? (guest.gender === "Male" ? "1" : ""),
    "data[gue_female]": guest.female ?? (guest.gender === "Female" ? "1" : ""),
    "data[gue_childern]": guest.children ?? "",
    "data[gue_visit_purpose]": guest.visitPurpose ?? "",
    "data[gue_check_in]": guest.checkInDate,
    time1: "12:00 PM",
    "data[gue_check_out]": "",
    time2: "",
    "data[gue_room_no]": guest.roomNo,
    "data[gue_loc_ref_name]": "",
    "data[gue_loc_ref_father_name]": "",
    "data[gue_loc_ref_busi]": "",
    "data[gue_loc_ref_add]": "",
    "data[gue_loc_ref_cell_no]": "",
    "data[gue_loc_ref_verified]": "",
    "data[gue_expected]": "0",
  });

  const res = await fetch(entryUrl, {
    method: "POST",
    body,
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: new URL(session.portalUrl).origin,
      Referer: entryUrl,
      Cookie: cookieHeader(session.cookies),
    },
  });
  if (res.url.toLowerCase().includes("hotelwatchlist")) return { success: true };
  return { success: false, error: `The portal did not confirm the entry (ended at ${res.status}).` };
}
