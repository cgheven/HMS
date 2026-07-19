"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"

// A plain <Link href="/login"> can't work here: middleware redirects any
// authenticated user off /login back to /, which routes a manager to /portal
// and straight back to this page. The session has to actually be cleared first.
export function PortalSignOutLink() {
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    await createClient().auth.signOut()
    window.location.href = "/login"
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={signingOut}
      className="inline-block mt-6 text-sm text-amber/80 hover:text-amber underline-offset-4 hover:underline transition-colors disabled:opacity-50"
    >
      {signingOut ? "Signing out…" : "Sign out and return to login"}
    </button>
  )
}
