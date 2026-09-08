import type { WifiNetwork } from "@/types";

// WiFi networks can be scoped to part of a branch. Coverage is a flat list of
// tokens on each network — "floor:1", "room:305" — so it rides inside the
// existing wifi_networks JSON with no schema change. An empty (or absent) list
// means the network covers the whole hostel, which is the default and matches
// how every existing branch already behaves.
//
// Room scoping is by ROOM NUMBER, matching how the Settings picker presents it
// (one "Room 305" chip). Room numbers are effectively unique within a branch;
// in the rare case the same number appears on two floors, a "room:305" scope
// reaches both — the owner's tool to separate floors is floor-level scoping.

export function floorToken(floor: number | string): string {
  return `floor:${String(floor).trim()}`;
}

export function roomToken(roomNumber: string): string {
  return `room:${roomNumber.trim()}`;
}

export interface ResidentLocation {
  /** The resident's room number, e.g. "305". */
  roomNumber: string | null | undefined;
  /** The floor that room is on, if known. */
  floor: number | null | undefined;
}

/** True when this network should be shown to a resident in the given location.
 *  Blank coverage → everywhere. Otherwise the network's floor or exact room must
 *  match. Whitespace/casing on room numbers is normalised so "305" and " 305 "
 *  are the same room. */
export function networkCoversLocation(net: WifiNetwork, loc: ResidentLocation): boolean {
  const coverage = (net.coverage ?? []).filter((t) => t && t.trim());
  if (coverage.length === 0) return true; // whole hostel

  const set = new Set(coverage.map((t) => t.trim().toLowerCase()));
  const roomNorm = (loc.roomNumber ?? "").trim().toLowerCase();
  if (roomNorm && set.has(`room:${roomNorm}`)) return true;
  if (loc.floor !== null && loc.floor !== undefined && set.has(`floor:${String(loc.floor).trim().toLowerCase()}`)) {
    return true;
  }
  return false;
}

/**
 * The networks a resident in `loc` should be given, in the owner's configured
 * order. Only networks with a name are considered.
 *
 * Whole-hostel (blank-coverage) networks always match, so the result is every
 * branch-wide network plus any scoped network that reaches this resident's floor
 * or room. If a branch has ONLY scoped networks and none matches this resident,
 * the list is empty and the caller omits the WiFi block — there is nothing
 * truthful to fall back to.
 */
export function wifiNetworksForResident(
  networks: WifiNetwork[] | null | undefined,
  loc: ResidentLocation
): WifiNetwork[] {
  return (networks ?? [])
    .filter((n) => n.name?.trim())
    .filter((n) => networkCoversLocation(n, loc));
}
