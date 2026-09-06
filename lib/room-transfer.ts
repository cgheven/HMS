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
  /**
   * Rooms whose month-end units were ALREADY applied before this move, and whose
   * split is therefore now stale. Both ends go wrong, in opposite directions:
   *
   *   * the room LEFT re-cut the mover's share down to the moment they walked
   *     out, but the roommates who stayed keep the smaller share they were given
   *     while the mover was still counted — nobody is billed the difference;
   *   * the room JOINED split its month without the mover's arrival point, so
   *     they are carrying units burned before they got there.
   *
   * Neither shows up as an error: the room-left total simply falls short of its
   * meter, and the room-joined total still adds up. Re-applying both is the only
   * repair, and it is the caller's job because Apply is tier-specific.
   */
  reapply: { roomId: string; roomNumber: string; reading: number }[];
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
  // Kept on the result shape for callers, but nothing sets it any more: every
  // condition that used to warn now refuses outright, because each one left the
  // member's billing in a state the operator had no reachable way to correct.
  const warning: string | undefined = undefined;

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
    const [{ data: prevRow }, { data: thisMonthRow }, { data: prevCheckouts }, { data: roommates }, { data: joinRows }, { data: priorCheckouts }, { data: cfg }] =
      await Promise.all([
        adminDb.from("hms_room_ac_readings").select("meter_reading, recorded_while_vacant").eq("room_id", fromRoom.id).eq("hostel_id", hostelId).eq("for_month", prevMonth).maybeSingle(),
        adminDb.from("hms_room_ac_readings").select("meter_reading, total_units").eq("room_id", fromRoom.id).eq("hostel_id", hostelId).eq("for_month", forMonth).maybeSingle(),
        adminDb.from("hms_room_ac_checkout_readings").select("meter_reading").eq("room_id", fromRoom.id).eq("hostel_id", hostelId).eq("for_month", prevMonth),
        adminDb.from("hms_tenants").select("id, check_in, joining_meter_reading").eq("hostel_id", hostelId).eq("room_id", fromRoom.id).eq("is_active", true),
        adminDb.from("hms_room_ac_join_readings").select("tenant_id, units_at_join").eq("room_id", fromRoom.id).eq("hostel_id", hostelId).eq("for_month", forMonth),
        adminDb.from("hms_room_ac_checkout_readings").select("meter_reading, tenant_count_at_checkout, tenant_id").eq("room_id", fromRoom.id).eq("hostel_id", hostelId).eq("for_month", forMonth),
        adminDb.from("hms_package_configs").select("ac_per_unit_rate").eq("hostel_id", hostelId).maybeSingle(),
      ]);

    const perUnitRate = Number(cfg?.ac_per_unit_rate ?? 0);

    // Where this month started for THIS room, ranked exactly as checkout ranks it.
    //   1. last month's closing reading;
    //   2. the opening this month's own Apply already used, backed out of the row
    //      it saved (reading - units) — without this a transfer after a mid-month
    //      Apply re-derives a different opening and bills the same units twice;
    //   3. the earliest move-in reading among the room's tenants.
    //
    // Never 0. That fallback was silently catastrophic on exactly the branches
    // this feature was built for: the admission form only asks for a move-in
    // meter reading when the room is flagged has_ac, so on a meter-all-rooms
    // branch with no AC-flagged rooms — Continental, all three — no tenant ever
    // has one, step 3 always returns null, and a 0 baseline turns the meter's
    // absolute reading into one month's consumption. An 8,432 reading became a
    // six-figure charge written straight onto a member's bill with no preview.
    const storedPrev = effectivePrevReading(prevRow, prevCheckouts);
    const impliedFromThisMonth =
      thisMonthRow?.meter_reading != null && thisMonthRow?.total_units != null
        ? Math.round(Number(thisMonthRow.meter_reading)) - Math.round(Number(thisMonthRow.total_units))
        : null;
    const prevReading = storedPrev ?? impliedFromThisMonth ?? deriveOpeningReading(roommates ?? [], forMonth);

    if (prevReading == null) {
      throw new Error(
        `Room ${fromRoom.room_number} has no opening meter reading for this month, so there is nothing to ` +
        `measure the member's usage against. Record the room's reading on the AC Billing tab first, then move them.`
      );
    }

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
        tenant_id: c.tenant_id ?? null,
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
        // Refused, not warned. The old warning told the operator to finish the
        // job under "Mid-Month Joiners" — a box built from tenants whose
        // CHECK-IN month is the month on screen. A transfer never touches
        // check_in, so a member who joined in March and moves rooms in October
        // is never in that list and the instruction could not be followed. Left
        // unrecorded, the destination's Apply treats them as present from unit
        // zero and bills them for what was burned before they arrived — the
        // exact bug this feature exists to remove.
        //
        // Reachable on the simplest move of all: into an empty room, where there
        // are no roommates to derive an opening from and often no reading on
        // file. The operator is standing at that meter, so recording the room
        // first is a real one-time action, and the AC Billing tab has an Opening
        // box for precisely this.
        throw new Error(
          `Room ${toRoom.room_number} has no opening meter reading for this month, so the member's starting point ` +
          `there cannot be recorded. Record that room's reading on the AC Billing tab first, then move them — ` +
          `otherwise they would be billed for units used before they arrived.`
        );
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

  // Which of the two rooms already has this month's reading on file — see the
  // `reapply` note on RoomTransferResult.
  const reapply: { roomId: string; roomNumber: string; reading: number }[] = [];
  for (const room of [fromRoom, toRoom]) {
    if (!room) continue;
    const { data: rd } = await adminDb
      .from("hms_room_ac_readings")
      .select("meter_reading")
      .eq("hostel_id", hostelId).eq("room_id", room.id).eq("for_month", forMonth)
      .maybeSingle();
    if (rd?.meter_reading != null) {
      reapply.push({ roomId: room.id, roomNumber: room.room_number, reading: Math.round(Number(rd.meter_reading)) });
    }
  }

  return {
    fromRoomNumber: fromRoom?.room_number ?? null,
    toRoomNumber: toRoom.room_number,
    closedUnits,
    closedCharge,
    closedMeter: fromMetered && !!fromRoom,
    openedMeter: toMetered && !warning,
    reapply,
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

/** A move made this month that can still be corrected, with the two readings it was priced from. */
export interface CorrectableTransfer {
  fromRoomId: string;
  fromRoomNumber: string;
  toRoomId: string;
  toRoomNumber: string;
  /** What was typed at the time — what the operator needs to see to spot the slip. */
  fromRoomReading: number;
  toRoomReading: number | null;
  movedOn: string;
  billedUnits: number;
  billedCharge: number;
  /** The destination's month-end Apply has already run, so its split of that room
   *  was made against the OLD arrival point and has to be re-run afterwards. */
  destinationApplied: boolean;
  /** The reading that Apply used, so the caller can re-run it unattended. */
  destinationReading: number | null;
}

/**
 * The move a correction would act on, or null when there is nothing to correct.
 *
 * A mistyped meter reading used to be permanent. The panel prefilled both boxes
 * with each room's last recorded reading — the month's OPENING, never what the
 * meter says at the moment of the move — so pressing Save without touching them
 * closed the old room at zero units and opened the new one at offset zero. That
 * prefill is gone, but a slipped digit is still a slipped digit, and until now
 * the only repair was a hand-written SQL statement.
 *
 * Deliberately narrow. It finds ONLY the move whose destination is the room the
 * member is in right now, which is by construction their most recent one: an
 * earlier move in a chain (A->B->C) has its destination behind them, and
 * correcting it would silently invalidate every move computed on top of it.
 */
export async function findCorrectableTransfer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminDb: SupabaseClient<any, any, any>,
  hostelId: string,
  tenantId: string
): Promise<CorrectableTransfer | null> {
  const forMonth = pktTodayDateString().slice(0, 7);

  const { data: tenant } = await adminDb
    .from("hms_tenants")
    .select("id, room_id, is_active")
    .eq("id", tenantId)
    .eq("hostel_id", hostelId)
    .maybeSingle();
  // A member who has left cannot have their move corrected: the checkout priced
  // their final bill off the arrival point this would move.
  if (!tenant || !tenant.is_active || !tenant.room_id) return null;

  const { data: move } = await adminDb
    .from("hms_room_ac_checkout_readings")
    .select("room_id, meter_reading, units_consumed, ac_charge, checkout_date")
    .eq("hostel_id", hostelId)
    .eq("for_month", forMonth)
    .eq("tenant_id", tenantId)
    .eq("transferred_to_room_id", tenant.room_id)
    .maybeSingle();
  if (!move) return null;

  const [{ data: fromRoom }, { data: toRoom }, { data: joinRow }] = await Promise.all([
    adminDb.from("hms_rooms").select("id, room_number").eq("id", move.room_id).eq("hostel_id", hostelId).maybeSingle(),
    adminDb.from("hms_rooms").select("id, room_number").eq("id", tenant.room_id).eq("hostel_id", hostelId).maybeSingle(),
    adminDb.from("hms_room_ac_join_readings").select("units_at_join").eq("hostel_id", hostelId)
      .eq("room_id", tenant.room_id).eq("tenant_id", tenantId).eq("for_month", forMonth).maybeSingle(),
  ]);
  if (!fromRoom || !toRoom) return null;

  // units_at_join is an OFFSET from the destination's opening. The operator typed
  // an absolute meter reading, so turn it back into one or the box shows a number
  // they never entered.
  let toRoomReading: number | null = null;
  if (joinRow?.units_at_join != null) {
    const prevMonth = prevMonthOf(forMonth);
    const [{ data: prevRow }, { data: prevCheckouts }, { data: roommates }] = await Promise.all([
      adminDb.from("hms_room_ac_readings").select("meter_reading, recorded_while_vacant").eq("room_id", toRoom.id).eq("hostel_id", hostelId).eq("for_month", prevMonth).maybeSingle(),
      adminDb.from("hms_room_ac_checkout_readings").select("meter_reading").eq("room_id", toRoom.id).eq("hostel_id", hostelId).eq("for_month", prevMonth),
      adminDb.from("hms_tenants").select("id, check_in, joining_meter_reading").eq("hostel_id", hostelId).eq("room_id", toRoom.id).eq("is_active", true),
    ]);
    const opening = effectivePrevReading(prevRow, prevCheckouts) ?? deriveOpeningReading(roommates ?? [], forMonth);
    if (opening != null) toRoomReading = opening + Math.round(Number(joinRow.units_at_join));
  }

  const { data: destReading } = await adminDb
    .from("hms_room_ac_readings")
    .select("meter_reading")
    .eq("hostel_id", hostelId).eq("room_id", toRoom.id).eq("for_month", forMonth)
    .maybeSingle();

  return {
    fromRoomId: fromRoom.id,
    fromRoomNumber: fromRoom.room_number,
    toRoomId: toRoom.id,
    toRoomNumber: toRoom.room_number,
    fromRoomReading: Math.round(Number(move.meter_reading)),
    toRoomReading,
    movedOn: String(move.checkout_date),
    billedUnits: Number(move.units_consumed ?? 0),
    billedCharge: Number(move.ac_charge ?? 0),
    destinationApplied: destReading?.meter_reading != null,
    destinationReading: destReading?.meter_reading != null ? Math.round(Number(destReading.meter_reading)) : null,
  };
}

export interface RoomTransferCorrectionResult extends RoomTransferResult {
  previousUnits: number;
  previousCharge: number;
  /** See RoomTransferResult.reapply — inherited, and just as load-bearing here. */
}

/**
 * Re-price a move that was recorded with the wrong meter readings.
 *
 * Implemented as undo-then-redo rather than a second copy of the pricing, because
 * a second copy is exactly how the checkout estimate and the AC Units tab drifted
 * apart. performRoomTransfer is the one implementation that has been verified
 * against the meter; this puts the member back where they started and runs it
 * again with the corrected numbers.
 *
 * If the new readings are rejected — below the room's opening, below another
 * member's departure recorded since — the original move is put back before the
 * error is raised. A typo in the correction must not cost them the move itself.
 */
export async function correctRoomTransferReadings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminDb: SupabaseClient<any, any, any>,
  hostelId: string,
  input: { tenantId: string; fromRoomReading: number; toRoomReading?: number | null }
): Promise<RoomTransferCorrectionResult> {
  const forMonth = pktTodayDateString().slice(0, 7);
  const corr = await findCorrectableTransfer(adminDb, hostelId, input.tenantId);
  if (!corr) {
    throw new Error("There is no move from this month left to correct for this member.");
  }

  // Money already collected cannot be quietly re-cut. The charge for the room they
  // left sits on this bill; moving it after the member has paid against it turns a
  // settled row into one that disagrees with the cash in the drawer, with nothing
  // on screen to reconcile it.
  const payBefore = await readPayRow(adminDb, hostelId, forMonth, input.tenantId);
  if (payBefore && Number(payBefore.amount_paid ?? 0) > 0.009) {
    throw new Error(
      `This month's bill for the member already has ${Number(payBefore.amount_paid).toLocaleString()} collected against it, ` +
      `so the move's charge cannot be re-cut here. Undo the payment first, then correct the readings.`
    );
  }

  // Whatever the DESTINATION's own Apply has already put on this bill. Every
  // transfer row is a room the member has left, so what is left over after
  // subtracting all of them is the current room's share — and performRoomTransfer
  // overwrites ac_charge with (other rooms + this closing), which would erase it.
  const { data: allMoves } = await adminDb
    .from("hms_room_ac_checkout_readings")
    .select("ac_charge, units_consumed")
    .eq("hostel_id", hostelId).eq("for_month", forMonth).eq("tenant_id", input.tenantId)
    .not("transferred_to_room_id", "is", null);
  const movedCharge = (allMoves ?? []).reduce((s, r) => s + Number(r.ac_charge ?? 0), 0);
  const movedUnits = (allMoves ?? []).reduce((s, r) => s + Number(r.units_consumed ?? 0), 0);
  const destOwnCharge = Math.max(0, Number(payBefore?.ac_charge ?? 0) - movedCharge);
  const destOwnUnits = Math.max(0, Number(payBefore?.ac_units_consumed ?? 0) - movedUnits);

  const undo = async () => {
    await adminDb.from("hms_room_ac_checkout_readings").delete()
      .eq("hostel_id", hostelId).eq("room_id", corr.fromRoomId)
      .eq("tenant_id", input.tenantId).eq("for_month", forMonth);
    await adminDb.from("hms_room_ac_join_readings").delete()
      .eq("hostel_id", hostelId).eq("room_id", corr.toRoomId)
      .eq("tenant_id", input.tenantId).eq("for_month", forMonth);
    const { error } = await adminDb.from("hms_tenants")
      .update({ room_id: corr.fromRoomId }).eq("id", input.tenantId).eq("hostel_id", hostelId);
    if (error) throw new Error("Could not put the member back in the room they moved from.");
  };

  await undo();

  let result: RoomTransferResult;
  try {
    result = await performRoomTransfer(adminDb, hostelId, {
      tenantId: input.tenantId,
      toRoomId: corr.toRoomId,
      fromRoomReading: input.fromRoomReading,
      toRoomReading: input.toRoomReading,
    });
  } catch (e) {
    // Put the move back exactly as it was, using the same path that made it.
    try {
      await undo();
      await performRoomTransfer(adminDb, hostelId, {
        tenantId: input.tenantId,
        toRoomId: corr.toRoomId,
        fromRoomReading: corr.fromRoomReading,
        toRoomReading: corr.toRoomReading,
      });
    } catch {
      throw new Error(
        `${e instanceof Error ? e.message : String(e)} — and the original move could not be restored. ` +
        `Move the member back to room ${corr.fromRoomNumber} and re-enter it: ` +
        `room ${corr.fromRoomNumber} at ${corr.fromRoomReading}, room ${corr.toRoomNumber} at ${corr.toRoomReading ?? "?"}.`
      );
    }
    throw e;
  }

  // Hand the destination's own applied share back. It is stale — the split was
  // made against the arrival point that just moved — but dropping it silently
  // would be worse than keeping it until the room is re-applied, which the caller
  // is told to do.
  if (destOwnCharge > 0 || destOwnUnits > 0) {
    const payAfter = await readPayRow(adminDb, hostelId, forMonth, input.tenantId);
    if (payAfter) {
      const nextCharge = Number(payAfter.ac_charge ?? 0) + destOwnCharge;
      await adminDb.from("hms_payments").update({
        ac_charge: nextCharge,
        ac_units_consumed: round2(Number(payAfter.ac_units_consumed ?? 0) + destOwnUnits),
        amount: Math.max(0, Number(payAfter.amount ?? 0) - Number(payAfter.ac_charge ?? 0) + nextCharge),
        updated_at: new Date().toISOString(),
      }).eq("id", payAfter.id);
    }
  }

  return {
    ...result,
    previousUnits: corr.billedUnits,
    previousCharge: corr.billedCharge,
  };
}
