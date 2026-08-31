// Shared AC electricity segment-billing math, used by both the owner path
// (app/actions/payments.ts: applyRoomACUnitsAction) and the manager path
// (app/actions/managers.ts: applyRoomACUnitsAsManager). Previously duplicated
// independently in each file; the manager copy never grew join-date-aware
// segment billing, so a manager applying AC units billed mid-month joiners
// for the full month. Extracted so both tiers share one implementation and
// can never diverge again.

export interface ACEligibleTenant {
  id: string;
  check_in: string;
  joining_meter_reading: number | null;
}

export interface ACJoinReadingRow {
  tenant_id: string;
  units_at_join: number;
}

export interface ACCheckoutReadingRow {
  meter_reading: number;
  tenant_count_at_checkout: number;
}

export interface ACTenantBillingRow {
  id: string;
  tenantUnits: number;
  charge: number;
}

export interface ACSegmentBillingResult {
  tenantBilling: ACTenantBillingRow[];
  proRatedCount: number;
  unassignedUnits: number;
  /** Departed tenants who shared this month's meter and are therefore part of
   *  the divisor, even though they hold no row in `tenantBilling` (they were
   *  charged at checkout). The room's real head count is
   *  `tenantBilling.length + departedCounted` — anything less makes the split
   *  look like it divided by too few people. */
  departedCounted: number;
}

// ac_charge MUST always equal ac_units_consumed × rate. markPaymentPaidAction
// re-derives the charge that way and refuses to accept a payment that disagrees
// ("Amount received exceeds the remaining balance"), and receipts itemise it as
// "N units × Rs rate/unit". Splitting a room rarely lands on whole units, so each
// share is rounded to 2 decimal places (ac_units_consumed is numeric(10,2)) and
// the charge is derived from that — never computed on its own, which is how the
// two drifted apart.
function applyUnitRate(rows: { tenantUnits: number; charge: number }[], perUnitRate: number): void {
  for (const r of rows) r.charge = Math.round(r.tenantUnits * perUnitRate);
}

// Round a unit share to 2dp — ac_units_consumed's DB precision. Splitting units
// evenly should land tenants within a cent-equivalent of each other, never a
// whole unit apart (a 2-tenant room with 145 units gets 72.5/72.5, not 73/72).
// Exported so lib/tenant-checkout.ts's mid-month checkout share uses the same
// rounding granularity as month-end billing.
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Force the rows to sum to `target` exactly, by pushing the sub-cent rounding
// residual onto the tenant with the most units.
//
// It used to land on whichever tenant happened to be LAST, clamped at zero. When
// that tenant was billed 0 units — a joiner whose move-in reading equals the
// month-end reading, so they consumed nothing — the clamp discarded a negative
// correction instead of applying it, and the room billed 0.01 units more than the
// meter recorded. Rs 1 on Room 5, but it also tripped the "billed above the meter"
// warning, which told the operator to press Apply on something Apply could not fix.
//
// The largest row is chosen because it is the only one guaranteed to absorb a
// negative residual without itself going negative.
function absorbResidual(rows: ACTenantBillingRow[], target: number): void {
  if (rows.length === 0) return;
  const sum = rows.reduce((s, r) => s + r.tenantUnits, 0);
  const residual = round2(target - sum);
  if (residual === 0) return;
  let sink = rows[0];
  for (const r of rows) if (r.tenantUnits > sink.tenantUnits) sink = r;
  sink.tenantUnits = Math.max(0, round2(sink.tenantUnits + residual));
}

export function computeACSegmentBilling(params: {
  eligible: ACEligibleTenant[];
  prevReading: number;
  reading: number;
  units: number;
  perUnitRate: number;
  forMonth: string;
  joinReadingsRaw: ACJoinReadingRow[];
  checkoutReadingsRaw: ACCheckoutReadingRow[];
}): ACSegmentBillingResult {
  const { eligible, prevReading, reading, units, perUnitRate, forMonth, joinReadingsRaw, checkoutReadingsRaw } = params;

  // Use join readings for ALL eligible tenants regardless of join date.
  // A tenant on the 1st with units_at_join=0 produces equal split (the duplicate 0 is deduplicated by
  // the Set, leaving one segment [0,total] where they are present for the full range).
  // A tenant on the 1st with units_at_join=10 correctly assigns those 10 units to whoever came first.
  const manualJoinReadings = (joinReadingsRaw ?? []).filter(r =>
    eligible.some(t => t.id === r.tenant_id)
  );

  // Check-in captures a meter reading on the tenant, but only a hand-typed entry under
  // "Mid-Month Joiners" ever became a breakpoint — so someone who moved in on the 20th
  // was billed from unit 0, for AC burned before they arrived. Derive the breakpoint
  // from what check-in already recorded.
  //
  // Derived here rather than stored at check-in on purpose: units_at_join is an offset
  // from the month's opening reading, and that opening is often only known now, when
  // the operator types it. Storing it earlier bakes in a baseline that may not survive.
  //
  // Scoped to tenants who joined THIS month — anyone from an earlier month was present
  // from the first unit, and giving them a breakpoint would wrongly excuse them.
  const manualIds = new Set(manualJoinReadings.map(r => r.tenant_id));
  const derivedJoinReadings = eligible
    .filter(t =>
      !manualIds.has(t.id) &&                       // a typed entry is a correction — it wins
      t.joining_meter_reading != null &&
      typeof t.check_in === "string" &&
      t.check_in.slice(0, 7) === forMonth
    )
    .map(t => ({
      tenant_id: t.id,
      units_at_join: Math.max(0, Math.round(Number(t.joining_meter_reading) - prevReading)),
    }));

  const joinReadings = [...manualJoinReadings, ...derivedJoinReadings]
    .sort((a, b) => a.units_at_join - b.units_at_join);

  // Checkout segments: departed tenants who paid at checkout — their tenure is now breakpoints.
  // Sorted by meter_reading ascending = chronological departure order.
  const rawCheckoutReadings = (checkoutReadingsRaw ?? []);

  // Validate: a checkout reading ABOVE the month-end reading means the meter ran
  // backwards, which is impossible — one of the two numbers is a typo. Equality
  // is not: a tenant departs at reading X and no AC is used afterwards, so the
  // month closes at X too. That case is billed below, not rejected.
  const conflictingCheckout = rawCheckoutReadings.find(
    cr => Math.round(Number(cr.meter_reading)) > reading
  );
  if (conflictingCheckout) {
    throw new Error(
      `Month-end reading (${reading}) cannot be less than a checkout reading. ` +
      `Found a checkout reading of ${Math.round(Number(conflictingCheckout.meter_reading))} — ` +
      `please verify the meter reading is correct.`
    );
  }

  // `<= units`, not `< units`. A departure at exactly the month-end reading opens
  // no new interval inside [0, units] — but it still means that tenant was in the
  // room for the whole window, so they belong in the divisor of every segment.
  // Excluding them re-split the entire month across only the tenants who stayed,
  // on top of the share the departing tenant was already charged at checkout, and
  // the room billed more units than the meter recorded.
  const checkoutSegments = rawCheckoutReadings
    .map(cr => ({
      unitsOffset: Math.max(0, Math.round(Number(cr.meter_reading) - prevReading)),
      tenantCount: Number(cr.tenant_count_at_checkout),
    }))
    .filter(cr => cr.unitsOffset > 0 && cr.unitsOffset <= units);

  const n = eligible.length;
  let proRatedCount = 0;
  let unassignedUnits = 0;

  let tenantBilling: ACTenantBillingRow[];

  if (checkoutSegments.length > 0) {
    // ── Period + join-aware billing: merges departure checkpoints and mid-month join
    // readings into a single event timeline. Departed tenants already paid their share at
    // checkout; this path computes each remaining active tenant's proportional units.
    //
    // For each segment [from, to]:
    //   activePresent  = eligible tenants whose join point ≤ from (or no join reading)
    //   departedPresent = departed tenants with unitsOffset ≥ to (still in room for whole segment)
    //   totalCount     = activePresent.length + departedPresent
    //   each activePresent tenant accumulates segUnits / totalCount
    const boundarySet = new Set<number>([
      0,
      ...checkoutSegments.map(cr => cr.unitsOffset),
      ...joinReadings.map(r => Math.min(Number(r.units_at_join), units)).filter(x => x > 0),
      units,
    ]);
    const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

    const accumulated = new Map<string, number>(eligible.map(t => [t.id, 0]));

    for (let i = 0; i < boundaries.length - 1; i++) {
      const from = boundaries[i];
      const to = boundaries[i + 1];
      const segUnits = to - from;
      if (segUnits <= 0) continue;

      const presentActive = eligible.filter(t => {
        const jr = joinReadings.find(jr => jr.tenant_id === t.id);
        return !jr || Number(jr.units_at_join) <= from;
      });
      const departedPresent = checkoutSegments.filter(cs => cs.unitsOffset >= to).length;
      const totalCount = presentActive.length + departedPresent;

      if (totalCount > 0) {
        const share = segUnits / totalCount;
        for (const t of presentActive) accumulated.set(t.id, (accumulated.get(t.id) ?? 0) + share);
      }
    }

    if (units === 0) {
      tenantBilling = eligible.map(t => ({ id: t.id, tenantUnits: 0, charge: 0 }));
    } else {
      const totalAccumulated = [...accumulated.values()].reduce((s, v) => s + v, 0);
      const rows = eligible.map(t => ({
        id: t.id,
        tenantUnits: round2(accumulated.get(t.id) ?? 0),
        charge: 0,
      }));
      absorbResidual(rows, round2(totalAccumulated));
      applyUnitRate(rows, perUnitRate);
      tenantBilling = rows;
    }
  } else if (joinReadings.length === 0) {
    // ── Equal split: fractional shares (2dp) — last tenant absorbs only the
    // sub-cent rounding residual, never a whole unit ──
    const rawShare = n > 1 ? units / n : units;
    const rows = eligible.map((t) => ({
      id: t.id,
      tenantUnits: round2(rawShare),
      charge: 0,
    }));
    absorbResidual(rows, units);
    applyUnitRate(rows, perUnitRate);
    tenantBilling = rows;
  } else {
    // ── Segment billing ──────────────────────────────────────
    proRatedCount = joinReadings.length;
    const joinedIds = new Set(joinReadings.map(r => r.tenant_id));
    const fullMonth = eligible.filter(t => !joinedIds.has(t.id));
    const midMonth = eligible.filter(t => joinedIds.has(t.id));

    const eventPoints = Array.from(
      new Set([0, ...joinReadings.map(r => Math.min(Number(r.units_at_join), units)), units])
    ).sort((a, b) => a - b);

    const accumulated = new Map<string, number>(eligible.map(t => [t.id, 0]));

    for (let i = 0; i < eventPoints.length - 1; i++) {
      const from = eventPoints[i];
      const to = eventPoints[i + 1];
      const segUnits = to - from;
      if (segUnits <= 0) continue;
      const present = [
        ...fullMonth,
        ...midMonth.filter(t => {
          const r = joinReadings.find(jr => jr.tenant_id === t.id);
          return r ? Number(r.units_at_join) <= from : false;
        }),
      ];
      if (present.length === 0) continue;
      const share = segUnits / present.length;
      for (const t of present) accumulated.set(t.id, (accumulated.get(t.id) ?? 0) + share);
    }

    if (units === 0) {
      tenantBilling = eligible.map(t => ({ id: t.id, tenantUnits: 0, charge: 0 }));
    } else {
      const assignedUnits = [...accumulated.values()].reduce((s, v) => s + v, 0);
      unassignedUnits = Math.max(0, round2(units - assignedUnits));
      if (assignedUnits === 0) {
        tenantBilling = eligible.map(t => ({ id: t.id, tenantUnits: 0, charge: 0 }));
      } else {
        const rows = eligible.map(t => ({
          id: t.id,
          tenantUnits: round2(accumulated.get(t.id) ?? 0),
          charge: 0,
        }));
        absorbResidual(rows, round2(assignedUnits));
        applyUnitRate(rows, perUnitRate);
        tenantBilling = rows;
      }
    }
  }

  return { tenantBilling, proRatedCount, unassignedUnits, departedCounted: checkoutSegments.length };
}

// A mid-month joiner's move-in reading only marks the start of THEIR presence,
// not the room's — using it as the room's opening baseline silently zeroes their
// own join offset (they'd be treated as present from the baseline onward, i.e.
// the whole tracked window) whenever nobody else in the room has a recorded
// reading. Preferring a tenant who was already there before this month keeps the
// baseline meaning "where the room's tracked history starts," not "where the
// newest arrival happens to have joined." Only falls back to a joiner's own
// reading when literally no other data exists — in that case they define the
// entire tracked window, so treating them as present for all of it is correct.
export function deriveOpeningReading(
  tenants: { joining_meter_reading?: number | null; check_in?: string | null }[],
  forMonth?: string
): number | null {
  const toReading = (t: { joining_meter_reading?: number | null }): number | null =>
    t.joining_meter_reading != null ? Math.round(Number(t.joining_meter_reading)) : null;

  const preExisting = forMonth
    ? tenants.filter(t => !(typeof t.check_in === "string" && t.check_in.slice(0, 7) === forMonth))
    : tenants;

  const preferred = preExisting.map(toReading).filter((v): v is number => v != null);
  if (preferred.length > 0) return Math.min(...preferred);

  const fallback = tenants.map(toReading).filter((v): v is number => v != null);
  return fallback.length > 0 ? Math.min(...fallback) : null;
}

/**
 * The previous month's TRUE closing reading.
 *
 * A row recorded while the room stood empty is a snapshot from the day it was
 * taken, not a month-end close — and nothing updates it afterwards. Let the room
 * in the same month and the departing tenant's checkout reading becomes the real
 * closing figure, while the stored row stays frozen at the earlier number. The
 * next month then opens too low and bills its first tenant for units the guest
 * before them consumed.
 *
 * Checkout readings are absolute meter values written against the ROOM, so the
 * highest one in that month is the last thing the meter is known to have read.
 *
 * Only ever raises the opening, and only for a vacant-flagged row — so it cannot
 * touch a single reading that exists today: recorded_while_vacant arrived with
 * migration 210 and is false on every pre-existing row.
 */
export function effectivePrevReading(
  prevRow: { meter_reading?: number | string | null; recorded_while_vacant?: boolean | null } | null | undefined,
  prevMonthCheckouts?: { meter_reading?: number | string | null }[] | null
): number | null {
  if (prevRow?.meter_reading == null) return null;
  const stored = Math.round(Number(prevRow.meter_reading));
  if (!prevRow.recorded_while_vacant) return stored;
  const readings = (prevMonthCheckouts ?? [])
    .map(r => (r.meter_reading != null ? Math.round(Number(r.meter_reading)) : null))
    .filter((v): v is number => v != null && Number.isFinite(v));
  return readings.length > 0 ? Math.max(stored, ...readings) : stored;
}

/**
 * The most recent reading STRICTLY BEFORE a given month, from rows already
 * fetched.
 *
 * The opening reading is normally looked up at exactly the previous month, and
 * that stays true for occupied rooms — six call sites depend on it, and
 * loosening it globally would turn a room last read three months ago into one
 * large catch-up bill on the next Apply.
 *
 * A vacant room is the case where that rule has nothing to offer: nobody was
 * there to be billed, so a month may legitimately have been skipped. This
 * fallback is therefore used ONLY on the vacant path, where no tenant is
 * charged and the sole purpose is keeping the meter chain unbroken for whoever
 * moves in next.
 */
export function latestReadingBefore(
  rows: { for_month: string; meter_reading: number | string | null }[] | null | undefined,
  beforeMonth: string
): number | null {
  const prior = (rows ?? [])
    .filter((r) => r.for_month < beforeMonth && r.meter_reading != null)
    .sort((a, b) => (a.for_month < b.for_month ? 1 : -1));
  return prior.length > 0 ? Number(prior[0].meter_reading) : null;
}
