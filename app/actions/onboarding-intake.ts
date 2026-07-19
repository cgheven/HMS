"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOnboardingSubmittedEmail } from "@/lib/email";
import { EMPTY_ONBOARDING_BRANCH, EMPTY_ONBOARDING_CONFIG } from "@/types";
import type { OnboardingData } from "@/types";

// The intake form is deliberately unauthenticated — a prospect filling it in
// has no account yet, that is the whole point. The token IS the credential, so
// every function here proves possession of it before touching a row, and all
// access uses the service-role client (the table is RLS deny-all for anon).

const MAX_DRAFTS_PER_IP_PER_HOUR = 10;
const MAX_BRANCHES = 25;
const MAX_PARTNERS = 20;
const MAX_PAYMENT_METHODS = 15;
// A fully-filled draft is a few KB. This is a backstop against someone using an
// autosave endpoint they can reach without logging in as free storage.
const MAX_DATA_BYTES = 128 * 1024;

function emptyData(): OnboardingData {
  return {
    owner: { name: "", email: "", phone: "" },
    branches: [{ ...EMPTY_ONBOARDING_BRANCH }],
    config: { ...EMPTY_ONBOARDING_CONFIG },
    partners: [],
    furthestStep: 0,
  };
}

async function callerIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip");
}

/**
 * Start a new draft and return its token. The caller redirects to
 * /onboarding/<token>, which is the resumable URL — closing the tab and
 * reopening that link restores everything typed so far.
 */
export async function createOnboardingDraft(): Promise<{ token?: string; error?: string }> {
  try {
    const admin = createAdminClient();
    const ip = await callerIp();

    if (ip) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await admin
        .from("hms_onboarding_submissions")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ip)
        .gte("created_at", since);
      if ((count ?? 0) >= MAX_DRAFTS_PER_IP_PER_HOUR) {
        return { error: "Too many setup links created from this network. Please try again later." };
      }
    }

    const { data, error } = await admin
      .from("hms_onboarding_submissions")
      .insert({ data: emptyData(), ip_address: ip })
      .select("token")
      .single();

    if (error) throw new Error(error.message);
    return { token: (data as { token: string }).token };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start setup." };
  }
}

export interface LoadedDraft {
  data: OnboardingData;
  status: "draft" | "submitted" | "provisioned" | "abandoned";
}

export async function loadOnboardingDraft(
  token: string
): Promise<{ draft?: LoadedDraft; error?: string }> {
  try {
    if (!token) return { error: "Missing setup link." };
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("hms_onboarding_submissions")
      .select("data, status")
      .eq("token", token)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return { error: "This setup link is not valid." };

    const row = data as { data: OnboardingData; status: LoadedDraft["status"] };
    // Merge over a fresh skeleton so a draft saved by an older version of the
    // wizard never renders with missing keys.
    const merged: OnboardingData = {
      ...emptyData(),
      ...row.data,
      owner: { ...emptyData().owner, ...(row.data?.owner ?? {}) },
      config: { ...EMPTY_ONBOARDING_CONFIG, ...(row.data?.config ?? {}) },
      branches: row.data?.branches?.length ? row.data.branches : [{ ...EMPTY_ONBOARDING_BRANCH }],
      partners: row.data?.partners ?? [],
    };
    return { draft: { data: merged, status: row.status } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load your setup." };
  }
}

function validateShape(data: OnboardingData): string | null {
  if (!Array.isArray(data.branches)) return "Invalid branches.";
  if (data.branches.length === 0) return "At least one branch is required.";
  if (data.branches.length > MAX_BRANCHES) return `A maximum of ${MAX_BRANCHES} branches is supported.`;
  if (!Array.isArray(data.partners)) return "Invalid partners.";
  if (data.partners.length > MAX_PARTNERS) return `A maximum of ${MAX_PARTNERS} partners is supported.`;
  const methods = data.config?.payment_methods;
  if (methods && methods.length > MAX_PAYMENT_METHODS) {
    return `A maximum of ${MAX_PAYMENT_METHODS} payment methods is supported.`;
  }
  if (JSON.stringify(data).length > MAX_DATA_BYTES) return "This form is too large to save.";
  return null;
}

/**
 * Autosave. Called on a debounce as the owner types, so it must stay cheap and
 * must never reject a half-finished form — only structural limits are enforced
 * here. Completeness is checked in submitOnboardingDraft instead.
 */
export async function saveOnboardingDraft(
  token: string,
  data: OnboardingData
): Promise<{ error?: string }> {
  try {
    if (!token) return { error: "Missing setup link." };
    const shapeError = validateShape(data);
    if (shapeError) return { error: shapeError };

    const admin = createAdminClient();
    // Guard on status as well as token: once submitted or provisioned the draft
    // is a record of what was agreed, and must not keep mutating.
    const { data: rows, error } = await admin
      .from("hms_onboarding_submissions")
      .update({ data })
      .eq("token", token)
      .eq("status", "draft")
      .select("id");

    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return { error: "This setup has already been submitted." };
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save." };
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitOnboardingDraft(
  token: string,
  data: OnboardingData
): Promise<{ success?: boolean; error?: string }> {
  try {
    if (!token) return { error: "Missing setup link." };
    const shapeError = validateShape(data);
    if (shapeError) return { error: shapeError };

    if (!data.owner?.name?.trim()) return { error: "Your name is required." };
    if (!EMAIL_RE.test(data.owner?.email?.trim() ?? "")) return { error: "A valid email address is required." };
    if (data.branches.some((b) => !b.name?.trim())) return { error: "Every branch needs a name." };

    for (const p of data.partners) {
      if (!p.email?.trim() && !p.name?.trim()) continue;
      if (!EMAIL_RE.test(p.email?.trim() ?? "")) {
        return { error: `Partner "${p.name || "unnamed"}" needs a valid email address.` };
      }
    }

    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("hms_onboarding_submissions")
      .update({ data, status: "submitted", submitted_at: new Date().toISOString() })
      .eq("token", token)
      .eq("status", "draft")
      .select("id");

    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return { error: "This setup has already been submitted." };

    // Notify, but never at the cost of the submission. The form is already
    // saved by this point; if Resend is down or misconfigured, the owner must
    // still see success rather than being told to fill it all in again.
    try {
      await sendOnboardingSubmittedEmail({
        ownerName: data.owner.name.trim(),
        ownerEmail: data.owner.email.trim(),
        ownerPhone: data.owner.phone?.trim() || "—",
        branches: data.branches.map((b) => ({
          name: b.name,
          city: b.city,
          area: b.area,
          total_capacity: b.total_capacity,
        })),
        partnerCount: data.partners.filter((p) => p.email?.trim()).length,
        acRate: data.config?.ac_per_unit_rate || "0",
        securityDeposit: data.config?.security_deposit || "0",
        noticeDays: data.config?.notice_period_days || "30",
      });
    } catch (mailErr) {
      console.error("[submitOnboardingDraft] notification email failed:", mailErr);
    }

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not submit." };
  }
}
