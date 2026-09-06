import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeACSegmentBilling, deriveOpeningReading, effectivePrevReading, round2 } from "@/lib/ac-billing";
import { carriedTransferCharges } from "@/lib/ac-transfer";
import { pktTodayDateString } from "@/lib/pkt-time";
import { ensureMonthlyPaymentRows } from "@/lib/monthly-payment-sync";

export interface RoomTransferInput {
  tenantId: string;
  toRoomId: string;
  /** Meter reading on the room being LEFT, at the moment of the move. Required
   *  only when that room is metered. */
  fromRoomReading?: number | null;
  /** Meter reading on the room being JOINED, at the moment of the move. Required
   *  only when that room is metered. */
  toRoomReading?: number | null;
}

export interface RoomTransferResult {
  fromRoomNumber: string | null;
  toRoomNumber: string;
  /** Units the tenant is being billed for in the room they left, this month. */
  closedUnits: number;
  closedCharge: number;
  /** True when the room being left is metered and a closing reading was recorded. */
  closedMeter: boolean;
  /** True when the room being joined is metered and an opening breakpoint was recorded. */
  openedMeter: boolean;
  warning?: string;
}

/** A room is metered when it has AC, or when the branch meters every room. */
export function isMeteredRoom(room: { has_ac: boolean } | null, meterAllRooms: boolean): boolean {
  if (!room) return false;
  return room.has_ac || meterAllRooms;
}

/**
 * Move a tenant from one room to another, settling the electricity meter on both
 * sides of the move.
 *
 * Changing room_id on its own is enough for a room nobody meters, and that is all
 * this used to do. For a metered room it is wrong in both directions at once:
 *
 *   * the room they LEFT loses them from its tenant list the instant room_id
 *     changes, so its month-end Apply cannot see that they were ever there — their
 *     real consumption is either written off as an empty room or pushed onto the
 *     roommates who stayed;
 *
 *   * the room they JOINED sees them with their ORIGINAL hostel check-in date, which
 *     is always in the past, so the segment engine treats them as present since the
 *     1st and bills them for units burned before they arrived.
 *
 * Both are fixed with the two breakpoints the engine already understands: a closing
 * reading on the old room (the same shape a checkout writes) and an opening reading
 * on the new one (the same shape a mid-month admission writes). The tenant's share
 * of the old room is charged here and now — nothing else ever will, because they
 * are about to disappear from that room's tenant list — and carriedTransferCharges
 * keeps that share alive against every later writer of the same payment row.
 */
export async function performRoomTransfer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminDb: SupabaseClient<any, any, any>,
  hostelId: string,
  input: RoomTransferInput
): Promise<RoomTransferResult> {
  const today = pktTodayDateString();
  const forMonth = today.slice(0, 7);

  const { data: tenant, error: tErr } = await adminDb
    .from("hms_tenants")
    .select("id, full_name, room_id, is_active, check_in, joining_meter_reading")
    .eq("id", input.tenantId)
    .eq("hostel_id", hostelId)
    .single();
  if (tErr || !tenant) throw new Error("Member not found in this branch.");
  if (!tenant.is_active) throw new Error("This member is not active.");
  if (tenant.room_id === input.toRoomId) throw new Error("That is the room they are already in.");

  const [{ data: toRoom }, { data: fromRoom }, { data: hostel }] = await Promise.all([
    adminDb.from("hms_rooms").select("id, room_number, has_ac, capacity").eq("id", input.toRoomId).eq("hostel_id", hostelId).maybeSingle(),
    tenant.room_id
      ? adminDb.from("hms_rooms").select("id, room_number, has_ac").eq("id", tenant.room_id).eq("hostel_id", hostelId).maybeSingle()
      : Promise.resolve({ data: null }),
    adminDb.from("hms_hostels").select("meter_all_rooms").eq("id", hostelId).single(),
  ]);
  if (!toRoom) throw new Error("Destination room not found in this branch.");

  const meterAll = !!hostel?.meter_all_rooms;
  const fromMetered = isMeteredRoom(fromRoom, meterAll);
  const toMetered = isMeteredRoom(toRoom, meterAll);

  // Capacity is a real operational limit, not advisory — two people cannot share
  // one bed. Counted fresh rather than trusted from rooms.occupied, which is a
  // cached column the transfer itself is about to correct.
  const { count: toOccupied } = await adminDb
    .from("hms_tenants")
    .select("id", { count: "exact", head: true })
    .eq("hostel_id", hostelId)
    .eq("room_id", input.toRoomId)
    .eq("is_active", true);
  if ((toOccupied ?? 0) >= Number(toRoom.capacity ?? 0)) {
    throw new Error(
      `Room ${toRoom.room_number} is full — ${toOccupied} of ${toRoom.capacity} beds taken. ` +
      `Free a bed or raise the room's capacity first.`
    );
  }

  // Moving back into a room they already left THIS month cannot be represented.
  // The engine takes one closing reading per room, month and tenant, so a second
  // stay has nowhere to live — and the first stay's closing row would then sit
  // against a tenant the room also counts as present, reserving units for a
  // phantom departure and quietly under-billing the room by that share
  // (16.67 of 100 units in the two-tenant case).
  //
  // Refused rather than half-modelled. The panel shows exactly what a move will
  // do before it is saved, so a misclick is caught there; a genuine return is
  // rare and can be recorded next month, when the room's meter starts fresh.
  const { data: alreadyLeft } = await adminDb
    .from("hms_room_ac_checkout_readings")
    .select("meter_reading")
    .eq("hostel_id", hostelId)
    .eq("room_id", input.toRoomId)
    .eq("tenant_id", input.tenantId)
    .eq("for_month", forMonth)
    .maybeSingle();
  if (alreadyLeft) {
    throw new Error(
      `${tenant.full_name} already moved out of room ${toRoom.room_number} earlier this month, and that stay is ` +
      `billed up to meter ${Math.round(Number(alreadyLeft.meter_reading))}. Moving back into the same room within ` +
      `the same month cannot be billed correctly — pick a different room, or move them back at the start of next month.`
    );
  }

  let closedUnits = 0;
  let closedCharge = 0;
  let warning: string | undefined;

  // These writes happen before the move itself, and there is no transaction
  // across them. A failure after either one — most reachably the pricing
  // trigger rejecting the payment update — would leave the member still in the
  // old room while that room carries a departure row for them. The room's
  // month-end Apply would then count them BOTH as present and as departed,
  // reserving units for a departure that never happened. That is exactly the
  // state alreadyLeft refuses to create on purpose, so it must not be created
  // by accident either: anything written is undone before the error is rethrown.
  const writtenClosing: string[] = [];
  const writtenJoin: string[] = [];
  const undoPartialWrites = async () => {
    for (const rid of writtenClosing) {
      await adminDb.from("hms_room_ac_checkout_readings").delete()
        .eq("hostel_id", hostelId).eq("room_id", rid)
        .eq("tenant_id", input.tenantId).eq("for_month", forMonth);
    }
    for (const rid of writtenJoin) {
      await adminDb.from("hms_room_ac_join_readings").delete()
        .eq("hostel_id", hostelId).eq("room_id", rid)
        .eq("tenant_id", input.tenantId).eq("for_month", forMonth);
    }
  };

  // ── The room being LEFT: close the meter on this tenant ──────────────
  if (fromMetered && fromRoom) {
    if (input.fromRoomReading == null || !Number.isFinite(Number(input.fromRoomReading))) {
      throw new Error(`Enter the meter reading for room ${fromRoom.room_number} as it stands now — the member is billed for what they used there.`);
    }
    const reading = Math.round(Number(input.fromRoomReading));
    if (reading < 0 || reading > 999_999) throw new Error("Meter reading must be between 0 and 999,999.");

    const prevMonth = prevMonthOf(forMonth);
    const [{ data: prevRow }, { data: prevCheckouts }, { data: roommates }, { data: joinRows }, { data: priorCheckouts }, { data: cfg }] =
      await Promise.all([
        adminDb.from("hms_room_ac_readings").select("meter_reading, recorded_while_vacant").eq("room_id", fromRoom.id).eq("hostel_id", hostelId).eq("for_month", prevMonth).maybeSingle(),
        adminDb.from("hms_room_ac_checkout_readings").select("meter_reading").eq("room_id", fromRoom.id).eq("hostel_id", hostelId).eq("for_month", prevMonth),
        adminDb.from("hms_tenants").select("id, check_in, joining_meter_reading").eq("hostel_id", hostelId).eq("room_id", fromRoom.id).eq("is_active", true),
        adminDb.from("hms_room_ac_join_readings").select("tenant_id, units_at_join").eq("room_id", fromRoom.id).eq("hostel_id", hostelId).eq("for_month", forMonth),
        adminDb.from("hms_room_ac_checkout_readings").select("meter_reading, tenant_count_at_checkout").eq("room_id", fromRoom.id).eq("hostel_id", hostelId).eq("for_month", forMonth),
        adminDb.from("hms_package_configs").select("ac_per_unit_rate").eq("hostel_id", hostelId).maybeSingle(),
      ]);

    const perUnitRate = Number(cfg?.ac_per_unit_rate ?? 0);
    const storedPrev = effectivePrevReading(prevRow, prevCheckouts);
    const prevReading = storedPrev != null
      ? storedPrev
      : (deriveOpeningReading(roommates ?? [], forMonth) ?? 0);

    if (reading < prevReading) {
      throw new Error(
        `Meter reading ${reading} for room ${fromRoom.room_number} is below where the month opened (${prevReading}). ` +
        `Check the number — a meter cannot run backwards.`
      );
    }
    // Someone else may already have left this room this month at a higher
    // reading. Caught here, in the operator's own terms — the billing engine
    // rejects it too, but phrased as a "month-end reading" problem, which is
    // not what the person standing at the meter is doing.
    const highestPrior = (priorCheckouts ?? []).reduce(
      (mx, c) => Math.max(mx, Math.round(Number(c.meter_reading))), 0
    );
    if (highestPrior > 0 && reading < highestPrior) {
      throw new Error(
        `Meter reading ${reading} for room ${fromRoom.room_number} is below ${highestPrior}, which was already ` +
        `recorded there earlier this month when another member moved or checked out. Check the number.`
      );
    }

    const units = reading - prevReading;
    // The tenant is still is_active and still in this room at this point, so they
    // are inside `eligible` — exactly the posture checkout computes from.
    const { tenantBilling } = computeACSegmentBilling({
      eligible: (roommates ?? []).map(t => ({
        id: t.id as string,
        check_in: t.check_in as string,
        joining_meter_reading: t.joining_meter_reading != null ? Number(t.joining_meter_reading) : null,
      })),
      prevReading,
      reading,
      units,
      perUnitRate,
      forMonth,
      joinReadingsRaw: (joinRows ?? []).map(j => ({ tenant_id: j.tenant_id as string, units_at_join: Number(j.units_at_join) })),
      checkoutReadingsRaw: (priorCheckouts ?? []).map(c => ({
        meter_reading: Number(c.meter_reading),
        tenant_count_at_checkout: Number(c.tenant_count_at_checkout),
      })),
    });

    const mine = tenantBilling.find(r => r.id === input.tenantId);
    closedUnits = round2(mine?.tenantUnits ?? 0);
    closedCharge = mine?.charge ?? 0;

    const { error: brErr } = await adminDb.from("hms_room_ac_checkout_readings").upsert(
      {
        hostel_id: hostelId,
        room_id: fromRoom.id,
        tenant_id: input.tenantId,
        for_month: forMonth,
        meter_reading: reading,
        units_consumed: closedUnits,
        tenant_count_at_checkout: (roommates ?? []).length + (priorCheckouts ?? []).length,
        ac_charge: closedCharge,
        checkout_date: today,
        // What makes this a MOVE and not a departure — see migration 215.
        transferred_to_room_id: input.toRoomId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "room_id,for_month,tenant_id" }
    );
    if (brErr) throw new Error(`Could not record the closing meter reading: ${brErr.message}`);
    writtenClosing.push(fromRoom.id);

  // Everything from here on can fail — a missing or impossible destination
  // reading, the pricing trigger rejecting the charge, a dropped connection.
  // The closing reading above is already written, so any failure past this
  // point must undo it: a departure row left on a room the member never left
  // makes that room's month-end Apply count them both as present and as gone,
  // reserving units for a departure that did not happen and silently
  // under-billing the room. Round 1 wrapped only the charge and the move; the
  // destination-reading rejections sat outside it and leaked exactly that.
  }

  try {
    // ── The room being JOINED: open the meter for this tenant ────────────
    if (toMetered) {
      if (input.toRoomReading == null || !Number.isFinite(Number(input.toRoomReading))) {
        throw new Error(`Enter the meter reading for room ${toRoom.room_number} as it stands now — it is where the member's billing there starts.`);
      }
      const reading = Math.round(Number(input.toRoomReading));
      if (reading < 0 || reading > 999_999) throw new Error("Meter reading must be between 0 and 999,999.");

      const prevMonth = prevMonthOf(forMonth);
      const [{ data: prevRow }, { data: prevCheckouts }, { data: roommates }] = await Promise.all([
        adminDb.from("hms_room_ac_readings").select("meter_reading, recorded_while_vacant").eq("room_id", toRoom.id).eq("hostel_id", hostelId).eq("for_month", prevMonth).maybeSingle(),
        adminDb.from("hms_room_ac_checkout_readings").select("meter_reading").eq("room_id", toRoom.id).eq("hostel_id", hostelId).eq("for_month", prevMonth),
        adminDb.from("hms_tenants").select("id, check_in, joining_meter_reading").eq("hostel_id", hostelId).eq("room_id", toRoom.id).eq("is_active", true),
      ]);

      const storedPrev = effectivePrevReading(prevRow, prevCheckouts);
      const opening = storedPrev != null
        ? storedPrev
        : deriveOpeningReading(roommates ?? [], forMonth);

      if (opening == null) {
        // No baseline exists for the destination yet, so an offset cannot be
        // computed. Recording nothing is the honest outcome: the month's first
        // Apply establishes the opening, and the operator can enter this tenant
        // under Mid-Month Joiners then. Said out loud rather than swallowed.
        warning =
          `Room ${toRoom.room_number} has no earlier meter reading, so the member's starting point there could not be ` +
          `recorded automatically. Enter them under "Mid-Month Joiners" on the AC Billing tab when you apply this month's units.`;
      } else if (reading < opening) {
        throw new Error(
          `Meter reading ${reading} for room ${toRoom.room_number} is below where the month opened (${opening}). ` +
          `Check the number — a meter cannot run backwards.`
        );
      } else {
        // units_at_join is an OFFSET from the month's opening, the same shape the
        // Mid-Month Joiners box stores, so the engine needs no new concept.
        const { error: jErr } = await adminDb.from("hms_room_ac_join_readings").upsert(
          {
            hostel_id: hostelId,
            room_id: toRoom.id,
            tenant_id: input.tenantId,
            for_month: forMonth,
            units_at_join: Math.max(0, reading - opening),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "room_id,for_month,tenant_id" }
        );
        if (jErr) {
          await undoPartialWrites();
          throw new Error(`Could not record the opening meter reading: ${jErr.message}`);
        }
        writtenJoin.push(toRoom.id);
      }
    }

    // ── Charge the room they left, on this month's bill ──────────────────
    // Only this path will ever bill it: the moment room_id changes below, that
    // room's month-end Apply can no longer see this tenant.
    if (closedCharge > 0 || closedUnits > 0) {
      let payRow = await readPayRow(adminDb, hostelId, forMonth, input.tenantId);

      // No row for this month yet — early in the month, or a member admitted days
      // ago before anything created one. Relying on a later Apply to pick the
      // charge up only works if the DESTINATION is metered and someone presses
      // Apply for it; move to a non-metered room and the charge is simply lost.
      // Create the row the same way both Apply paths self-heal a missing one.
      if (!payRow) {
        await ensureMonthlyPaymentRows(adminDb, hostelId, forMonth);
        payRow = await readPayRow(adminDb, hostelId, forMonth, input.tenantId);
      }

      if (payRow) {
        // Whatever this row already carries for THIS month splits into two parts:
        // what earlier moves left behind (which stands), and what the room being
        // left had already applied (which this closing reading supersedes — same
        // window, later reading). Recomputing rather than adding keeps a repeated
        // or corrected transfer from stacking charges.
        const carried = await carriedTransferCharges(adminDb, hostelId, forMonth, fromRoom?.id ?? null, [input.tenantId]);
        const priorCarriedCharge = carried.get(input.tenantId)?.charge ?? 0;
        const priorCarriedUnits = carried.get(input.tenantId)?.units ?? 0;
        const nextAcCharge = priorCarriedCharge + closedCharge;

        const { error: payErr } = await adminDb
          .from("hms_payments")
          .update({
            ac_charge: nextAcCharge,
            ac_units_consumed: round2(priorCarriedUnits + closedUnits),
            // Sent explicitly, exactly as checkout does. A MONTHLY row ignores it
            // (the trigger rebuilds from monthly_rent), but a DAILY row keeps the
            // app-supplied amount and derives rent by SUBTRACTING the charges from
            // it — so leaving it out makes the trigger read the new AC charge as
            // eating the rent, and it raises "payment amount is less than the sum
            // of add-on charges" the moment the charge exceeds a few nights' rent.
            amount: Math.max(0, Number(payRow.amount ?? 0) - Number(payRow.ac_charge ?? 0) + nextAcCharge),
            updated_at: new Date().toISOString(),
          })
          .eq("id", payRow.id);
        if (payErr) throw new Error(`Could not bill the member for the room they left: ${payErr.message}`);

        // A bill already settled before the move is now short by this charge. Left
        // as 'paid' the balance is invisible: the Payments page shows it collected,
        // "Collect Rest" never appears, and Total Due stops equalling Collected +
        // Pending. Both Apply paths demote for exactly this reason. Demote only,
        // never promote — closing a partially paid bill is the owner's call.
        const after = await readPayRow(adminDb, hostelId, forMonth, input.tenantId);
        if (
          after && after.status === "paid" && after.amount_paid != null &&
          Number(after.amount) + Number(after.late_fee ?? 0) - Number(after.amount_paid) > 0.01
        ) {
          await adminDb
            .from("hms_payments")
            .update({ status: "partially_paid", updated_at: new Date().toISOString() })
            .eq("id", after.id);
        }
      }
    }

    // ── The move itself ──────────────────────────────────────────────────
    const { error: moveErr } = await adminDb
      .from("hms_tenants")
      .update({ room_id: input.toRoomId })
      .eq("id", input.tenantId)
      .eq("hostel_id", hostelId);
    if (moveErr) throw new Error("Could not move the member to the new room.");

  } catch (e) {
    // The member has not moved, so nothing may be left claiming they did.
    await undoPartialWrites();
    throw e;
  }

  // Occupancy counts on both rooms, recounted from truth rather than adjusted.
  for (const rid of [fromRoom?.id, toRoom.id].filter(Boolean) as string[]) {
    const { count } = await adminDb
      .from("hms_tenants")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId)
      .eq("room_id", rid)
      .eq("is_active", true);
    const { data: r } = await adminDb.from("hms_rooms").select("capacity").eq("id", rid).maybeSingle();
    await adminDb
      .from("hms_rooms")
      .update({
        occupied: count ?? 0,
        status: (count ?? 0) >= Number(r?.capacity ?? 0) ? "occupied" : "available",
        updated_at: new Date().toISOString(),
      })
      .eq("id", rid);
  }

  return {
    fromRoomNumber: fromRoom?.room_number ?? null,
    toRoomNumber: toRoom.room_number,
    closedUnits,
    closedCharge,
    closedMeter: fromMetered && !!fromRoom,
    openedMeter: toMetered && !warning,
    warning,
  };
}

async function readPayRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminDb: SupabaseClient<any, any, any>,
  hostelId: string,
  forMonth: string,
  tenantId: string
) {
  const { data } = await adminDb
    .from("hms_payments")
    .select("id, ac_charge, ac_units_consumed, status, amount, late_fee, amount_paid")
    .eq("tenant_id", tenantId)
    .eq("hostel_id", hostelId)
    .eq("for_month", forMonth)
    .maybeSingle();
  return data;
}

function prevMonthOf(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
