"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";

// Salary advances — see migration 160.
//
// An advance is a loan against future salary, so the money and the debt move
// separately: cash leaves on advance_date, staff cost stays the gross salary,
// and the balance follows the employee month to month until it is recovered or
// written off. All of that arithmetic lives here rather than in the client,
// because the staff page writes through the browser SDK and a half-applied
// deduction would silently corrupt what an employee is owed.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 10_000_000;

async function guard(): Promise<string> {
  // Same gate as recording a salary payment: this hands over real cash.
  // Managers never see the staff page at all, so owner/partner-full is the
  // whole surface.
  await requireOwnerOrPartnerTier("full");
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
  return ctx.hostelId;
}

function money(value: unknown, label: string): number {
  const n = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
  if (n <= 0) throw new Error(`${label} must be greater than zero`);
  if (n > MAX_AMOUNT) throw new Error(`${label} is unrealistically large`);
  return n;
}

export interface AdvanceRow {
  id: string;
  employee_id: string;
  amount: number;
  advance_date: string;
  payment_method: string | null;
  receipt_number: string | null;
  notes: string | null;
  recovered_amount: number;
  written_off_amount: number;
  written_off_date: string | null;
  balance: number;
  status: "outstanding" | "partially_recovered" | "recovered" | "written_off";
  created_at: string;
}

// ── Give an advance ─────────────────────────────────────────────────────────

export async function giveSalaryAdvance(input: {
  employeeId: string;
  amount: number;
  advanceDate: string;
  paymentMethod?: string | null;
  receiptNumber?: string | null;
  notes?: string | null;
}): Promise<{ advance?: AdvanceRow; error?: string }> {
  try {
    const hostelId = await guard();
    if (!UUID_RE.test(input.employeeId)) throw new Error("Invalid employee");
    const amount = money(input.amount, "Advance amount");

    const admin = createAdminClient();

    // Re-scope the employee to the caller's branch. The admin client below
    // bypasses RLS, so this is the only thing stopping an employee id from
    // another hostel being used.
    const { data: employee } = await admin
      .from("hms_employees")
      .select("id, full_name, status")
      .eq("id", input.employeeId)
      .eq("hostel_id", hostelId)
      .maybeSingle();
    if (!employee) throw new Error("Employee not found for this branch");

    const { data, error } = await admin
      .from("hms_salary_advances")
      .insert({
        hostel_id: hostelId,
        employee_id: input.employeeId,
        amount,
        advance_date: input.advanceDate,
        payment_method: input.paymentMethod ?? null,
        receipt_number: input.receiptNumber ?? null,
        notes: input.notes ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    revalidatePath("/staff");
    revalidatePath("/reports");
    return { advance: data as AdvanceRow };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Pay a salary, netting off however much of the advance the owner chooses ──

/**
 * Record a salary payment and the advance deduction in one operation.
 *
 * `deduct` is whatever the owner typed — the dialog pre-fills it with the full
 * outstanding balance, but they can lower it (the employee keeps owing the
 * rest into next month) or zero it entirely. Anything not deducted simply stays
 * on the balance; nothing is written off implicitly.
 *
 * Oldest advance first, so a balance cannot sit around indefinitely while newer
 * ones are settled ahead of it.
 */
export async function paySalaryWithAdvance(input: {
  salaryPaymentId: string;
  deduct: number;
  paymentMethod: string;
  paymentDate: string;
  receiptNumber?: string | null;
  notes?: string | null;
}): Promise<{ netPaid?: number; deducted?: number; error?: string }> {
  try {
    const hostelId = await guard();
    if (!UUID_RE.test(input.salaryPaymentId)) throw new Error("Invalid salary record");

    const deduct = Math.round(Number(input.deduct ?? 0) * 100) / 100;
    if (!Number.isFinite(deduct) || deduct < 0) throw new Error("Deduction must be zero or more");

    const admin = createAdminClient();

    const { data: salary } = await admin
      .from("hms_salary_payments")
      .select("id, employee_id, amount, status, advance_deducted")
      .eq("id", input.salaryPaymentId)
      .eq("hostel_id", hostelId)
      .maybeSingle();
    if (!salary) throw new Error("Salary record not found for this branch");

    const gross = Number(salary.amount ?? 0);
    if (deduct > gross) {
      throw new Error(`Deduction cannot exceed the salary of ${gross.toLocaleString()}`);
    }

    // Outstanding advances, oldest first.
    const { data: advances } = await admin
      .from("hms_salary_advances")
      .select("id, balance")
      .eq("hostel_id", hostelId)
      .eq("employee_id", salary.employee_id)
      .gt("balance", 0)
      .order("advance_date", { ascending: true })
      .order("created_at", { ascending: true });

    const outstanding = (advances ?? []).reduce((s, a) => s + Number(a.balance ?? 0), 0);
    if (deduct > outstanding) {
      throw new Error(
        `Deduction exceeds the outstanding advance of ${outstanding.toLocaleString()}`
      );
    }

    // Spread the deduction across advances, oldest first. Recorded per advance
    // rather than as one lump so that later — reversing a payment, or auditing
    // which debt a deduction settled — the answer is on file rather than
    // reconstructed.
    let left = deduct;
    for (const adv of advances ?? []) {
      if (left <= 0) break;
      const take = Math.min(left, Number(adv.balance ?? 0));
      if (take <= 0) continue;

      const { error: recErr } = await admin
        .from("hms_salary_advance_recoveries")
        .upsert(
          {
            hostel_id: hostelId,
            advance_id: adv.id,
            salary_payment_id: salary.id,
            amount: take,
          },
          { onConflict: "advance_id,salary_payment_id" }
        );
      if (recErr) throw new Error(recErr.message);
      left -= take;
    }

    const { error: payErr } = await admin
      .from("hms_salary_payments")
      .update({
        status: "paid",
        payment_method: input.paymentMethod,
        payment_date: input.paymentDate,
        receipt_number: input.receiptNumber ?? null,
        notes: input.notes ?? null,
        advance_deducted: deduct,
      })
      .eq("id", salary.id)
      .eq("hostel_id", hostelId);
    if (payErr) throw new Error(payErr.message);

    revalidatePath("/staff");
    revalidatePath("/reports");
    return { netPaid: gross - deduct, deducted: deduct };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Write off what will never come back ─────────────────────────────────────

/**
 * Give up on an unrecovered balance — an employee who left still owing.
 *
 * Booked as an hms_expenses row dated the day it is written off, NOT against
 * the month the advance was given. Every month you have already closed and read
 * stays exactly as it was; the loss shows up as today's cost, which is also how
 * an accountant would treat a bad debt.
 *
 * Category 'other' because hms_expenses' CHECK has no staff category and
 * widening it would touch every hostel's expense form for this one case.
 */
export async function writeOffSalaryAdvance(input: {
  advanceId: string;
  date: string;
  notes?: string | null;
}): Promise<{ writtenOff?: number; error?: string }> {
  try {
    const hostelId = await guard();
    if (!UUID_RE.test(input.advanceId)) throw new Error("Invalid advance");

    const admin = createAdminClient();

    const { data: advance } = await admin
      .from("hms_salary_advances")
      .select("id, employee_id, balance, written_off_amount, employee:hms_employees(full_name)")
      .eq("id", input.advanceId)
      .eq("hostel_id", hostelId)
      .maybeSingle();
    if (!advance) throw new Error("Advance not found for this branch");

    const balance = Number(advance.balance ?? 0);
    if (balance <= 0) throw new Error("This advance has nothing left to write off");

    const empRaw = (advance as unknown as { employee: { full_name: string } | { full_name: string }[] | null }).employee;
    const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
    const name = emp?.full_name ?? "Employee";

    const { data: expense, error: expErr } = await admin
      .from("hms_expenses")
      .insert({
        hostel_id: hostelId,
        title: `Salary advance written off — ${name}`,
        amount: balance,
        category: "other",
        date: input.date,
        notes: input.notes ?? "Unrecovered salary advance",
      })
      .select("id")
      .single();
    if (expErr) throw new Error(expErr.message);

    const { error: advErr } = await admin
      .from("hms_salary_advances")
      .update({
        written_off_amount: Number(advance.written_off_amount ?? 0) + balance,
        written_off_date: input.date,
        written_off_expense_id: expense.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", advance.id)
      .eq("hostel_id", hostelId);

    if (advErr) {
      // Never leave an expense booked against a debt that still reads as owed.
      await admin.from("hms_expenses").delete().eq("id", expense.id);
      throw new Error(advErr.message);
    }

    revalidatePath("/staff");
    revalidatePath("/expenses");
    revalidatePath("/reports");
    return { writtenOff: balance };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Delete (correcting a mistake, not settling a debt) ──────────────────────

export async function deleteSalaryAdvance(
  advanceId: string
): Promise<{ error?: string }> {
  try {
    const hostelId = await guard();
    if (!UUID_RE.test(advanceId)) throw new Error("Invalid advance");

    const admin = createAdminClient();
    const { data: advance } = await admin
      .from("hms_salary_advances")
      .select("id, recovered_amount, written_off_amount")
      .eq("id", advanceId)
      .eq("hostel_id", hostelId)
      .maybeSingle();
    if (!advance) throw new Error("Advance not found for this branch");

    // Deleting a partly-settled advance would silently unwind salary payments
    // that have already been handed over. Correcting a typo is fine; erasing
    // history is not.
    if (Number(advance.recovered_amount ?? 0) > 0 || Number(advance.written_off_amount ?? 0) > 0) {
      throw new Error(
        "This advance has already been partly recovered or written off — it can no longer be deleted."
      );
    }

    const { error } = await admin
      .from("hms_salary_advances")
      .delete()
      .eq("id", advanceId)
      .eq("hostel_id", hostelId);
    if (error) throw new Error(error.message);

    revalidatePath("/staff");
    revalidatePath("/reports");
    return {};
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
