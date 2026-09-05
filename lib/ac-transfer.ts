import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CarriedACCharge {
  units: number;
  charge: number;
}

/**
 * What a tenant already owes for AC in rooms they have MOVED OUT OF this month.
 *
 * Every writer of a tenant's ac_charge — both Apply paths and the checkout
 * settlement — overwrites the column outright with the share computed for the
 * one room it is looking at. That is correct while a tenant only ever occupies
 * one room in a month, which was true until room transfers existed.
 *
 * After a transfer it is not. The room the tenant left recorded their share at
 * the moment they moved (a closing reading, exactly as a checkout would), and
 * that share is real money already earned. The next writer to touch the row —
 * the new room's month-end Apply, or a checkout later the same month — would
 * replace it with only the new room's share and silently lose the rest.
 *
 * So every writer adds this back. It reads only rows explicitly marked as a
 * transfer, and only from OTHER rooms, so:
 *   * a tenant with no transfers gets an empty map and nothing changes;
 *   * a real checkout (transferred_to_room_id NULL) is never counted — that
 *     share was settled at the door and belongs to nobody's later bill;
 *   * the room being applied is excluded, because its own share is exactly what
 *     the caller has just computed;
 *   * two transfers in one month (A -> B -> C) sum both earlier rooms.
 *
 * Idempotent by construction: callers ADD this to a freshly computed share and
 * overwrite, so re-running an Apply lands on the same total.
 */
export async function carriedTransferCharges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  hostelId: string,
  forMonth: string,
  excludeRoomId: string | null,
  tenantIds: string[]
): Promise<Map<string, CarriedACCharge>> {
  const out = new Map<string, CarriedACCharge>();
  if (tenantIds.length === 0) return out;

  let q = admin
    .from("hms_room_ac_checkout_readings")
    .select("tenant_id, room_id, units_consumed, ac_charge")
    .eq("hostel_id", hostelId)
    .eq("for_month", forMonth)
    .not("transferred_to_room_id", "is", null)
    .in("tenant_id", tenantIds);

  if (excludeRoomId) q = q.neq("room_id", excludeRoomId);

  const { data, error } = await q;
  // Failing closed would block a legitimate Apply for every tenant in the room
  // because one of them once moved; failing open silently loses money. Neither
  // is acceptable silently, so the error is raised to the caller, which already
  // surfaces AC billing errors to the operator.
  if (error) throw new Error(`Could not read this month's room-transfer charges: ${error.message}`);

  for (const r of data ?? []) {
    const prev = out.get(r.tenant_id) ?? { units: 0, charge: 0 };
    out.set(r.tenant_id, {
      units: prev.units + Number(r.units_consumed ?? 0),
      charge: prev.charge + Number(r.ac_charge ?? 0),
    });
  }
  return out;
}
