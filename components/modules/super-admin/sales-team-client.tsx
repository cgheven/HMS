"use client"

import { useState, useTransition, useMemo } from "react"
import {
  Plus, Eye, EyeOff, Copy, Check, Loader2, KeyRound, Trash2,
  Power, Trophy, Users2, Pencil, AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { EMAIL_RE, PHONE_RE } from "@/lib/validation"
import {
  createSalesRep,
  updateSalesRep,
  createSalesRepLogin,
  resetSalesRepLoginPassword,
  setSalesRepActive,
  deleteSalesRep,
  upsertSalesTarget,
} from "@/app/actions/sales-reps"
import type { SalesPerformanceRow } from "@/app/actions/leads"
import type { SalesRep, SalesTarget } from "@/types"

interface SalesTeamClientProps {
  initialReps: SalesRep[]
  initialPerformance: SalesPerformanceRow[]
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-1.5 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Add Sales Rep Modal
// ---------------------------------------------------------------------------

function AddRepModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (rep: SalesRep) => void
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [loading, setLoading] = useState(false)
  const [emailError, setEmailError] = useState("")
  const [phoneError, setPhoneError] = useState("")

  const handleClose = () => {
    setName(""); setEmail(""); setPhone(""); setEmailError(""); setPhoneError(""); setLoading(false)
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    let hasError = false
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError("Enter a valid email address.")
      hasError = true
    }
    if (!PHONE_RE.test(phone.replace(/\D/g, ""))) {
      setPhoneError("Enter a valid mobile number (7–15 digits).")
      hasError = true
    }
    if (hasError) return
    setEmailError(""); setPhoneError("")
    setLoading(true)
    const result = await createSalesRep(name.trim(), email.trim(), phone.trim())
    setLoading(false)
    if ("error" in result) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    onCreated(result.rep)
    toast({ title: "Sales rep added" })
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Sales Rep</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rep-name">Full Name</Label>
            <Input
              id="rep-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ali Hassan"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-email">Email</Label>
            <Input
              id="rep-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError("") }}
              placeholder="ali@example.com"
              disabled={loading}
            />
            {emailError && <p className="text-xs text-rose-400">{emailError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-phone">Mobile Number</Label>
            <Input
              id="rep-phone"
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhoneError("") }}
              placeholder="03XXXXXXXXX"
              disabled={loading}
            />
            {phoneError && <p className="text-xs text-rose-400">{phoneError}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !email.trim() || !phone.trim()}
            className="bg-amber text-black hover:bg-amber/90"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Add Rep
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Edit Sales Rep Modal
// ---------------------------------------------------------------------------

function EditRepModal({
  rep,
  open,
  onOpenChange,
  onSaved,
}: {
  rep: SalesRep
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: (updated: SalesRep) => void
}) {
  const [name, setName] = useState(rep.name)
  const [email, setEmail] = useState(rep.email ?? "")
  const [phone, setPhone] = useState(rep.phone)
  const [loading, setLoading] = useState(false)
  const [emailError, setEmailError] = useState("")
  const [phoneError, setPhoneError] = useState("")

  const handleSubmit = async () => {
    let hasError = false
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError("Enter a valid email address.")
      hasError = true
    }
    if (!PHONE_RE.test(phone.replace(/\D/g, ""))) {
      setPhoneError("Enter a valid mobile number (7–15 digits).")
      hasError = true
    }
    if (hasError) return
    setEmailError(""); setPhoneError("")
    setLoading(true)
    const result = await updateSalesRep(rep.id, {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
    })
    setLoading(false)
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    onSaved({ ...rep, name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim() })
    toast({ title: "Sales rep updated" })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {rep.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {rep.has_login && (
            <p className="text-xs text-amber/80 bg-amber/5 border border-amber/20 rounded-lg px-3 py-2">
              This rep already has a login — changing the email here also updates the address they sign in with.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="edit-rep-name">Full Name</Label>
            <Input id="edit-rep-name" value={name} onChange={(e) => setName(e.target.value)} disabled={loading} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-rep-email">Email</Label>
            <Input
              id="edit-rep-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError("") }}
              placeholder="ali@example.com"
              disabled={loading}
            />
            {emailError && <p className="text-xs text-rose-400">{emailError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-rep-phone">Mobile Number</Label>
            <Input
              id="edit-rep-phone"
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhoneError("") }}
              disabled={loading}
            />
            {phoneError && <p className="text-xs text-rose-400">{phoneError}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !email.trim() || !phone.trim()}
            className="bg-amber text-black hover:bg-amber/90"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Login Modal (adapted from managers-client's one-time-credentials pattern)
// ---------------------------------------------------------------------------

function LoginModal({
  rep,
  open,
  onOpenChange,
  onLoginCreated,
}: {
  rep: SalesRep
  open: boolean
  onOpenChange: (o: boolean) => void
  onLoginCreated: (updated: SalesRep) => void
}) {
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const handleClose = () => {
    setCredentials(null)
    setShowPassword(false)
    onOpenChange(false)
  }

  const handleCreate = async () => {
    setLoading(true)
    const result = await createSalesRepLogin(rep.id)
    setLoading(false)
    if ("error" in result) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    setCredentials(result)
    onLoginCreated({ ...rep, has_login: true })
  }

  const handleReset = async () => {
    setLoading(true)
    const result = await resetSalesRepLoginPassword(rep.id)
    setLoading(false)
    if ("error" in result) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    setCredentials({ email: rep.email ?? "", password: result.password })
    toast({ title: "Password reset" })
  }

  const getWhatsAppMessage = () => {
    if (!credentials) return ""
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return (
      `*HMS Sales Rep Login Credentials*\n\n` +
      `Login URL: ${origin}/sales/login\n` +
      `Email: ${credentials.email}\n` +
      `Password: ${credentials.password}\n\n` +
      `_Please keep this confidential._`
    )
  }

  // wa.me needs a full international number (no leading 0) — assume Pakistan
  // (+92) since local numbers here are entered in 03XXXXXXXXX format.
  const getWhatsAppNumber = () => {
    const digits = rep.phone.replace(/\D/g, "")
    if (digits.startsWith("92")) return digits
    if (digits.startsWith("0")) return `92${digits.slice(1)}`
    return `92${digits}`
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {rep.has_login ? "Sales Rep Login" : "Create Login"} — {rep.name}
          </DialogTitle>
        </DialogHeader>

        {!credentials ? (
          <div className="py-4 space-y-4">
            {!rep.has_login ? (
              !rep.email ? (
                <p className="text-sm text-rose-400 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  Add an email address for this rep first (use Edit) — logins are email-based.
                </p>
              ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Generate login credentials for this sales rep. The password will be shown once.
                </p>
                <Button
                  onClick={handleCreate}
                  disabled={loading}
                  className="w-full bg-amber text-black hover:bg-amber/90"
                >
                  {loading
                    ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    : <KeyRound className="w-4 h-4 mr-2" />}
                  Create Login
                </Button>
              </>
              )
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  This sales rep already has a login. You can reset their password below.
                </p>
                <Button
                  onClick={handleReset}
                  disabled={loading}
                  variant="outline"
                  className="w-full"
                >
                  {loading
                    ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    : <KeyRound className="w-4 h-4 mr-2" />}
                  Reset Password
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="py-2 space-y-4">
            <div className="rounded-xl border border-amber/20 bg-amber/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Email</span>
                <div className="flex items-center">
                  <span className="text-sm font-mono">{credentials.email}</span>
                  <CopyButton value={credentials.email} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Password</span>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-mono">
                    {showPassword ? credentials.password : "•".repeat(credentials.password.length)}
                  </span>
                  <button
                    onClick={() => setShowPassword((v) => !v)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword
                      ? <EyeOff className="w-3.5 h-3.5" />
                      : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <CopyButton value={credentials.password} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Login URL</span>
                <div className="flex items-center">
                  <span className="text-sm font-mono text-amber/80">
                    {typeof window !== "undefined" ? window.location.origin : ""}/sales/login
                  </span>
                  <CopyButton value={`${typeof window !== "undefined" ? window.location.origin : ""}/sales/login`} />
                </div>
              </div>
            </div>

            <p className="text-xs text-amber/70 bg-amber/5 border border-amber/10 rounded-lg px-3 py-2">
              Save these credentials now — the password cannot be retrieved after closing this window.
            </p>

            <Button
              onClick={() => {
                const msg = getWhatsAppMessage()
                const number = getWhatsAppNumber()
                window.open(`https://wa.me/${number}?text=${encodeURIComponent(msg)}`, "_blank")
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Share via WhatsApp — {rep.phone}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Inline Target Editor
// ---------------------------------------------------------------------------

function TargetEditor({
  rep,
  onSaved,
}: {
  rep: SalesRep
  onSaved: (target: SalesTarget) => void
}) {
  const t = rep.target
  const [dailyCalls, setDailyCalls] = useState(String(t?.daily_calls_target ?? 0))
  const [dailyVisits, setDailyVisits] = useState(String(t?.daily_visits_target ?? 0))
  const [weeklyCalls, setWeeklyCalls] = useState(String(t?.weekly_calls_target ?? 0))
  const [weeklyVisits, setWeeklyVisits] = useState(String(t?.weekly_visits_target ?? 0))
  const [saving, setSaving] = useState(false)

  const parsed = {
    daily_calls_target: Number(dailyCalls),
    daily_visits_target: Number(dailyVisits),
    weekly_calls_target: Number(weeklyCalls),
    weekly_visits_target: Number(weeklyVisits),
  }
  const valid = Object.values(parsed).every((v) => Number.isInteger(v) && v >= 0)

  const handleSave = async () => {
    if (!valid) {
      toast({ title: "Invalid targets", description: "All targets must be whole numbers 0 or greater.", variant: "destructive" })
      return
    }
    setSaving(true)
    const result = await upsertSalesTarget(rep.id, parsed)
    setSaving(false)
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    onSaved({ sales_rep_id: rep.id, ...parsed, updated_at: new Date().toISOString() })
    toast({ title: "Targets saved" })
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground font-normal">Daily Calls</Label>
        <Input type="number" min={0} value={dailyCalls} onChange={(e) => setDailyCalls(e.target.value)} className="h-8 w-16 text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground font-normal">Daily Visits</Label>
        <Input type="number" min={0} value={dailyVisits} onChange={(e) => setDailyVisits(e.target.value)} className="h-8 w-16 text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground font-normal">Weekly Calls</Label>
        <Input type="number" min={0} value={weeklyCalls} onChange={(e) => setWeeklyCalls(e.target.value)} className="h-8 w-16 text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground font-normal">Weekly Visits</Label>
        <Input type="number" min={0} value={weeklyVisits} onChange={(e) => setWeeklyVisits(e.target.value)} className="h-8 w-16 text-xs" />
      </div>
      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleSave} disabled={saving || !valid}>
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Performance Leaderboard
// ---------------------------------------------------------------------------

function pct(value: number, target: number): number {
  if (target > 0) return Math.min(100, Math.round((value / target) * 100))
  return value > 0 ? 100 : 0
}

function MiniBar({ label, value, target }: { label: string; value: number; target: number }) {
  const p = pct(value, target)
  const color = p >= 100 ? "bg-emerald-400" : p >= 50 ? "bg-amber" : "bg-rose-400"
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span>{value}/{target}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}

function PerformanceSection({ performance }: { performance: SalesPerformanceRow[] }) {
  const sorted = useMemo(() => {
    return [...performance].sort((a, b) => {
      const scoreA = (pct(a.today.calls, a.target?.daily_calls_target ?? 0) + pct(a.today.visits, a.target?.daily_visits_target ?? 0)) / 2
      const scoreB = (pct(b.today.calls, b.target?.daily_calls_target ?? 0) + pct(b.today.visits, b.target?.daily_visits_target ?? 0)) / 2
      return scoreB - scoreA
    })
  }, [performance])

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] py-12 text-center">
        <Trophy className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No active sales reps to show performance for.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sorted.map((row, idx) => (
        <div key={row.salesRep.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {idx === 0 && <Trophy className="w-3.5 h-3.5 text-amber" />}
              <span className="font-semibold text-sm">{row.salesRep.name}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{row.leadsAssigned} assigned</span>
              <span>{row.leadsConverted} converted</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Today</p>
              <MiniBar label="Calls" value={row.today.calls} target={row.target?.daily_calls_target ?? 0} />
              <MiniBar label="Visits" value={row.today.visits} target={row.target?.daily_visits_target ?? 0} />
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">This Week</p>
              <MiniBar label="Calls" value={row.week.calls} target={row.target?.weekly_calls_target ?? 0} />
              <MiniBar label="Visits" value={row.week.visits} target={row.target?.weekly_visits_target ?? 0} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main SalesTeamClient
// ---------------------------------------------------------------------------

export function SalesTeamClient({ initialReps, initialPerformance }: SalesTeamClientProps) {
  const [reps, setReps] = useState<SalesRep[]>(initialReps)
  const [isPending, startTransition] = useTransition()

  const [addOpen, setAddOpen] = useState(false)
  const [editModal, setEditModal] = useState<{ open: boolean; rep: SalesRep | null }>({ open: false, rep: null })
  const [loginModal, setLoginModal] = useState<{ open: boolean; rep: SalesRep | null }>({ open: false, rep: null })
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; rep: SalesRep | null }>({ open: false, rep: null })
  const [deleting, setDeleting] = useState(false)

  const updateLocal = (updated: SalesRep) => {
    setReps((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
  }

  const handleToggleActive = (rep: SalesRep) => {
    const nextActive = !rep.is_active
    setReps((prev) => prev.map((r) => (r.id === rep.id ? { ...r, is_active: nextActive } : r)))
    startTransition(async () => {
      const result = await setSalesRepActive(rep.id, nextActive)
      if (result.error) {
        toast({ title: "Error", description: result.error, variant: "destructive" })
        setReps((prev) => prev.map((r) => (r.id === rep.id ? { ...r, is_active: rep.is_active } : r)))
      } else {
        toast({ title: nextActive ? "Rep activated" : "Rep deactivated" })
      }
    })
  }

  const handleDelete = async () => {
    if (!deleteConfirm.rep) return
    setDeleting(true)
    const result = await deleteSalesRep(deleteConfirm.rep.id)
    setDeleting(false)
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    setReps((prev) => prev.filter((r) => r.id !== deleteConfirm.rep!.id))
    setDeleteConfirm({ open: false, rep: null })
    toast({ title: "Sales rep deleted" })
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sales Team</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage reps, logins, targets, and performance</p>
        </div>
        <Button
          onClick={() => setAddOpen(true)}
          className="bg-amber text-black hover:bg-amber/90"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Sales Rep
        </Button>
      </div>

      {/* Reps list */}
      {reps.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] py-16 text-center">
          <Users2 className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No sales reps yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add a rep to start assigning leads.</p>
          <Button
            onClick={() => setAddOpen(true)}
            className="mt-4 bg-amber text-black hover:bg-amber/90"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add Sales Rep
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {reps.map((rep) => (
            <div
              key={rep.id}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{rep.name}</span>
                    {rep.email ? (
                      <span className="text-xs text-muted-foreground font-mono">{rep.email}</span>
                    ) : (
                      <Badge className="gap-1 text-[10px] bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/10">
                        <AlertTriangle className="w-3 h-3" />
                        No email set
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground/60 font-mono">{rep.phone}</span>
                    {rep.has_login ? (
                      <Badge className="gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                        Active Login
                      </Badge>
                    ) : (
                      <Badge className="gap-1 text-[10px] bg-white/5 text-muted-foreground border-white/10 hover:bg-white/5">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 inline-block" />
                        No Login
                      </Badge>
                    )}
                    {rep.is_active ? (
                      <Badge className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/10">
                        Active
                      </Badge>
                    ) : (
                      <Badge className="text-[10px] bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/10">
                        Inactive
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setEditModal({ open: true, rep })}
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleToggleActive(rep)}
                    disabled={isPending}
                    title={rep.is_active ? "Deactivate" : "Activate"}
                  >
                    <Power className="w-3.5 h-3.5 mr-1" />
                    {rep.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setLoginModal({ open: true, rep })}
                    title={rep.has_login ? "Reset Password" : "Create Login"}
                  >
                    <KeyRound className="w-3.5 h-3.5 mr-1" />
                    {rep.has_login ? "Reset" : "Login"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10"
                    onClick={() => setDeleteConfirm({ open: true, rep })}
                    title="Delete Sales Rep"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <TargetEditor rep={rep} onSaved={(target) => updateLocal({ ...rep, target })} />
            </div>
          ))}
        </div>
      )}

      {/* Performance leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber" />
            Performance
          </CardTitle>
          <CardDescription>Sorted by today&apos;s target completion — best performers first.</CardDescription>
        </CardHeader>
        <CardContent>
          <PerformanceSection performance={initialPerformance} />
        </CardContent>
      </Card>

      {/* Modals */}
      <AddRepModal
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(rep) => setReps((prev) => [rep, ...prev])}
      />

      {editModal.rep && (
        <EditRepModal
          rep={editModal.rep}
          open={editModal.open}
          onOpenChange={(o) => setEditModal((s) => ({ ...s, open: o }))}
          onSaved={(updated) => updateLocal(updated)}
        />
      )}

      {loginModal.rep && (
        <LoginModal
          rep={loginModal.rep}
          open={loginModal.open}
          onOpenChange={(o) => setLoginModal((s) => ({ ...s, open: o }))}
          onLoginCreated={(updated) => updateLocal(updated)}
        />
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        title="Delete Sales Rep"
        description={`Remove ${deleteConfirm.rep?.name ?? "this sales rep"}? This also revokes their login access and unassigns their leads.`}
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm({ open: false, rep: null })}
      />
    </div>
  )
}
