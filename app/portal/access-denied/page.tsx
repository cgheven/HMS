import { ShieldOff } from "lucide-react"
import { PortalSignOutLink } from "./sign-out-link"

export default function AccessDeniedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center max-w-sm mx-auto">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 mx-auto mb-6">
          <ShieldOff className="w-8 h-8 text-rose-400" />
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-foreground">Access Denied</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          You don&apos;t have any permissions assigned yet, or no hostel branch is assigned to your account.
        </p>

        <div className="mt-6 rounded-xl bg-white/[0.03] border border-white/10 px-4 py-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Contact your hostel admin</p>
          <p>Ask them to assign you to a branch and enable the permissions you need.</p>
        </div>

        <PortalSignOutLink />
      </div>
    </div>
  )
}
