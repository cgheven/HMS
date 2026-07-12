"use server"

import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { requireSuperAdmin } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit"
import { EMAIL_RE, PHONE_RE } from "@/lib/validation"
import type { SalesRep, SalesTarget } from "@/types"

function generateSalesRepPassword(): string {
  const upper   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const lower   = "abcdefghijklmnopqrstuvwxyz"
  const digits  = "0123456789"
  const special = "@#$!&"
  const all     = upper + lower + digits + special

  // Rejection-sampling avoids modulo bias for any charset length.
  function pick(set: string): string {
    const max = Math.floor(256 / set.length) * set.length
    let byte: number
    do { byte = randomBytes(1)[0] } while (byte >= max)
    return set[byte % set.length]
  }

  const chars = [
    pick(upper),
    pick(lower),
    pick(digits),
    pick(special),
    ...Array.from({ length: 4 }, () => pick(all)),
  ]

  // Fisher-Yates shuffle with rejection-sampled index
  for (let i = chars.length - 1; i > 0; i--) {
    const max = Math.floor(256 / (i + 1)) * (i + 1)
    let byte: number
    do { byte = randomBytes(1)[0] } while (byte >= max)
    const j = byte % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join("")
}

function flattenTarget(row: SalesRep & { target: SalesTarget[] | SalesTarget | null }): SalesRep {
  const { target, ...rest } = row
  return { ...rest, target: Array.isArray(target) ? (target[0] ?? null) : (target ?? null) }
}

export async function listSalesReps(): Promise<{ reps: SalesRep[] } | { error: string }> {
  await requireSuperAdmin()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("hms_sales_reps")
    .select("*, target:hms_sales_targets(*)")
    .order("created_at", { ascending: false })

  if (error) return { error: error.message }

  const reps = (data ?? []).map((row) =>
    flattenTarget(row as SalesRep & { target: SalesTarget[] | SalesTarget | null })
  )

  return { reps }
}

export async function createSalesRep(
  name: string,
  email: string,
  phone: string,
): Promise<{ rep: SalesRep } | { error: string }> {
  const profile = await requireSuperAdmin()

  const trimmedName = name.trim()
  if (trimmedName.length < 2) return { error: "Name must be at least 2 characters." }

  const trimmedEmail = email.trim().toLowerCase()
  if (!EMAIL_RE.test(trimmedEmail)) return { error: "Enter a valid email address." }

  // Required, not optional — needed to actually reach the rep and to share
  // login credentials over WhatsApp.
  const normalizedPhone = phone.replace(/\D/g, "")
  if (!PHONE_RE.test(normalizedPhone)) {
    return { error: "Enter a valid mobile number (7–15 digits)." }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("hms_sales_reps")
    .insert({ created_by: profile.id, name: trimmedName, email: trimmedEmail, phone: normalizedPhone })
    .select("*")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { error: "A sales rep with this email or phone already exists." }
    }
    return { error: error.message }
  }

  revalidatePath("/super-admin/sales-team")
  return { rep: { ...data, target: null } as SalesRep }
}

export async function updateSalesRep(
  repId: string,
  input: { name?: string; email?: string; phone?: string },
): Promise<{ error: string | null }> {
  const caller = await requireSuperAdmin()

  const admin = createAdminClient()
  const { data: rep } = await admin
    .from("hms_sales_reps")
    .select("id, supabase_user_id")
    .eq("id", repId)
    .single()
  if (!rep) return { error: "Sales rep not found." }

  const updates: Record<string, unknown> = {}

  if (input.name !== undefined) {
    const trimmedName = input.name.trim()
    if (trimmedName.length < 2) return { error: "Name must be at least 2 characters." }
    updates.name = trimmedName
  }

  let newEmail: string | undefined
  if (input.email !== undefined) {
    newEmail = input.email.trim().toLowerCase()
    if (!EMAIL_RE.test(newEmail)) return { error: "Enter a valid email address." }
    updates.email = newEmail
  }

  if (input.phone !== undefined) {
    const normalizedPhone = input.phone.replace(/\D/g, "")
    if (!PHONE_RE.test(normalizedPhone)) {
      return { error: "Enter a valid mobile number (7–15 digits)." }
    }
    updates.phone = normalizedPhone
  }

  const { error } = await admin.from("hms_sales_reps").update(updates).eq("id", repId)
  if (error) {
    if (error.code === "23505") return { error: "Another sales rep already uses this email or phone." }
    return { error: error.message }
  }

  // The rep's actual login credential (their auth user's email) must move together
  // with the DB record — otherwise editing here silently desyncs them and the rep
  // keeps signing in with the old address while the admin thinks it changed.
  if (newEmail && rep.supabase_user_id) {
    const { error: authError } = await admin.auth.admin.updateUserById(rep.supabase_user_id, {
      email: newEmail,
      email_confirm: true,
    })
    if (authError) {
      // Mirrors the partial-failure logging in deleteSalesRep — the DB row and the
      // actual login email are now out of sync until this is retried; leave a trail.
      await writeAuditLog({
        actor_id: caller.id,
        actor_email: "",
        action: "sales_rep.email_sync_partial_failure",
        entity: "sales_rep",
        entity_id: repId,
        meta: { supabase_user_id: rep.supabase_user_id, attempted_email: newEmail, auth_error: authError.message },
      })
      return { error: `Saved, but syncing the login email failed: ${authError.message}` }
    }
  }

  revalidatePath("/super-admin/sales-team")
  return { error: null }
}

export async function createSalesRepLogin(
  repId: string,
): Promise<{ email: string; password: string } | { error: string }> {
  await requireSuperAdmin()

  const admin = createAdminClient()

  const { data: rep } = await admin
    .from("hms_sales_reps")
    .select("id, email, has_login, supabase_user_id")
    .eq("id", repId)
    .single()

  if (!rep) return { error: "Sales rep not found." }
  if (!rep.email) return { error: "Add an email address for this sales rep before creating a login." }

  if (rep.has_login && rep.supabase_user_id) {
    return { error: "This sales rep already has a login. Use Reset Password instead." }
  }

  const password = generateSalesRepPassword()

  const { data: authData, error: createError } = await admin.auth.admin.createUser({
    email: rep.email,
    password,
    email_confirm: true,
    user_metadata: { role: "sales_rep", sales_rep_id: repId },
  })

  if (createError || !authData?.user) {
    return { error: createError?.message ?? "Failed to create auth user." }
  }

  const { error: updateError } = await admin
    .from("hms_sales_reps")
    .update({ supabase_user_id: authData.user.id, has_login: true })
    .eq("id", repId)

  if (updateError) {
    // DB update failed after the auth user was created — roll it back to avoid an orphaned login.
    await admin.auth.admin.deleteUser(authData.user.id)
    return { error: updateError.message }
  }

  revalidatePath("/super-admin/sales-team")
  return { email: rep.email, password }
}

export async function resetSalesRepLoginPassword(
  repId: string,
): Promise<{ password: string } | { error: string }> {
  await requireSuperAdmin()

  const admin = createAdminClient()

  const { data: rep } = await admin
    .from("hms_sales_reps")
    .select("id, supabase_user_id")
    .eq("id", repId)
    .single()

  if (!rep) return { error: "Sales rep not found." }
  if (!rep.supabase_user_id) return { error: "This sales rep does not have an active login." }

  const password = generateSalesRepPassword()

  const { error } = await admin.auth.admin.updateUserById(rep.supabase_user_id, { password })
  if (error) return { error: error.message }

  revalidatePath("/super-admin/sales-team")
  return { password }
}

export async function setSalesRepActive(
  repId: string,
  isActive: boolean,
): Promise<{ error: string | null }> {
  await requireSuperAdmin()

  const admin = createAdminClient()
  const { error } = await admin
    .from("hms_sales_reps")
    .update({ is_active: isActive })
    .eq("id", repId)

  if (error) return { error: error.message }

  revalidatePath("/super-admin/sales-team")
  return { error: null }
}

export async function deleteSalesRep(
  repId: string,
): Promise<{ error: string | null }> {
  const caller = await requireSuperAdmin()

  const admin = createAdminClient()

  const { data: rep } = await admin
    .from("hms_sales_reps")
    .select("id, supabase_user_id")
    .eq("id", repId)
    .single()

  if (!rep) return { error: "Sales rep not found." }

  // Delete DB row first (FKs are ON DELETE SET NULL / CASCADE, so this is safe).
  // Only then delete the auth user — if DB delete fails, the auth user is preserved
  // and the data stays consistent.
  const { error: dbError } = await admin
    .from("hms_sales_reps")
    .delete()
    .eq("id", repId)

  if (dbError) return { error: dbError.message }

  if (rep.supabase_user_id) {
    const { error: authError } = await admin.auth.admin.deleteUser(rep.supabase_user_id)
    if (authError) {
      // GoTrue deletion failed. The hms_sales_reps row is already gone so portal access is
      // blocked, but the auth user's hms_profiles row would survive. Delete it directly
      // so this user can never authenticate as anything else again.
      await admin.from("hms_profiles").delete().eq("id", rep.supabase_user_id)
      // Flag for ops: the actual auth.users row (and any still-valid session) is not
      // automatically retried today and may need manual admin.auth.admin.deleteUser().
      await writeAuditLog({
        actor_id: caller.id,
        actor_email: "",
        action: "sales_rep.delete_partial_failure",
        entity: "sales_rep",
        entity_id: repId,
        meta: { supabase_user_id: rep.supabase_user_id, auth_error: authError.message },
      })
    }
  }

  revalidatePath("/super-admin/sales-team")
  return { error: null }
}

export async function upsertSalesTarget(
  repId: string,
  targets: {
    daily_calls_target: number
    daily_visits_target: number
    weekly_calls_target: number
    weekly_visits_target: number
  },
): Promise<{ error: string | null }> {
  await requireSuperAdmin()

  for (const [key, value] of Object.entries(targets)) {
    if (!Number.isInteger(value) || value < 0) {
      return { error: `${key} must be a whole number greater than or equal to 0.` }
    }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("hms_sales_targets")
    .upsert(
      { sales_rep_id: repId, ...targets, updated_at: new Date().toISOString() },
      { onConflict: "sales_rep_id" },
    )

  if (error) return { error: error.message }

  revalidatePath("/super-admin/sales-team")
  return { error: null }
}
