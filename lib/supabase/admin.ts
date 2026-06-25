import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only — NEVER import this in client components
// Uses service_role key which bypasses RLS
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in environment variables");
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      // Prevent Next.js Data Cache from storing Supabase responses —
      // admin reads must always reflect the latest DB state.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
