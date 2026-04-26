"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function check() {
      try {
        const supabase = createClient();
        const { data: { user }, error: authErr } = await supabase.auth.getUser();
        if (authErr || !user) return;

        const { data, error } = await supabase
          .from("hms_profiles")
          .select("is_admin")
          .eq("id", user.id)
          .single();

        if (error) return;
        if (mounted) setIsAdmin(data?.is_admin ?? false);
      } catch {
        // non-fatal — user just won't see admin link
      } finally {
        if (mounted) setChecked(true);
      }
    }

    check();
    return () => { mounted = false; };
  }, []);

  return { isAdmin, checked };
}
