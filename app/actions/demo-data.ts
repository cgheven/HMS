"use server";

// One-click sample/demo data for new owners with a blank dashboard.
//
// loadSampleData() seeds a DEDICATED demo branch (its own hms_hostels row) full of
// realistic rooms/residents/payments/expenses/complaints/menu, then switches the
// owner into it so they immediately see a lived-in dashboard. removeSampleData()
// deletes that branch in one atomic cascade.
//
// The demo branch is invisible to billing (billing_active=false) and the public
// site (listing_enabled=false); is_demo marks it for the banner, one-per-owner and
// removal. All writes go through the service-role admin client, so no welcome
// email / WhatsApp / referral ever fires for the fake residents (those are
// app-level, not DB triggers). The payment `amount` is trigger-recomputed from the
// tenant/config, so we set only status/amount_paid/payment_date for paid rows.

import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwnerWrite, requireOwnerOrAbove } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureMonthlyPaymentRows } from "@/lib/monthly-payment-sync";
import { switchActiveHostel } from "@/app/actions/branches";

// ── country-scaled demo numbers ───────────────────────────────────────────────
// Amounts render in the owner's own currency (from hostel.country), so they must
// be sensible for that currency's magnitude — PKR is in thousands, GBP/USD in
// hundreds. Covers the live markets (PK, GB) with a USD default for the rest.
interface DemoScale {
  rentByCap: Record<number, number>;
  acPremium: number;
  config: Record<string, number | object>;
  expenses: { title: string; amount: number; category: string }[];
}

function demoScale(country: string | null | undefined): DemoScale {
  const c = (country ?? "PK").toUpperCase();
  if (c === "GB") {
    return {
      rentByCap: { 2: 650, 3: 550, 4: 450 },
      acPremium: 80,
      config: {
        food_monthly_rate: 300, ac_per_unit_rate: 0, ac_maintenance_rate: 0,
        security_deposit: 800, registration_fee: 100, notice_period_days: 30, washroom_premium: 60,
        food_breakfast_rate: 90, food_lunch_rate: 120, food_dinner_rate: 120, food_all_meals_rate: 300,
        seater_prices: { "2": { no_ac: 650, ac: 730 }, "3": { no_ac: 550, ac: 630 }, "4": { no_ac: 450, ac: 530 } },
        package_prices: {},
      },
      // Operational only — utilities live in Bills, groceries in Kitchen, wages in Staff.
      expenses: [
        { title: "Plumbing repair", amount: 340, category: "repairs" },
        { title: "Cleaning supplies", amount: 180, category: "cleaning" },
        { title: "CCTV & security equipment", amount: 220, category: "security" },
        { title: "New furniture", amount: 400, category: "furniture" },
        { title: "Misc", amount: 150, category: "other" },
      ],
    };
  }
  if (c === "PK") {
    return {
      rentByCap: { 2: 18000, 3: 15000, 4: 12000 },
      acPremium: 3000,
      config: {
        food_monthly_rate: 8000, ac_per_unit_rate: 35, ac_maintenance_rate: 1500,
        security_deposit: 20000, registration_fee: 2000, notice_period_days: 30, washroom_premium: 2000,
        food_breakfast_rate: 2500, food_lunch_rate: 3500, food_dinner_rate: 3500, food_all_meals_rate: 8000,
        seater_prices: { "2": { no_ac: 18000, ac: 21000 }, "3": { no_ac: 15000, ac: 18000 }, "4": { no_ac: 12000, ac: 15000 } },
        package_prices: {},
      },
      // Operational only — utilities live in Bills, groceries in Kitchen, wages in Staff.
      expenses: [
        { title: "Building repairs", amount: 12000, category: "repairs" },
        { title: "Cleaning supplies", amount: 8000, category: "cleaning" },
        { title: "CCTV & security equipment", amount: 9000, category: "security" },
        { title: "New furniture", amount: 15000, category: "furniture" },
        { title: "Miscellaneous", amount: 6000, category: "other" },
      ],
    };
  }
  // Default USD (every other market).
  return {
    rentByCap: { 2: 400, 3: 320, 4: 260 },
    acPremium: 60,
    config: {
      food_monthly_rate: 200, ac_per_unit_rate: 2, ac_maintenance_rate: 40,
      security_deposit: 500, registration_fee: 80, notice_period_days: 30, washroom_premium: 40,
      food_breakfast_rate: 60, food_lunch_rate: 80, food_dinner_rate: 80, food_all_meals_rate: 200,
      seater_prices: { "2": { no_ac: 400, ac: 460 }, "3": { no_ac: 320, ac: 380 }, "4": { no_ac: 260, ac: 320 } },
      package_prices: {},
    },
    // Operational only — utilities live in Bills, groceries in Kitchen, wages in Staff.
    expenses: [
      { title: "Repairs", amount: 120, category: "repairs" },
      { title: "Cleaning supplies", amount: 70, category: "cleaning" },
      { title: "CCTV & security equipment", amount: 90, category: "security" },
      { title: "New furniture", amount: 180, category: "furniture" },
      { title: "Misc", amount: 40, category: "other" },
    ],
  };
}

// Extra country-scaled numbers for the additional demo subsystems (staff, kitchen,
// bills). Same magnitude logic as demoScale — PK in thousands, GB/USD in hundreds.
interface ExtraScale {
  salaries: { cook: number; guard: number; cleaner: number; manager: number };
  advance: number;
  kitchenGrocery: number;
  kitchenDaily: number;
  bills: { electricity: number; water: number; gas: number; internet: number };
}

function extraScale(country: string | null | undefined): ExtraScale {
  const c = (country ?? "PK").toUpperCase();
  if (c === "GB") {
    return { salaries: { cook: 1800, guard: 1600, cleaner: 1400, manager: 2800 }, advance: 500, kitchenGrocery: 2400, kitchenDaily: 60, bills: { electricity: 900, water: 200, gas: 300, internet: 60 } };
  }
  if (c === "PK") {
    return { salaries: { cook: 35000, guard: 30000, cleaner: 25000, manager: 60000 }, advance: 15000, kitchenGrocery: 60000, kitchenDaily: 3500, bills: { electricity: 45000, water: 8000, gas: 12000, internet: 6000 } };
  }
  return { salaries: { cook: 600, guard: 500, cleaner: 400, manager: 1000 }, advance: 200, kitchenGrocery: 520, kitchenDaily: 30, bills: { electricity: 320, water: 80, gas: 120, internet: 40 } };
}

const STAFF_PK: [string, string][] = [["cook", "Rashid Ali"], ["guard", "Gul Khan"], ["cleaner", "Nadia Bibi"], ["manager", "Imran Shah"]];
const STAFF_INTL: [string, string][] = [["cook", "Marco Rossi"], ["guard", "Tom Baker"], ["cleaner", "Anna Novak"], ["manager", "David Lin"]];
const KITCHEN_ITEMS = ["Vegetables", "Chicken", "Milk & Dairy", "Flour & Rice", "Cooking Oil", "Spices & Masala"];

const PK_NAMES = [
  "Ahmed Raza", "Bilal Khan", "Usman Ali", "Hamza Sheikh", "Fahad Iqbal", "Zain Malik",
  "Saad Farooq", "Hassan Javed", "Umar Aslam", "Talha Nawaz", "Ali Hamza", "Danish Butt",
  "Ayesha Siddiqui", "Fatima Noor", "Hira Aslam", "Maryam Tariq", "Sana Yousuf", "Iqra Riaz",
  "Noor Fatima", "Zara Ahmed", "Areeba Khan", "Mahnoor Ali",
];
const INTL_NAMES = [
  "James Carter", "Oliver Bennett", "Liam Foster", "Noah Hughes", "Ethan Reed", "Lucas Grant",
  "Daniel Owen", "Adam Price", "Ryan Scott", "Jack Morgan", "Harry Turner", "George Ward",
  "Emily Turner", "Sophie Clarke", "Grace Palmer", "Chloe Adams", "Ella Watson", "Mia Cooper",
  "Amelia Ross", "Isla Murray", "Freya Bell", "Ruby Hayes",
];

function namesFor(country: string | null | undefined): string[] {
  return (country ?? "PK").toUpperCase() === "PK" ? PK_NAMES : INTL_NAMES;
}

// Fixed, believable 3-floor layout. capacity guard (migration 254) rejects an
// active tenant beyond a room's capacity, so we always fill to <= capacity.
const ROOM_LAYOUT: { room_number: string; floor: number; capacity: number; has_ac: boolean }[] = [
  { room_number: "101", floor: 1, capacity: 2, has_ac: true },
  { room_number: "102", floor: 1, capacity: 3, has_ac: false },
  { room_number: "103", floor: 1, capacity: 3, has_ac: true },
  { room_number: "104", floor: 1, capacity: 4, has_ac: false },
  { room_number: "201", floor: 2, capacity: 2, has_ac: true },
  { room_number: "202", floor: 2, capacity: 3, has_ac: false },
  { room_number: "203", floor: 2, capacity: 4, has_ac: true },
  { room_number: "301", floor: 3, capacity: 2, has_ac: false },
  { room_number: "302", floor: 3, capacity: 3, has_ac: true },
  { room_number: "303", floor: 3, capacity: 4, has_ac: false },
];

const WEEKLY_MENU: Record<"breakfast" | "lunch" | "dinner", string[]> = {
  breakfast: ["Paratha & Omelette", "Halwa Puri", "Toast & Eggs", "Aloo Paratha", "Chana Chaat", "French Toast", "Nihari"],
  lunch: ["Chicken Biryani", "Daal Chawal", "Chicken Karahi", "Vegetable Pulao", "Fish & Rice", "Chana Pulao", "Beef Qeema"],
  dinner: ["Chicken Qorma & Roti", "Aloo Gosht", "Daal & Roti", "Chicken Handi", "Mixed Vegetable", "Chapli Kebab", "Chicken Roast"],
};

function monthStr(offset: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthsAgoISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}
function futureISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}
function phoneFor(country: string | null | undefined, i: number): string {
  const n = String(1000000 + ((i * 733) % 8999999)).slice(0, 7);
  return (country ?? "PK").toUpperCase() === "PK" ? `0300${n}` : `07${n}00`;
}

export async function loadSampleData(): Promise<{ success: boolean; error?: string; hostelId?: string; alreadyExists?: boolean }> {
  // Set once the demo hostel exists, so a failure mid-seed can clean it up rather
  // than strand the owner with a half-populated demo branch.
  let createdHostelId: string | null = null;
  const admin = createAdminClient();
  try {
    const profile = await requireOwnerWrite();
    const ownerId = profile.id;

    // One demo per owner — if it exists, just switch into it. limit(1) (not
    // maybeSingle) so a legacy duplicate can't throw here; the unique index
    // (migration 267) prevents new duplicates.
    const { data: existingRows } = await admin
      .from("hms_hostels")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("is_demo", true)
      .order("created_at", { ascending: true })
      .limit(1);
    const existingId = (existingRows?.[0] as { id: string } | undefined)?.id;
    if (existingId) {
      await switchActiveHostel(existingId);
      revalidatePath("/", "layout");
      return { success: true, hostelId: existingId, alreadyExists: true };
    }

    const country = (profile as { country?: string | null }).country ?? "PK";
    const scale = demoScale(country);
    const names = namesFor(country);
    const totalCapacity = ROOM_LAYOUT.reduce((s, r) => s + r.capacity, 0);

    // 1) The demo hostel — out of billing + listing, marked is_demo.
    const { data: hostelRow, error: hErr } = await admin
      .from("hms_hostels")
      .insert({
        owner_id: ownerId,
        name: "🎬 Sample Data (safe to remove)",
        country,
        total_capacity: totalCapacity,
        billing_active: false,
        listing_enabled: false,
        is_demo: true,
        hostel_type: "mixed",
        amenities: ["WiFi", "Laundry", "Meals", "Security", "Backup Power"],
        city: "Demo City",
      })
      .select("id")
      .single();
    if (hErr || !hostelRow) {
      // Unique-index (migration 267) violation = a concurrent "Explore" already
      // created the demo. Point them at it instead of erroring.
      if ((hErr as { code?: string } | null)?.code === "23505") {
        const { data: dupRows } = await admin.from("hms_hostels").select("id").eq("owner_id", ownerId).eq("is_demo", true).limit(1);
        const dupId = (dupRows?.[0] as { id: string } | undefined)?.id;
        if (dupId) {
          await switchActiveHostel(dupId);
          revalidatePath("/", "layout");
          return { success: true, hostelId: dupId, alreadyExists: true };
        }
      }
      throw new Error(hErr?.message ?? "Could not create the sample branch");
    }
    const hostelId = hostelRow.id as string;
    createdHostelId = hostelId;

    const { error: linkErr } = await admin.from("hms_owner_hostels").insert({ owner_id: ownerId, hostel_id: hostelId, is_primary: false });
    if (linkErr) throw new Error(linkErr.message);
    const { error: cfgErr } = await admin.from("hms_package_configs").insert({ hostel_id: hostelId, ...scale.config });
    if (cfgErr) throw new Error(cfgErr.message);

    // 2) Rooms.
    const rooms: { id: string; capacity: number; has_ac: boolean; rent: number }[] = [];
    for (const r of ROOM_LAYOUT) {
      const base = scale.rentByCap[r.capacity] ?? scale.rentByCap[3] ?? 15000;
      const rent = base + (r.has_ac ? scale.acPremium : 0);
      const { data: rr, error: rErr } = await admin
        .from("hms_rooms")
        .insert({ hostel_id: hostelId, room_number: r.room_number, floor: r.floor, capacity: r.capacity, monthly_rent: rent, type: "general", has_ac: r.has_ac })
        .select("id")
        .single();
      if (rErr || !rr) throw new Error(rErr?.message ?? "Could not create sample rooms");
      rooms.push({ id: rr.id as string, capacity: r.capacity, has_ac: r.has_ac, rent });
    }

    // 3) Residents — fill each room to capacity or capacity-1, never beyond.
    const TARGET = 20;
    const seededTenants: { id: string; roomId: string; hasAc: boolean }[] = [];
    let n = 0;
    for (const room of rooms) {
      const fill = Math.max(1, room.capacity - (room.capacity >= 4 ? 1 : 0));
      for (let k = 0; k < fill && n < TARGET; k++) {
        const tier = room.has_ac ? pick(["space_food_ac", "space_3meals"], n) : pick(["space_only", "space_food"], n);
        const { data: t, error: tErr } = await admin.from("hms_tenants").insert({
          hostel_id: hostelId,
          room_id: room.id,
          full_name: names[n % names.length],
          type: pick(["student", "professional", "general"], n),
          phone: phoneFor(country, n),
          check_in: monthsAgoISO(pick([2, 3, 4, 5, 6, 1], n)),
          monthly_rent: room.rent,
          is_active: true,
          is_waiting: false,
          billing_type: "monthly",
          package_tier: tier,
          security_deposit: scale.config.security_deposit as number,
          registration_fee: scale.config.registration_fee as number,
        }).select("id").single();
        if (tErr || !t) throw new Error(tErr?.message ?? "Could not create sample residents");
        seededTenants.push({ id: t.id as string, roomId: room.id, hasAc: room.has_ac });
        n++;
      }
    }

    // 4) Payments — three months of bills; the two prior months mostly paid,
    // current month left pending (with a few paid) for a realistic mix.
    const months = [monthStr(-2), monthStr(-1), monthStr(0)];
    for (const m of months) await ensureMonthlyPaymentRows(admin, hostelId, m);

    for (const m of [monthStr(-2), monthStr(-1)]) {
      const { data: rows } = await admin.from("hms_payments").select("id, amount").eq("hostel_id", hostelId).eq("for_month", m);
      await Promise.all(
        (rows ?? []).map((row, i) =>
          // Leave roughly 1 in 10 unpaid in the previous month so "Outstanding" isn't empty.
          m === monthStr(-1) && i % 9 === 0
            ? Promise.resolve()
            : admin.from("hms_payments").update({
                status: "paid",
                amount_paid: (row as { amount: number }).amount,
                payment_date: `${m}-05`,
                payment_method: pick(["cash", "bank_transfer", "jazzcash"], i),
              }).eq("id", (row as { id: string }).id)
        )
      );
    }
    // Current month: record AC meter units FIRST (so a subsequently-paid row
    // captures the AC-inclusive amount), then collect a few payments.
    const cm = monthStr(0);
    const acRate = Number(scale.config.ac_per_unit_rate);
    if (acRate > 0) {
      for (const room of rooms.filter((r) => r.has_ac)) {
        const acTenants = seededTenants.filter((t) => t.roomId === room.id);
        if (acTenants.length === 0) continue;
        const totalUnits = 160 + room.capacity * 20;
        await admin.from("hms_room_ac_readings").insert({
          hostel_id: hostelId, room_id: room.id, for_month: cm,
          total_units: totalUnits, per_unit_rate: acRate, tenant_count: acTenants.length,
          recorded_while_vacant: false,
        });
        const unitsEach = Math.round((totalUnits / acTenants.length) * 100) / 100;
        const acCharge = Math.round(unitsEach * acRate);
        for (const t of acTenants) {
          // ac_charge folds into the bill via the payment recalc trigger.
          await admin.from("hms_payments").update({ ac_units_consumed: unitsEach, ac_charge: acCharge })
            .eq("hostel_id", hostelId).eq("tenant_id", t.id).eq("for_month", cm);
        }
      }
    }
    // Deposits collected THIS month — 2 residents paid their deposit with this
    // month's bill (drives the "Deposits Collected" tile; profit-neutral since
    // net_profit subtracts collected deposits — a deposit is held, not earned).
    const depositTenantIds = new Set(seededTenants.slice(0, 2).map((t) => t.id));
    for (const id of depositTenantIds) {
      await admin.from("hms_payments").update({ security_deposit_charge: scale.config.security_deposit })
        .eq("hostel_id", hostelId).eq("tenant_id", id).eq("for_month", cm);
    }
    // Collect ~85% of the current month (leave a few pending for the Pending list),
    // always including the 2 deposit residents so their deposit counts as collected.
    {
      const { data: rows } = await admin.from("hms_payments").select("id, amount, tenant_id").eq("hostel_id", hostelId).eq("for_month", cm);
      await Promise.all(
        (rows ?? []).map((row, i) => {
          const r = row as { id: string; amount: number; tenant_id: string };
          const pay = i % 6 !== 0 || depositTenantIds.has(r.tenant_id);
          return pay
            ? admin.from("hms_payments").update({
                status: "paid",
                amount_paid: r.amount,
                payment_date: `${cm}-03`,
                payment_method: pick(["cash", "bank_transfer"], i),
              }).eq("id", r.id)
            : Promise.resolve();
        })
      );
    }

    // 5) Expenses, complaints, weekly menu.
    await admin.from("hms_expenses").insert(
      scale.expenses.map((e) => ({ hostel_id: hostelId, title: e.title, amount: e.amount, category: e.category, date: monthsAgoISO(0) }))
    );
    await admin.from("hms_complaints").insert([
      { hostel_id: hostelId, title: "Water leakage in washroom", category: "other", priority: "high", status: "open", description: "Reported on the 2nd floor common washroom." },
      { hostel_id: hostelId, title: "WiFi slow in the evening", category: "other", priority: "medium", status: "open", description: "Peak-hour speed drop on the 3rd floor." },
      { hostel_id: hostelId, title: "Room cleaning request", category: "cleanliness", priority: "low", status: "resolved", description: "Deep clean requested.", resolution_notes: "Completed by housekeeping.", resolved_at: new Date().toISOString() },
    ]);
    const foodRows: { hostel_id: string; day_of_week: number; date: null; meal_type: string; item_name: string; sort_order: number }[] = [];
    (["breakfast", "lunch", "dinner"] as const).forEach((meal, mi) => {
      WEEKLY_MENU[meal].forEach((dish, day) => {
        foodRows.push({ hostel_id: hostelId, day_of_week: day + 1, date: null, meal_type: meal, item_name: dish, sort_order: mi });
      });
    });
    await admin.from("hms_food_items").insert(foodRows);

    // 6) Staff — employees + salaries (prior month paid, one current pending) + an advance.
    const ex = extraScale(country);
    const staffList = (country ?? "PK").toUpperCase() === "PK" ? STAFF_PK : STAFF_INTL;
    const employees: { id: string; role: string; salary: number }[] = [];
    for (let i = 0; i < staffList.length; i++) {
      const [role, sname] = staffList[i];
      const salary = ex.salaries[role as keyof typeof ex.salaries] ?? ex.salaries.cleaner;
      const { data: emp } = await admin.from("hms_employees").insert({
        hostel_id: hostelId, full_name: sname, role, monthly_salary: salary,
        join_date: monthsAgoISO(6), status: "active", phone: phoneFor(country, 50 + i),
      }).select("id").single();
      if (emp?.id) employees.push({ id: emp.id as string, role, salary });
    }
    const salaryRows: Record<string, unknown>[] = [];
    for (const m of [monthStr(-1), monthStr(0)]) {
      employees.forEach((e, i) => {
        const pendingCurrent = m === monthStr(0) && i === employees.length - 1;
        salaryRows.push({
          hostel_id: hostelId, employee_id: e.id, for_month: m, amount: e.salary,
          status: pendingCurrent ? "pending" : "paid",
          ...(pendingCurrent ? {} : { payment_date: `${m}-01`, payment_method: "bank_transfer" }),
        });
      });
    }
    if (salaryRows.length) await admin.from("hms_salary_payments").insert(salaryRows);
    const cook = employees.find((e) => e.role === "cook") ?? employees[0];
    if (cook) {
      await admin.from("hms_salary_advances").insert({
        hostel_id: hostelId, employee_id: cook.id, amount: ex.advance,
        advance_date: monthsAgoISO(0), payment_method: "cash", notes: "Advance against salary",
      });
    }

    // 7) Kitchen cost — daily items spread across the month + one monthly grocery.
    const kitchenRows: Record<string, unknown>[] = KITCHEN_ITEMS.map((item, i) => ({
      hostel_id: hostelId, title: item, amount: Math.round(ex.kitchenDaily * (0.6 + (i % 3) * 0.3)),
      quantity: `${5 + i * 2} kg`, type: "daily", date: `${cm}-${String(3 + i * 4).padStart(2, "0")}`,
    }));
    kitchenRows.push({ hostel_id: hostelId, title: "Monthly grocery stock", amount: ex.kitchenGrocery, quantity: "Bulk", type: "monthly_grocery", date: `${cm}-01` });
    await admin.from("hms_kitchen_expenses").insert(kitchenRows);

    // 8) Utility bills — pending, overdue, and one paid (Bills page + dashboard tile).
    await admin.from("hms_bills").insert([
      { hostel_id: hostelId, title: "Electricity bill", category: "electricity", amount: ex.bills.electricity, due_date: `${monthStr(-1)}-25`, status: "overdue" },
      { hostel_id: hostelId, title: "Water bill", category: "water", amount: ex.bills.water, due_date: futureISO(12), status: "unpaid" },
      { hostel_id: hostelId, title: "Gas bill", category: "gas", amount: ex.bills.gas, due_date: futureISO(20), status: "unpaid" },
      { hostel_id: hostelId, title: "Internet", category: "internet", amount: ex.bills.internet, due_date: `${monthStr(-1)}-20`, status: "paid", paid_date: `${monthStr(-1)}-18` },
    ]);

    // 9) Notice — two active residents on notice (one adequate ≥ notice period, one short).
    if (seededTenants.length >= 2) {
      await admin.from("hms_tenants").update({ notice_given_date: monthsAgoISO(0), intended_checkout_date: futureISO(35) }).eq("id", seededTenants[0].id);
      await admin.from("hms_tenants").update({ notice_given_date: monthsAgoISO(0), intended_checkout_date: futureISO(12) }).eq("id", seededTenants[1].id);
    }

    // Land the owner inside the populated demo branch.
    await switchActiveHostel(hostelId);
    revalidatePath("/", "layout");
    return { success: true, hostelId };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[demo-data] loadSampleData failed:", err);
    // Roll back a partially-seeded demo so the owner isn't stranded with a broken
    // half-populated branch (and a re-try can start clean). The atomic RPC handles
    // the room-delete guard by deactivating residents first.
    if (createdHostelId) {
      try { await admin.rpc("hms_delete_branch_atomic", { p_hostel_id: createdHostelId }); }
      catch (cleanupErr) { console.error("[demo-data] cleanup of partial demo failed:", cleanupErr); }
    }
    return { success: false, error: err instanceof Error ? err.message : "Could not load sample data" };
  }
}

export async function removeSampleData(): Promise<{ success: boolean; error?: string }> {
  try {
    // requireOwnerOrAbove (not requireOwnerWrite) so a FROZEN owner can still clear
    // the demo — parity with self-service branch deletion.
    const profile = await requireOwnerOrAbove();
    const ownerId = profile.id;
    const admin = createAdminClient();

    // Find THIS owner's demo branch. Guard on is_demo AND billing_active=false so
    // this can never target a real, billable branch. limit(1) tolerates a legacy dup.
    const { data: demoRows } = await admin
      .from("hms_hostels")
      .select("id, is_demo, billing_active")
      .eq("owner_id", ownerId)
      .eq("is_demo", true)
      .order("created_at", { ascending: true })
      .limit(1);
    const demo = demoRows?.[0] as { id: string; billing_active?: boolean } | undefined;
    if (!demo?.id) return { success: true }; // nothing to remove
    if (demo.billing_active === true) {
      return { success: false, error: "This branch is not a sample branch." };
    }
    const demoId = demo.id;

    // A real branch to fall back into after the demo is gone.
    const { data: realRows } = await admin
      .from("hms_hostels")
      .select("id")
      .eq("owner_id", ownerId)
      .neq("id", demoId)
      .order("created_at", { ascending: true })
      .limit(1);
    const realBranchId = (realRows?.[0] as { id: string } | undefined)?.id ?? null;

    // Never leave the owner with zero branches — refuse if the demo is somehow
    // their only remaining property (e.g. they self-deleted their real branch).
    if (!realBranchId) {
      return { success: false, error: "Add or keep at least one real property before removing the sample data." };
    }

    // Atomic teardown (deactivates residents, detaches CRM leads, drops junction +
    // hostel via cascade). No Paddle reconcile needed — a billing_active=false demo
    // never affected the tier.
    const { error: delErr } = await admin.rpc("hms_delete_branch_atomic", { p_hostel_id: demoId });
    if (delErr) throw new Error(delErr.message);

    await switchActiveHostel(realBranchId);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[demo-data] removeSampleData failed:", err);
    return { success: false, error: err instanceof Error ? err.message : "Could not remove sample data" };
  }
}
