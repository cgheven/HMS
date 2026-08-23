/**
 * The hostel admission form, pre-filled and ready to sign.
 *
 * Owners were printing a Word file, writing the resident's details onto it by
 * hand, and filing the signed page — details this system already holds. So the
 * lines are printed already filled, and the resident writes only what we do not
 * store (gender, date of birth, blood group, marital status, religion,
 * landline) before signing.
 *
 * Every line is still drawn under every value, filled or not. A form that
 * silently dropped the rule under a printed name would read as a letter rather
 * than a form, and a resident correcting a wrong value has nowhere to write.
 *
 * CNIC is printed. The rule it might look like it breaks — CNIC never on a
 * public-facing receipt — is about documents served from a public token URL to
 * whoever holds the link. This is neither: it is generated in the owner's
 * browser, printed in their office, and handed to the person whose CNIC it is.
 */

/** A4 in millimetres, which is also jsPDF's unit here. */
const PAGE_W = 210;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;

export interface TenantFormTenant {
  full_name: string;
  father_name?: string | null;
  phone?: string | null;
  email?: string | null;
  cnic?: string | null;
  permanent_address?: string | null;
  emergency_contact?: string | null;
  emergency_phone?: string | null;
  emergency_relationship?: string | null;
  institute_name?: string | null;
  organization?: string | null;
  department?: string | null;
  student_specialization?: string | null;
  check_in?: string | null;
  billing_type?: "monthly" | "daily";
  monthly_rent?: number | null;
  daily_rate?: number | null;
  security_deposit?: number | null;
  /** One-time, charged in the check-in month. Stored per tenant — the branch
   *  default only prefills it, so this is the figure actually agreed. */
  registration_fee?: number | null;
  /** Derived, not stored: the branch's ac_maintenance_rate when this resident's
   *  room has AC. The column of the same name on hms_tenants is vestigial and
   *  zero on all 745 rows — the payment trigger recomputes it from the room. */
  ac_maintenance?: number | null;
  bed_number?: string | null;
}

/** Whatever hms_hostels.meal_times holds — every branch is still {} today, so
 *  each meal is independently optional. */
export interface FormMealTimes {
  breakfast?: { from?: string; to?: string };
  lunch?: { from?: string; to?: string };
  dinner?: { from?: string; to?: string };
}

export interface TenantFormHostel {
  name: string;
  /** Printed under the title so a signed page names the branch it binds to. */
  address?: string | null;
  phone?: string | null;
  /** From Settings — the rule is only worth printing if it matches the one the
   *  hostel actually enforces. Falls back to 30, the value 14 of 15 branches use. */
  noticePeriodDays?: number;
  /** From Settings. Unset on every branch today, so the meal rule degrades to
   *  "the timings displayed at the hostel" rather than printing empty times. */
  mealTimes?: FormMealTimes | null;
}

/** "Breakfast 7:00-9:00 · Lunch 1:00-3:00", or "" when nothing is configured. */
function mealLine(times: FormMealTimes | null | undefined): string {
  if (!times) return "";
  const parts: string[] = [];
  for (const [label, key] of [["Breakfast", "breakfast"], ["Lunch", "lunch"], ["Dinner", "dinner"]] as const) {
    const t = times[key];
    if (t?.from && t?.to) parts.push(`${label} ${t.from}-${t.to}`);
  }
  return parts.join(" · ");
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * What the resident is enrolled in, from whichever field the hostel actually
 * fills. Student hostels populate institute_name; the professional branches use
 * organization. Joined with the department when both are known, because
 * "BS Computer Science — UCP" is the answer the form is asking for and either
 * half alone is not.
 */
function courseLine(t: TenantFormTenant): string {
  const what = t.student_specialization || t.department || "";
  const where = t.institute_name || t.organization || "";
  if (what && where) return `${what} — ${where}`;
  return what || where;
}

export async function buildTenantFormPdf(
  tenant: TenantFormTenant,
  hostel: TenantFormHostel
): Promise<import("jspdf").jsPDF> {
  // Dynamic, matching every other PDF path in this codebase — jsPDF is ~350 KB
  // and no page should carry it just in case someone prints.
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const BODY = 10;
  const SMALL = 8.5;
  let y = MARGIN + 4;

  // ── Title ──────────────────────────────────────────────────────────────────
  //
  // The branch's own name IS the heading. "HOSTEL ACCOMMODATION APPLICATION
  // FORM" spent a full line of a page people write on saying what is obvious
  // from the fields, and said nothing about which of fifteen branches the sheet
  // belongs to — which is the one thing a filing cabinet needs.
  //
  // Full content width: the passport-photo box used to hold the top right and
  // is gone — it reserved 36mm of height for a rectangle nobody filled, on a
  // form where the empty writing lines were the thing short of space.
  const titleW = CONTENT_W;

  doc.setFont("times", "bold");
  const title = hostel.name.toUpperCase();
  // Shrunk to fit rather than wrapped: two lines here would push every field
  // down and cost the space this change was made to save.
  let titleSize = 16;
  doc.setFontSize(titleSize);
  while (titleSize > 10 && doc.getTextWidth(title) > titleW) {
    titleSize -= 0.5;
    doc.setFontSize(titleSize);
  }
  doc.text(title, MARGIN + titleW / 2, y, { align: "center" });
  const titleWidth = Math.min(doc.getTextWidth(title), titleW);
  doc.setLineWidth(0.4);
  doc.line(MARGIN + titleW / 2 - titleWidth / 2, y + 1.6, MARGIN + titleW / 2 + titleWidth / 2, y + 1.6);

  doc.setFont("times", "normal");
  doc.setFontSize(SMALL + 1.5);
  doc.text("Admission Form", MARGIN + titleW / 2, y + 7, { align: "center" });
  if (hostel.address) {
    doc.setFontSize(SMALL);
    doc.setTextColor(90);
    doc.text(hostel.address, MARGIN + titleW / 2, y + 12, { align: "center", maxWidth: titleW });
    doc.setTextColor(0);
  }

  y += 18;

  // ── Helpers ────────────────────────────────────────────────────────────────
  doc.setFont("times", "normal");

  /** A shaded section bar, as on the reference. */
  const section = (label: string) => {
    y += 3;
    // Bold text, no shading. One treatment, not two: the grey bar was a screen
    // idea on a sheet that gets photocopied and filed, where a solid fill costs
    // toner and turns muddy on a second-generation copy. Bold carries the same
    // separation and survives the copier.
    doc.setFont("times", "bold");
    doc.setFontSize(BODY + 1);
    doc.text(label, MARGIN, y);
    doc.setFont("times", "normal");
    doc.setFontSize(BODY);
    y += 7.5;
  };

  /**
   * One labelled line. The value sits ON the rule rather than above it, so a
   * filled field and an empty one occupy the same height and the form does not
   * reflow depending on how much the hostel happens to know.
   *
   * A value that does not fit is shrunk, then truncated — never wrapped.
   * jsPDF's maxWidth wraps to a second line, and since every row here advances
   * by a fixed 9mm, one long address would print straight through the rule
   * below it. Real data reaches 151 characters in permanent_address and 47 in
   * institute_name, so this is the normal case, not the pathological one.
   */
  const field = (label: string, value: string, x: number, width: number) => {
    doc.setFontSize(BODY);
    doc.text(label, x, y);
    const labelW = doc.getTextWidth(label) + 1.5;
    const lineStart = x + labelW;
    const lineEnd = x + width;
    doc.setLineWidth(0.25);
    doc.line(lineStart, y + 0.8, lineEnd, y + 0.8);
    if (!value) return;

    const room = lineEnd - lineStart - 2;
    doc.setFont("times", "bold");

    // Shrink before truncating: a 40-character address at 8pt is still legible
    // and still complete, which beats a tidy 10pt one ending in an ellipsis.
    let size = BODY;
    doc.setFontSize(size);
    while (size > 7 && doc.getTextWidth(value) > room) {
      size -= 0.5;
      doc.setFontSize(size);
    }

    let text = value;
    if (doc.getTextWidth(text) > room) {
      while (text.length > 1 && doc.getTextWidth(`${text}…`) > room) text = text.slice(0, -1);
      text = `${text.trimEnd()}…`;
    }

    doc.text(text, lineStart + 1, y);
    doc.setFont("times", "normal");
    doc.setFontSize(BODY);
  };

  const row = (
    fields: { label: string; value: string; width: number }[],
    gap = 3
  ) => {
    let x = MARGIN;
    for (const f of fields) {
      field(f.label, f.value, x, f.width);
      x += f.width + gap;
    }
    // 12mm. This is a sheet somebody writes on with a pen; the space freed by
    // dropping the undertaking and the photo box goes into the lines they
    // actually write on rather than back into the margin.
    y += 12;
  };

  // ── Room ───────────────────────────────────────────────────────────────────
  //
  // At the top, where the stay dates used to be. It is the first thing anyone
  // looks for on a filed form — which room this sheet belongs to — and it was
  // previously buried in the office block at the foot of the page.
  // 38mm total — a room number is "302" or "Room 302 · B", never more. The
  // rule was running four times the length of anything written on it.
  row([{ label: "Room#:", value: tenant.bed_number ?? "", width: 38 }]);

  // ── Personal ───────────────────────────────────────────────────────────────
  section("PERSONAL INFORMATION");

  // Block letters, as the form asks. Only the name — forcing an address or a
  // course to uppercase makes them harder to read, not easier.
  row([{ label: "Name of the Applicant (in Block letters):", value: tenant.full_name.toUpperCase(), width: CONTENT_W }]);
  row([
    { label: "Father Name:", value: tenant.father_name ?? "", width: 72 },
    { label: "Enrolled in Course:", value: courseLine(tenant), width: 99 },
  ]);
  row([{ label: "Permanent Address:", value: tenant.permanent_address ?? "", width: CONTENT_W }]);
  row([
    { label: "Gender:", value: "", width: 52 },
    { label: "Marital Status:", value: "", width: 60 },
    { label: "Religion:", value: "", width: 59 },
  ]);
  row([
    { label: "Date of Birth:", value: "", width: 62 },
    { label: "CNIC #:", value: tenant.cnic ?? "", width: 109 },
  ]);
  // Blood Group joins the contact line now that Land Line # and Any Medical
  // History / Disease are gone — neither was ever filled in, and a blank rule
  // on a form is a question somebody has to decide to skip.
  row([
    { label: "Blood Group:", value: "", width: 44 },
    { label: "Mob No:", value: tenant.phone ?? "", width: 55 },
    { label: "E-Mail:", value: tenant.email ?? "", width: 69 },
  ]);

  // ── Emergency ──────────────────────────────────────────────────────────────
  section("EMERGENCY CONTACT");

  row([
    { label: "Name:", value: tenant.emergency_contact ?? "", width: 66 },
    { label: "Relationship:", value: tenant.emergency_relationship ?? "", width: 50 },
    { label: "Contact No:", value: tenant.emergency_phone ?? "", width: 53 },
  ]);


  // ── Rules ──────────────────────────────────────────────────────────────────
  //
  // Compressed hard on purpose. These have to share one page with the fields
  // above, and a rule nobody reaches the end of is not enforceable in practice
  // — so each is one sentence carrying one obligation, in the order a resident
  // is most likely to break it.
  //
  // The notice period and meal timings come from Settings rather than being
  // written into the text: printing "30 days" on the form of a branch that
  // enforces 10 would be worse than printing nothing.
  section("HOSTEL RULES");

  const meals = mealLine(hostel.mealTimes);
  const noticeDays = hostel.noticePeriodDays ?? 30;

  const rules = [
    meals
      ? `Meals are served only at the hostel's fixed timings — ${meals}. No meals are served outside these hours.`
      : "Meals are served only at the hostel's fixed timings, as displayed at the hostel. No meals are served outside these hours.",
    "Residents are liable for damage to their room or to hostel property. Any maintenance or repair issue must be reported to the office promptly.",
    "Smoking, alcohol, weapons and illegal substances are prohibited on the premises. Any illegal activity will bring serious action under hostel rules and the law.",
    "Visitors, guests and fellow students are not allowed inside the hostel. In an emergency a visitor must be registered at the office and met only during office hours.",
    `Vacating the hostel requires ${noticeDays} days' notice to the office, given in good time.`,
  ];

  // Body size, not the 8.5pt small. These are the terms somebody signs against;
  // set smaller than the fields above they read as legal filler to skip, which
  // is the opposite of why they are on the page. The space came from dropping
  // the photo box.
  doc.setFontSize(BODY);
  const NUM_W = 5.5;
  const RULE_LINE = 4.6;
  for (let i = 0; i < rules.length; i++) {
    doc.text(`${i + 1}.`, MARGIN, y);
    const lines = doc.splitTextToSize(rules[i], CONTENT_W - NUM_W) as string[];
    doc.text(lines, MARGIN + NUM_W, y, { lineHeightFactor: 1.3 });
    y += lines.length * RULE_LINE + 2;
  }

  // The one line about money, kept bold. It is the clause that gets disputed,
  // and it is the reason a signature is being collected at all.
  y += 1.5;
  doc.setFont("times", "bold");
  doc.setFontSize(BODY);
  doc.text("Note: Monthly hostel dues once paid are non-refundable in any circumstances.", MARGIN, y);
  doc.setFont("times", "normal");
  doc.setFontSize(BODY);
  y += 7;

  // Without this the signature attests only to the details above, and the rules
  // are decoration. One line ties the two together.
  doc.setFontSize(BODY - 0.5);
  doc.text(
    "I confirm the details given above are correct and I accept the hostel rules stated above.",
    MARGIN,
    y
  );
  doc.setFontSize(BODY);
  y += 4;

  // ── Signature ──────────────────────────────────────────────────────────────
  y += 6;
  row([
    { label: "Dated:", value: "", width: 55 },
    { label: "Signature:", value: "", width: 80 },
  ], CONTENT_W - 135);

  // ── Office use ─────────────────────────────────────────────────────────────
  // Pinned to the foot of the page rather than following the flow, so it lands
  // in the same place on every form and an owner filing a stack of them is not
  // hunting for it.
  y += 9;
  doc.setFont("times", "bold");
  doc.setFontSize(SMALL);
  doc.text("FOR OFFICE USE ONLY", PAGE_W / 2, y, { align: "center" });
  doc.setLineWidth(0.25);
  doc.line(MARGIN, y + 2, PAGE_W - MARGIN, y + 2);
  y += 9;
  doc.setFont("times", "normal");

  const dues =
    tenant.billing_type === "daily"
      ? tenant.daily_rate
        ? `Rs ${Number(tenant.daily_rate).toLocaleString()} / day`
        : ""
      : tenant.monthly_rent
        ? `Rs ${Number(tenant.monthly_rent).toLocaleString()} / month`
        : "";

  const deposit = tenant.security_deposit
    ? `Rs ${Number(tenant.security_deposit).toLocaleString()}`
    : "";

  // Three across, then two. The deposit belongs here beside the dues — it is
  // the other number a resident can dispute at checkout, and until now the form
  // recorded a signature against the rent but said nothing about the money the
  // hostel is holding.
  const rupees = (v: number | null | undefined) =>
    v && Number(v) > 0 ? `Rs ${Number(v).toLocaleString()}` : "";
  const regFee = rupees(tenant.registration_fee);
  const acMaint = rupees(tenant.ac_maintenance);

  row([
    { label: "Date of Admission:", value: formatDate(tenant.check_in), width: 62 },
    { label: "Hostel Dues:", value: dues, width: 60 },
    { label: "Security Deposit:", value: deposit, width: 49 },
  ]);

  // Only when the branch actually charges them. Three of fifteen do, and a
  // permanent "Registration Fee: ______" on the other twelve is an invitation
  // to write a number nobody agreed to — the same reason the Tenants page hides
  // the field until it is configured.
  if (regFee || acMaint) {
    // 62 and 60 — the same widths as Date of Admission and Hostel Dues above, so
    // the two rows share a column grid instead of running the full width for a
    // four-digit number.
    row([
      { label: "Registration Fee:", value: regFee, width: 62 },
      { label: "AC Maintenance:", value: acMaint ? `${acMaint} / month` : "", width: 60 },
    ]);
  }


  return doc;
}

/**
 * Builds the form and hands it straight to the browser's print dialog.
 *
 * autoPrint puts the instruction inside the PDF itself, so the viewer opens
 * already asking to print — the owner's next action is choosing a printer, not
 * finding a downloaded file. The blob URL is revoked on a timer rather than
 * immediately: revoking it before the viewer has finished loading leaves a
 * blank tab.
 */
export async function printTenantForm(
  tenant: TenantFormTenant,
  hostel: TenantFormHostel
): Promise<void> {
  const doc = await buildTenantFormPdf(tenant, hostel);
  doc.autoPrint();

  const url = doc.output("bloburl") as unknown as string;
  const win = window.open(url, "_blank");
  if (!win) {
    // Popup blocked — a download is the honest fallback, and still gets them a
    // printable page rather than a silent no-op.
    doc.save(`${tenant.full_name.replace(/[^\w\s-]/g, "").trim() || "tenant"}-admission-form.pdf`);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
