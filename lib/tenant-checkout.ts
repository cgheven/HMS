import "server-only";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcDailyRent, countBillableNights, daysInMonth, proRateMonthlyRent } from "@/lib/daily-billing";
import { computeACSegmentBilling, deriveOpeningReading, round2 } from "@/lib/ac-billing";
import { clampGrossToCollected } from "@/lib/payment-calc";
import { voidReferralRewardsForTenant } from "@/lib/referral-rewards";
import { mintFeedbackToken } from "@/lib/tenant-feedback";
import { sendCheckoutMessage } from "@/lib/whatsapp-checkout";
import type { PaymentMethod, PaymentStatus, CheckoutInput, CheckoutSettlement } from "@/types";

// Deliberately no "use server" directive — every export from a "use server" file
// becomes a client-callable RPC, so this shared checkout core lives in a plain
// module. It takes hostelId as a caller-verified argument; both the owner action
// (checkoutTenantAction) and the partner action (checkoutTenantAsPartner) resolve
// hostelId themselves via their own guard before calling in.

/** "2026-08" -> "2026-09". String arithmetic on purpose: Date would drag the
 *  server's timezone into a value that is already a plain Pakistan-local month. */
function nextMonthAfter(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function genReceiptNumber(tenantName: string, month: string): string {
  const initials = tenantName.split(" ").map((w: string) => w[0] ?? "").join("").toUpperCase().slice(0, 2);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `HMS-${month.replace("-", "")}-${initials}-${rand}`;
}

export async function performTenantCheckout(
  hostelId: string,
  input: CheckoutInput
): Promise<{ success: boolean; error?: string; warning?: string; settlement?: CheckoutSettlement }> {
  try {
    const adminDb = createAdminClient();
    let repriceWarning: string | undefined;

    // Step 1: Fetch and verify tenant belongs to this hostel and is still active
    const { data: tenant, error: tenantErr } = await adminDb
      .from("hms_tenants")
      .select("id, full_name, hostel_id, room_id, is_active, check_in, security_deposit, joining_meter_reading, billing_type, daily_rate, monthly_rent")
      .eq("id", input.tenantId)
      .eq("hostel_id", hostelId)
      .single();

    if (tenantErr || !tenant) throw new Error("Tenant not found or access denied");
    if (!tenant.is_active) throw new Error("Tenant is already checked out");

    // SEC-F1: Validate checkoutDate server-side
    if (!input.checkoutDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.checkoutDate)) {
      throw new Error("Invalid checkout date format");
    }
    const checkoutDateObj = new Date(input.checkoutDate + "T00:00:00");
    if (isNaN(checkoutDateObj.getTime())) {
      throw new Error("Invalid checkout date");
    }
    const checkinStr = tenant.check_in as string | null;
    if (checkinStr && input.checkoutDate < checkinStr.slice(0, 10)) {
      throw new Error("Checkout date cannot be before the tenant's check-in date");
    }
    const maxFuture = new Date();
    maxFuture.setDate(maxFuture.getDate() + 7);
    if (checkoutDateObj > maxFuture) {
      throw new Error("Checkout date cannot be more than 7 days in the future");
    }

    // Step 2: Verify payment belongs to this tenant and hostel (prevents IDOR)
    let paymentAlreadySettled = false;
    let verifiedPayment: { id: string; tenant_id: string; hostel_id: string; status: string; for_month: string; amount: number | null; late_fee: number | null; amount_paid: number | null; ac_charge: number | null } | null = null;
    if (input.paymentSettlement) {
      // SEC-F4: Runtime action validation — TypeScript enums are erased at runtime
      if (!new Set(["pay", "waive"]).has(input.paymentSettlement.action as string)) {
        throw new Error("Invalid payment action");
      }

      const { data: payment, error: payErr } = await adminDb
        .from("hms_payments")
        .select("id, tenant_id, hostel_id, status, for_month, amount, late_fee, amount_paid, ac_charge")
        .eq("id", input.paymentSettlement.paymentId)
        .eq("tenant_id", input.tenantId)
        .eq("hostel_id", hostelId)
        .single();

      if (payErr || !payment) throw new Error("Payment not found or access denied");
      verifiedPayment = payment;

      // SEC-F2: EC-4 idempotent retry — if payment is already in the target state, skip the
      // update rather than throwing. This makes the action safe to retry in-place when tenant
      // deactivation failed after payment was already recorded.
      const { action } = input.paymentSettlement;
      paymentAlreadySettled =
        (action === "pay" && payment.status === "paid") ||
        (action === "waive" && payment.status === "waived");

      // partially_paid is a genuine outstanding balance too (e.g. AC billed
      // after an advance rent payment already settled the rest) — the same
      // reasoning the base-rent re-price step below already applies.
      if (!paymentAlreadySettled && !["pending", "overdue", "partially_paid"].includes(payment.status)) {
        throw new Error("Payment has already been settled");
      }
    }

    // Step 2b: Re-price the checkout month's BASE RENT now that the real leaving
    // date is known. This has to happen before the settlement math below, or the
    // operator collects the pre-correction figure at the door.
    //
    // Daily tenants: a stay with no check_out was billed to month-end, because
    // every remaining night was assumed slept. It no longer is, so the month is
    // re-counted in nights (lib/daily-billing.ts owns that arithmetic).
    // Monthly tenants: untouched unless the owner explicitly opts into RULE 2
    // pro-rating. Absent that flag this whole block is a no-op for them.
    const billingType = (tenant.billing_type as string | null) ?? "monthly";
    const isDaily = billingType === "daily";
    const proRateMonthly = !isDaily && input.proRateFinalMonth === true;

    if ((isDaily || proRateMonthly) && checkinStr) {
      const rentMonth = input.checkoutDate.substring(0, 7);

      const { data: monthRow } = await adminDb
        .from("hms_payments")
        .select("id, status, amount, amount_paid, food_charge, ac_charge, security_deposit_charge, registration_fee_charge, ac_maintenance_charge, referral_discount, referral_percent")
        .eq("tenant_id", input.tenantId)
        .eq("hostel_id", hostelId)
        .eq("for_month", rentMonth)
        .maybeSingle();

      // Settled money is never rewritten by a recompute. The sole exception is
      // the row this checkout is settling right now — and only when it has not
      // ALREADY been collected. Steps 2's idempotent-retry path deliberately
      // admits an already-paid/waived verifiedPayment so the action can be retried
      // in place; on that path the row is settled money and re-pricing it would
      // leave amount_paid stranded above the new amount (Step 3 is skipped), i.e.
      // a row that reads as overpaid. Re-pricing already-collected money is never
      // correct.
      // partially_paid belongs here too: it is genuinely uncollected money, and
      // omitting it left the commonest real case — a daily tenant who paid part
      // of the month, then left early — permanently billed for nights after
      // their actual departure, which is the exact over-billing this recompute
      // exists to remove.
      const settleable =
        !!monthRow &&
        (["pending", "overdue", "partially_paid"].includes(monthRow.status) ||
          (!paymentAlreadySettled && monthRow.id === verifiedPayment?.id));

      if (monthRow && settleable) {
        const checkIn = checkinStr.slice(0, 10);
        const nights = countBillableNights({
          checkIn,
          checkOut: input.checkoutDate,
          month: rentMonth,
        });
        const dailyRate = Number(tenant.daily_rate ?? 0);

        // A tenant who slept every night of the month is not a partial stay, so
        // the /30 divisor must not discount them. The dialog already blocks this,
        // but proRateFinalMonth is a client-supplied flag on a directly-callable
        // server action and cannot be trusted on its own.
        const newBaseRent = isDaily
          ? calcDailyRent({ checkIn, checkOut: input.checkoutDate, month: rentMonth, dailyRate })
          : nights >= daysInMonth(rentMonth)
          ? Number(tenant.monthly_rent ?? 0)
          : proRateMonthlyRent({
              monthlyRent: Number(tenant.monthly_rent ?? 0),
              checkIn,
              checkOut: input.checkoutDate,
              month: rentMonth,
            });

        // Only the rent component moves. Food, AC, deposit, registration fee and
        // AC maintenance all ride along at face value — they are not day-scaled,
        // and the DB trigger re-derives food/AC-maintenance from the package
        // config anyway. Registration fee and AC maintenance MUST be included
        // here even though the trigger doesn't change `amount` for daily tenants
        // (it only validates amount >= the sum of these charges) — omitting them
        // would silently drop both from the persisted total, or throw if the
        // pro-rated rent is smaller than what was omitted.
        //
        // How the new rent reaches the row depends on who owns `amount`. The
        // migration-082 trigger recomputes amount from hms_tenants.monthly_rent
        // for MONTHLY tenants, so writing a pro-rated `amount` here is reverted
        // inside the same statement; the pro-rated figure has to go through
        // base_rent_override (migration 099) and let the trigger derive amount.
        // For DAILY tenants the trigger preserves the app-supplied amount, so
        // that path still writes `amount` directly.
        // Never re-price BELOW what has already been collected — a partially_paid
        // row re-priced under its amount_paid would read as overpaid, and this
        // action has no refund path. When the correct figure really is lower, we
        // hold the row at amount_paid and let the operator handle the difference
        // as a refund rather than silently inventing a credit.
        const alreadyPaid = Number(monthRow.amount_paid ?? 0);
        const extras =
          Number(monthRow.food_charge ?? 0) +
          Number(monthRow.ac_charge ?? 0) +
          Number(monthRow.security_deposit_charge ?? 0) +
          Number(monthRow.registration_fee_charge ?? 0) +
          Number(monthRow.ac_maintenance_charge ?? 0);
        // Solved in NET space. amount_paid is what was actually collected, and a
        // discounted row stores amount net of the discount, so comparing a gross
        // total against amount_paid clears the check while the stored net still
        // lands under it. The percent (not the rupees) is what the trigger pins
        // on a collected row, so the discount scales with the pro-rated rent
        // instead of handing back a full month's discount on a four-night stay.
        const referralPercent = Number(monthRow.referral_percent ?? 0);
        const proposedTotal = newBaseRent + extras;
        const { gross: clampedTotal, clamped, satisfiable } = clampGrossToCollected(
          newBaseRent, extras, referralPercent, alreadyPaid
        );
        if (clamped) {
          repriceWarning = satisfiable
            ? `The final month re-prices to ${proposedTotal.toLocaleString()} but ` +
              `${alreadyPaid.toLocaleString()} has already been collected. The bill was held at ` +
              `the amount already paid — refund the difference manually if one is due.`
            : `The final month cannot be re-priced above the ${alreadyPaid.toLocaleString()} ` +
              `already collected while a ${referralPercent}% referral discount applies. ` +
              `Refund the difference manually.`;
        }

        const repriceFields = isDaily
          // referral_discount: 0 marks clampedTotal as GROSS — the trigger stores
          // amount net of the discount it re-derives.
          ? { amount: clampedTotal, referral_discount: 0 }
          : { base_rent_override: clampedTotal - extras };

        const { data: repriced, error: repriceErr } = await adminDb
          .from("hms_payments")
          .update({
            ...repriceFields,
            billed_days: nights,
            daily_rate_billed: isDaily ? dailyRate : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", monthRow.id)
          .eq("hostel_id", hostelId)
          .select("amount, referral_discount")
          .single();

        if (repriceErr || !repriced) {
          throw new Error("Failed to re-price the final month. Please try again.");
        }

        // Read the amount back rather than assuming it: the trigger is the
        // authority on this column (it re-derives food from the package config
        // and, for monthly, rebuilds the total from base_rent_override). Using
        // the returned value keeps grossDue and amount_paid below in exact step
        // with what the row actually bills.
        if (verifiedPayment && verifiedPayment.id === monthRow.id) {
          verifiedPayment = { ...verifiedPayment, amount: Number(repriced.amount ?? 0) };
        }
      }
    }

    // Set when Step 3a pulls in an AC-only charge the dialog never had a chance to show.
    let adoptedACOnlyPayment = false;

    // Step 3a: AC checkout billing — compute partial AC charge if meter reading provided.
    // Runs before payment settlement so the charge is included in the payment being settled.
    let acCheckoutRecord: {
      units_consumed: number;
      tenant_count: number;
      ac_charge: number;
      prevReading: number;
      tenant_unit_share: number;
    } | null = null;

    // The departure breakpoint, persisted whenever a reading is supplied for an
    // AC room — deliberately SEPARATE from acCheckoutRecord, which only exists
    // when a fresh charge is actually computed. When the meter hasn't moved past
    // what the AC Units tab already applied we reuse that existing charge rather
    // than recomputing (see hasNewerReading below), and the breakpoint would
    // otherwise never get written: month-end re-billing then has no record that
    // this tenant left partway, so the REMAINING tenants silently absorb a share
    // this tenant already paid for at the door, and the room is billed twice.
    let acBreakpoint: {
      meter_reading: number;
      units_consumed: number;
      tenant_count: number;
      ac_charge: number;
    } | null = null;

    if (input.acCheckoutReading !== undefined && tenant.room_id) {
      const checkoutMonth = input.checkoutDate.substring(0, 7);
      const [cy, cm] = checkoutMonth.split("-").map(Number);
      const prevDate = new Date(cy, cm - 2, 1);
      const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

      const [{ data: prevRecord }, { data: pkgConfig }, { data: roomInfo }, { data: activeTenantsInRoom }, { data: priorCheckoutsData }, { data: joinRowsData }, { data: currentMonthRecord }, { data: ownPaymentRow }] = await Promise.all([
        adminDb.from("hms_room_ac_readings").select("meter_reading").eq("room_id", tenant.room_id).eq("hostel_id", hostelId).eq("for_month", prevMonthStr).maybeSingle(),
        adminDb.from("hms_package_configs").select("ac_per_unit_rate").eq("hostel_id", hostelId).maybeSingle(),
        adminDb.from("hms_rooms").select("has_ac").eq("id", tenant.room_id).eq("hostel_id", hostelId).single(),
        adminDb.from("hms_tenants").select("id, check_in, joining_meter_reading").eq("hostel_id", hostelId).eq("room_id", tenant.room_id).eq("is_active", true),
        // Fetch prior checkout unit offsets (reading - prevMonthReading) so we can use them
        // as segment boundaries — same format as the month-end billing algorithm.
        // meter_reading + tenant_count_at_checkout are what computeACSegmentBilling
        // consumes; units_consumed is kept for the tenant_count headcount below.
        adminDb.from("hms_room_ac_checkout_readings").select("units_consumed, meter_reading, tenant_count_at_checkout").eq("room_id", tenant.room_id).eq("hostel_id", hostelId).eq("for_month", checkoutMonth),
        adminDb.from("hms_room_ac_join_readings").select("tenant_id, units_at_join").eq("room_id", tenant.room_id).eq("hostel_id", hostelId).eq("for_month", checkoutMonth),
        // The room's own current-month reading, already applied via the AC Units tab
        // (applyRoomACUnitsAction / computeACSegmentBilling) — the one source of truth
        // for "what has this tenant already been correctly billed for AC this month."
        // total_units is fetched alongside it so the exact opening that Apply used
        // (reading - total_units) can be reconstructed below, the same way the
        // checkout dialog's own preview already does.
        adminDb.from("hms_room_ac_readings").select("meter_reading, total_units").eq("room_id", tenant.room_id).eq("hostel_id", hostelId).eq("for_month", checkoutMonth).maybeSingle(),
        // This tenant's own already-billed AC for the month, so the breakpoint can
        // record the real figure even on the path where nothing is recomputed.
        adminDb.from("hms_payments").select("ac_charge, ac_units_consumed, status, amount_paid").eq("tenant_id", input.tenantId).eq("hostel_id", hostelId).eq("for_month", checkoutMonth).maybeSingle(),
      ]);

      // If the meter hasn't actually moved past what AC Units already applied this
      // month AND the operator isn't correcting the opening reading either, there
      // is nothing new to bill — recomputing here duplicates that exact same
      // allocation with an independently-fetched, independently-timed dataset
      // (join/checkout rows can drift between when Apply ran and now), which is
      // exactly how a departing tenant's estimate silently diverged from the
      // already-correct number sitting on their payment row. Skipping leaves
      // whatever ac_charge Apply already computed untouched — the only cases that
      // still need computing here are a genuinely newer reading or an explicit
      // opening correction, i.e. real information the room's last Apply never saw.
      const alreadyAppliedReading = currentMonthRecord?.meter_reading != null
        ? Math.round(Number(currentMonthRecord.meter_reading))
        : null;
      // A partially-paid row never recomputes, whatever reading is entered —
      // there is no way to tell how much of what was already collected covered
      // AC versus rent, so re-deriving the AC share would risk billing it twice
      // or writing it off. MUST match the identical guard in the dialog's
      // preview (checkoutMath in tenants-client.tsx), or the quote at the door
      // and the amount actually settled disagree.
      // Only when there is an actual prior charge to protect. A partially-paid
      // row with ac_charge = 0 had nothing collected against AC, so there is
      // nothing to double-bill — suppressing the recompute there would bill the
      // tenant Rs 0 for a whole month of AC and never recover it at month-end.
      // A REVERSED payment is stored partially_paid holding nothing, so without
      // the amount_paid test it looked like a part-paid row with AC already
      // collected — suppressing the recompute and under-billing a departing
      // member for their final month of AC.
      const rowPartiallyPaid = ownPaymentRow?.status === "partially_paid"
        && Number(ownPaymentRow?.amount_paid ?? 0) > 0.009
        && Number(ownPaymentRow?.ac_charge ?? 0) > 0;
      const hasNewerReading = !rowPartiallyPaid && (
        alreadyAppliedReading == null
        || Math.round(Number(input.acCheckoutReading)) > alreadyAppliedReading
        || input.acOpeningReading != null
      );

      if (roomInfo?.has_ac) {
        // Same fallback as applyRoomACUnitsAction: with no previous-month reading
        // and no explicit opening reading typed in, derive the baseline from the
        // room's earliest known move-in reading instead of assuming the meter
        // started at 0 — the same value already captured once at tenant creation.
        const derivedOpening = deriveOpeningReading(activeTenantsInRoom ?? [], checkoutMonth);
        // The exact opening this month's AC Units Apply already used, backed out
        // from what it actually saved — preferred over derivedOpening whenever an
        // apply has already happened, so a checkout recompute doesn't silently
        // rebase the whole month onto a different opening than what's already
        // billed. Ranked the same as the checkout dialog's own preview: an
        // explicit typed override still wins over this inferred value.
        const impliedCurrentOpening = (currentMonthRecord?.meter_reading != null && currentMonthRecord?.total_units != null)
          ? Math.round(Number(currentMonthRecord.meter_reading)) - Math.round(Number(currentMonthRecord.total_units))
          : null;

        const prevReading = prevRecord?.meter_reading != null
          ? Math.round(Number(prevRecord.meter_reading))
          : input.acOpeningReading != null
          ? Math.round(Number(input.acOpeningReading))
          : impliedCurrentOpening ?? (derivedOpening ?? 0);
        const reading = Math.round(Number(input.acCheckoutReading));
        const perUnitRate = Number(pkgConfig?.ac_per_unit_rate ?? 0);

        // Prior unit offsets: each value = (prior_checkout_reading - prevMonthReading).
        // Used as segment boundaries so this tenant is only charged for units consumed
        // while they were present, not re-charged for periods already billed to prior checkouts.
        const priorUnitsOffsets = (priorCheckoutsData ?? []).map(r => Number(r.units_consumed));
        const totalStart = (activeTenantsInRoom ?? []).length + priorUnitsOffsets.length;

        if (!Number.isFinite(reading) || reading < 0 || reading > 999_999) {
          throw new Error("AC meter reading must be between 0 and 999,999");
        }
        if (reading < prevReading) {
          throw new Error(`AC meter reading (${reading}) cannot be less than previous month's reading (${prevReading})`);
        }
        if (perUnitRate > 0 && totalStart > 0 && !hasNewerReading) {
          // Nothing new to bill — the AC Units tab already computed and recorded
          // this tenant's share for the month. Record the departure breakpoint
          // anyway (see acBreakpoint above) so month-end re-billing knows they
          // left partway and the remaining tenants aren't handed their share.
          const units = reading - prevReading;
          acBreakpoint = {
            meter_reading: reading,
            units_consumed: units,
            tenant_count: totalStart,
            ac_charge: Number(ownPaymentRow?.ac_charge ?? 0),
          };
        } else if (perUnitRate > 0 && totalStart > 0) {
          const units = reading - prevReading;

          // Delegated to the SAME function the Payments page's AC Units tab uses
          // (computeACSegmentBilling). Checkout used to carry its own hand-written
          // copy of this segment math — a third independent implementation
          // alongside the client preview's — and nothing forced the three to agree,
          // which is exactly how a departing tenant's charge drifted away from the
          // allocation the AC Units tab had already computed for the same room and
          // month. One implementation now owns mid-month joiners, prior-checkout
          // breakpoints, and the 2dp unit rounding that ac_charge must match.
          const { tenantBilling } = computeACSegmentBilling({
            // The departing tenant is still is_active at this point, so they are in here.
            eligible: (activeTenantsInRoom ?? []).map(t => ({
              id: t.id as string,
              check_in: t.check_in as string,
              joining_meter_reading: t.joining_meter_reading != null ? Number(t.joining_meter_reading) : null,
            })),
            prevReading,
            reading,
            units,
            perUnitRate,
            forMonth: checkoutMonth,
            // See needsBreakpoint.
            openingIsMonthStart: prevRecord?.meter_reading != null,
            joinReadingsRaw: (joinRowsData ?? []).map(j => ({
              tenant_id: j.tenant_id as string,
              units_at_join: Number(j.units_at_join),
            })),
            // `<=`, not `<`. A tenant who left earlier at exactly this reading (no AC
            // burned between the two departures) was present for the whole window and
            // must stay in the divisor — dropping them handed their share to whoever
            // is left, on top of what they already paid.
            //
            // Readings strictly ABOVE this one are still dropped. They mean the
            // departures are being processed out of order (a back-dated checkout
            // entered after a later one) or a reading was mistyped. The shared
            // function rejects that outright, which is right at month-end — the
            // operator can retype the closing reading — but here it would block a
            // tenant from leaving over a row that isn't theirs.
            checkoutReadingsRaw: (priorCheckoutsData ?? [])
              .filter(r => Math.round(Number(r.meter_reading)) <= reading)
              .map(r => ({
                meter_reading: Number(r.meter_reading),
                tenant_count_at_checkout: Number(r.tenant_count_at_checkout),
              })),
          });

          const mine = tenantBilling.find(r => r.id === tenant.id);
          // tenantUnits is already 2dp-rounded and ac_charge already derived from it
          // inside computeACSegmentBilling — ac_charge MUST equal units × rate, since
          // markPaymentPaidAction re-derives it that way and rejects a payment that
          // disagrees, and receipts itemise it as "N units × Rs rate/unit".
          const tenantUnits = mine?.tenantUnits ?? 0;
          const ac_charge = mine?.charge ?? 0;
          // units_consumed = total room units — stored as billing breakpoint for month-end algorithm.
          acCheckoutRecord = { units_consumed: units, tenant_count: totalStart, ac_charge, prevReading, tenant_unit_share: tenantUnits };
          acBreakpoint = { meter_reading: reading, units_consumed: units, tenant_count: totalStart, ac_charge };

          if (!input.paymentSettlement) {
            // The dialog only offers a settle choice for dues it could already see when
            // it opened, so an AC charge computed here has to find its own home. Left
            // unclaimed it either strands as fresh debt on a tenant who has walked out,
            // or — when the month is already settled — disappears without a trace.
            // One row per tenant-month (unique index), so: reuse it, or create it.
            const { data: monthRow } = await adminDb
              .from("hms_payments")
              .select("id, tenant_id, hostel_id, status, for_month, amount, late_fee, amount_paid, ac_charge")
              .eq("tenant_id", input.tenantId)
              .eq("hostel_id", hostelId)
              .eq("for_month", checkoutMonth)
              .maybeSingle();

            const adopt = (row: typeof monthRow) => {
              if (!row) return;
              verifiedPayment = {
                ...row,
                late_fee: Number(row.late_fee ?? 0),
                amount_paid: Number(row.amount_paid ?? 0),
              };
              adoptedACOnlyPayment = true;
            };

            if (monthRow) {
              const owedAfterAC =
                Number(monthRow.amount ?? 0) + Number(monthRow.late_fee ?? 0) + ac_charge
                - Number(monthRow.amount_paid ?? 0);
              if (owedAfterAC > 0) {
                // Settled in Step 3 — which also writes the AC fields and the new amount.
                adopt(monthRow);
              } else {
                await adminDb.from("hms_payments")
                  .update({
                    ac_units_consumed: tenantUnits,
                    ac_charge,
                    amount: Number(monthRow.amount ?? 0) - Number(monthRow.ac_charge ?? 0) + ac_charge,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", monthRow.id);
              }
            } else if (ac_charge > 0) {
              // Checked in and out inside the same month, before billing ever ran.
              const { data: created } = await adminDb
                .from("hms_payments")
                .insert({
                  hostel_id: hostelId,
                  tenant_id: input.tenantId,
                  for_month: checkoutMonth,
                  amount: 0,
                  status: "pending",
                })
                .select("id, tenant_id, hostel_id, status, for_month, amount, late_fee, amount_paid, ac_charge")
                .single();
              adopt(created);
            }
          }
          // When settlement IS provided, AC fields are merged into the Step 3 settlement
          // update below — targeting the exact payment ID avoids the for_month mismatch
          // that occurs when the pending payment's for_month differs from checkoutMonth.
        }
      }
    }

    // Step 3: Settle payment FIRST (before deactivating tenant — EC-4 safety)
    // Skip if already in the target state (SEC-F2 idempotent retry path)

    // Deposit settlement, computed server-side from the tenant's real held deposit.
    // The client used to draw "Deposit (applied) − Rs X / covers all dues" in its
    // summary and then send nothing about it, so the deduction never happened: dues
    // stayed pending and the deposit was refunded on top. The deduction is decided
    // here now — the client's figure is a preview, never an input.
    const heldDeposit = Number(tenant.security_deposit ?? 0);
    const settleAction = input.paymentSettlement?.action ?? (adoptedACOnlyPayment ? "pay" : null);
    // The AC charge already sitting inside `amount`. When Step 3a computed a
    // fresh one it REPLACES this — so the old figure has to come out before the
    // new one goes in, or the row is billed for AC twice. `amount` already
    // contains it whenever the AC Units tab applied units earlier in the month
    // (and Step 2b's read-back preserves it), which is the common case. Left at
    // 0 when nothing was recomputed, so the untouched charge stays counted once.
    // Guarded on the row being the SAME month Step 3a computed AC for. When the
    // checkout month has no row yet, the settled row can be an earlier month —
    // subtracting that month's AC would silently drop a charge that is still owed.
    const supersededAcCharge =
      acCheckoutRecord && verifiedPayment?.for_month === input.checkoutDate.substring(0, 7)
        ? Number(verifiedPayment.ac_charge ?? 0)
        : 0;
    // Everything the row bills once the checkout AC charge is folded in.
    const grossDue = verifiedPayment
      ? Number(verifiedPayment.amount ?? 0)
        - supersededAcCharge
        + Number(verifiedPayment.late_fee ?? 0)
        + (acCheckoutRecord?.ac_charge ?? 0)
      : 0;
    // Net of anything already paid — a month that was settled before an AC charge
    // showed up at checkout only owes the AC charge, not the rent all over again.
    const totalDue = Math.max(0, grossDue - Number(verifiedPayment?.amount_paid ?? 0));
    // Dues come out of the deposit first; only the shortfall is real cash the
    // operator has to collect at the door.
    const depositApplied = settleAction === "pay" ? Math.min(heldDeposit, totalDue) : 0;
    const cashCollected = settleAction === "pay" ? totalDue - depositApplied : 0;
    const depositRemaining = heldDeposit - depositApplied;

    if (verifiedPayment && settleAction && !paymentAlreadySettled) {
      if (settleAction === "pay") {
        const { error: payUpdateErr } = await adminDb
          .from("hms_payments")
          .update({
            status: "paid" as PaymentStatus,
            // An already-paid row picking up a checkout AC charge keeps its original
            // receipt and method — that money really was collected, back then, that way.
            ...(verifiedPayment.status === "paid" ? {} : {
              payment_date: input.paymentSettlement?.paymentDate ?? new Date().toISOString().split("T")[0],
              payment_method: (input.paymentSettlement?.paymentMethod ?? null) as PaymentMethod | null,
              receipt_number: genReceiptNumber(tenant.full_name, verifiedPayment.for_month ?? ""),
            }),
            // Merge AC fields here so the correct payment row is always targeted by ID,
            // not by for_month (which can differ from checkoutMonth for pre-generated payments).
            // Store the tenant's share of units (not total room units) so the receipt shows
            // "X units × Rs. rate/unit" correctly rather than the full room consumption.
            // The row ends fully settled — amount_paid is everything it bills, and
            // deposit_applied records how much of that came from the deposit rather than
            // fresh cash, so revenue reporting can tell the two apart.
            // Never below what was actually collected — with the supersede
            // subtraction a lower recomputed AC could otherwise erase recorded
            // cash. An overpaid row is honest; a shrunken amount_paid is not.
            amount_paid: Math.max(grossDue, Number(verifiedPayment.amount_paid ?? 0)),
            deposit_applied: depositApplied,
            ...(acCheckoutRecord ? {
              ac_units_consumed: round2(acCheckoutRecord.tenant_unit_share),
              ac_charge: acCheckoutRecord.ac_charge,
              // Add AC charge to base amount so PDF formula (monthlyRent = amount - ac_charge) stays correct
              // Same supersede rule as grossDue above — swap the old AC charge
              // out for the new one rather than stacking them. Monthly rows get
              // rebuilt by the migration-133 trigger anyway, but DAILY rows keep
              // the app-supplied amount, so stacking here persisted permanently.
              amount: Number(verifiedPayment.amount ?? 0) - supersededAcCharge + acCheckoutRecord.ac_charge,
            } : {}),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", verifiedPayment.id)
          .eq("hostel_id", hostelId);

        // SEC-F5: sanitize — do not propagate raw DB error strings to client
        if (payUpdateErr) throw new Error("Failed to record payment. Please try again.");
      } else if (settleAction === "waive") {
        const { error: waiveErr } = await adminDb
          .from("hms_payments")
          .update({
            status: "waived" as PaymentStatus,
            ...(acCheckoutRecord ? {
              ac_units_consumed: round2(acCheckoutRecord.tenant_unit_share),
              ac_charge: acCheckoutRecord.ac_charge,
            } : {}),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", verifiedPayment.id)
          .eq("hostel_id", hostelId);

        // SEC-F5: sanitize — do not propagate raw DB error strings to client
        if (waiveErr) throw new Error("Failed to waive payment. Please try again.");
      }
    }

    // Step 4: Deactivate tenant (clear bed assignment, mark inactive)
    const { error: checkoutErr } = await adminDb
      .from("hms_tenants")
      .update({
        check_out: input.checkoutDate,
        is_active: false,
        is_waiting: false,
        bed_number: null,
        notice_given_date: null,
        intended_checkout_date: null,
      })
      .eq("id", input.tenantId)
      .eq("hostel_id", hostelId);

    if (checkoutErr) {
      // EC-4: Payment was settled but tenant deactivation failed.
      // The payment is now paid/waived, so a retry will skip that step (SEC-F2).
      if (input.paymentSettlement) {
        // SEC-F5: sanitize — omit raw DB error; the retry message is actionable enough
        throw new Error(
          `The payment was recorded successfully, but tenant checkout failed. ` +
          `The tenant is still active. Retry the checkout — the payment has already been saved and will not be re-processed.`
        );
      }
      // SEC-F5: sanitize — do not expose DB internals
      throw new Error("Tenant checkout failed. Please try again.");
    }

    // Step 4a-pre: Clean up any payment rows for months after this one — a
    // tenant paying everything in advance at check-in already has next
    // month's row sitting there as "pending" purely because monthly sync
    // pre-generates it ahead of time, not because they actually owe it. Now
    // that checkout is confirmed, they will never reach that month, so it's
    // not a real debt. Only pending/overdue — never paid/partially_paid/waived,
    // which are real money already handled and must not be erased.
    await adminDb.from("hms_payments")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("hostel_id", hostelId)
      .gt("for_month", input.checkoutDate.substring(0, 7))
      .in("status", ["pending", "overdue"]);

    // A REVERSED bill is stored partially_paid but holds nothing, so the filter
    // above left it behind as a permanent phantom debt for a month the member
    // will never occupy. Deleted only at amount_paid = 0 — a bill with real
    // money against it stays, exactly as the comment above requires.
    await adminDb.from("hms_payments")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("hostel_id", hostelId)
      .gt("for_month", input.checkoutDate.substring(0, 7))
      .eq("status", "partially_paid")
      .eq("amount_paid", 0);

    // Same reasoning for referral rewards: a reward parked on a month this
    // tenant will never be billed for has nowhere to land. Scoped to months
    // AFTER the final billed one, so the checkout month's own reward survives
    // and scales down with the pro-rated rent rather than vanishing. Voids
    // unplaced 'held' payouts too — a referrer who leaves before the person they
    // referred pays has no future bill to credit. Fail-open: checkout has
    // already committed above.
    await voidReferralRewardsForTenant(
      adminDb,
      input.tenantId,
      nextMonthAfter(input.checkoutDate.substring(0, 7)),
      "checked_out"
    );

    // Step 4a: Log the deposit's fate to the Member Ledger — best-effort, non-fatal
    // (checkout itself already succeeded above). Three ways it can go, and every rupee
    // must land in exactly one of them: applied to dues, handed back, or kept.
    const depositNotes = input.depositNotes?.trim() || null;

    if (depositApplied > 0) {
      await adminDb.from("hms_tenant_events").insert({
        hostel_id: hostelId,
        tenant_id: input.tenantId,
        event_type: "deposit_applied",
        amount: depositApplied,
        notes: depositNotes,
      });
    }

    // `returned` is bounded by what survives the dues deduction, not by the original
    // deposit — otherwise a stale client figure could refund money already spent on
    // the tenant's own bill. Anything short of the remainder is a forfeit (damages etc).
    let returnedAmount = 0;
    let forfeitedAmount = 0;
    if (input.depositReturned !== undefined && heldDeposit > 0) {
      returnedAmount = Math.max(0, Math.min(Number(input.depositReturned), depositRemaining));
      forfeitedAmount = depositRemaining - returnedAmount;

      if (returnedAmount > 0) {
        await adminDb.from("hms_tenant_events").insert({
          hostel_id: hostelId,
          tenant_id: input.tenantId,
          event_type: "deposit_returned",
          amount: returnedAmount,
          notes: depositNotes,
        });
      }
      if (forfeitedAmount > 0) {
        await adminDb.from("hms_tenant_events").insert({
          hostel_id: hostelId,
          tenant_id: input.tenantId,
          event_type: "deposit_forfeited",
          amount: forfeitedAmount,
          notes: depositNotes,
        });
      }
    }

    // Step 4b: Persist AC checkout reading record — stored AFTER tenant deactivation
    // so it only exists if the checkout actually completed.
    let acReadingWarning: string | undefined;
    if (acBreakpoint && tenant.room_id) {
      const checkoutMonth = input.checkoutDate.substring(0, 7);
      const { error: acReadingErr } = await adminDb
        .from("hms_room_ac_checkout_readings")
        .upsert(
          {
            hostel_id: hostelId,
            room_id: tenant.room_id,
            tenant_id: input.tenantId,
            for_month: checkoutMonth,
            meter_reading: acBreakpoint.meter_reading,
            units_consumed: acBreakpoint.units_consumed,
            tenant_count_at_checkout: acBreakpoint.tenant_count,
            ac_charge: acBreakpoint.ac_charge,
            checkout_date: input.checkoutDate,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "room_id,tenant_id,for_month" }
        );
      if (acReadingErr) {
        // Checkout is complete but the billing breakpoint could not be stored.
        // Month-end billing for remaining tenants may be inaccurate without it.
        acReadingWarning =
          "Checkout complete, but the AC billing breakpoint could not be saved. " +
          "Month-end billing for remaining tenants may be slightly inaccurate. Contact support.";
      }
    }

    // Step 5: Atomically decrement room occupancy — non-fatal, best-effort
    // UX-F2 + SEC-F3: replaced read-compute-write with a single atomic RPC to eliminate
    // the race window for concurrent checkouts and carry the full ownership chain.
    // Requires DB function:
    //   CREATE OR REPLACE FUNCTION decrement_room_occupancy(p_room_id uuid, p_hostel_id uuid)
    //   RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
    //     UPDATE hms_rooms
    //     SET occupied = GREATEST(occupied - 1, 0),
    //         status = CASE WHEN GREATEST(occupied - 1, 0) < capacity THEN 'available' ELSE 'occupied' END
    //     WHERE id = p_room_id AND hostel_id = p_hostel_id;
    //   $$;
    if (tenant.room_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminDb as any).rpc("decrement_room_occupancy", {
        p_room_id: tenant.room_id,
        p_hostel_id: hostelId,
      });
      // Non-fatal — Supabase returns error in result object, not thrown; ignored intentionally
    }

    // Step 6: Mint the single-use checkout feedback link — best-effort, and
    // deliberately the LAST thing that happens. mintFeedbackToken never throws
    // and returns null on any failure, so a feedback subsystem having a bad day
    // can never strand a tenant who has physically walked out of the building.
    //
    // The URL is the {{5}} variable of the hms_tenant_checkout WhatsApp
    // template, sent from the server immediately below.
    //
    // It is NOT returned. A Server Action's return value is serialised into the
    // response the caller's browser receives, and checkoutTenantAsManager /
    // checkoutTenantAsPartner forward this object verbatim — so returning it
    // handed a live, single-use write credential to whoever ran the checkout.
    // Question 3 of the form rates the hostel staff, and the token is the only
    // authorisation that exists to answer it: one open of that URL and the
    // staff being rated have authored a five-star review under a real
    // ex-tenant's name, permanently, with the tenant's own answers no longer
    // possible (UNIQUE (tenant_id), single-use token, no re-mint after
    // checkout). The link only ever travels to the tenant's phone.
    const feedbackUrl = await mintFeedbackToken(hostelId, input.tenantId);

    // Held in a local and handed straight to the sender, never returned. The
    // send is server-side (Business API, not wa.me) for the same reason: a
    // click-to-send link would put the credential in the operator's browser,
    // which is exactly what the paragraph above forbids. Awaited but
    // non-throwing — sendCheckoutMessage swallows every failure, so a Meta
    // outage cannot undo a completed checkout.
    await sendCheckoutMessage(input.tenantId, feedbackUrl);

    revalidatePath("/tenants");
    revalidatePath("/payments");
    revalidatePath("/dashboard");

    return {
      success: true,
      ...((repriceWarning || acReadingWarning) ? { warning: [repriceWarning, acReadingWarning].filter(Boolean).join(" ") } : {}),
      settlement: {
        duesSettled: settleAction === "pay" ? totalDue : 0,
        depositApplied,
        cashCollected,
        depositReturned: returnedAmount,
        depositForfeited: forfeitedAmount,
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
