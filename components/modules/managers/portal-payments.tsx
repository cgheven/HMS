"use client"

import { useState, useTransition } from "react"
import { CreditCard, Loader2, CheckCircle2, AlertCircle, Zap, BanknoteIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/hooks/use-toast"
import {
  recordPaymentAsManager,
  applyRoomACUnitsAsManager,
  saveACJoinReadingAsManager,
} from "@/app/actions/managers"

interface PortalPaymentRow {
  id: string
  tenant_id: string
  for_month: string
  amount: number
  late_fee: number
  status: "pending" | "overdue"
  tenantName: string
  roomNumber: string | null
  packageTier: string | null
  acUnitsConsumed: number
  acCharge: number
}

interface ACRoom      { id: string; room_number: string }
interface ACReading   { room_id: string; total_units: number; per_unit_rate: number; tenant_count: number }
interface ACJoinRead  { room_id: string; tenant_id: string; units_at_join: number; for_month: string }
interface ACTenant    { id: string; full_name: string; room_id: string | null; package_tier: string | null; check_in: string }

interface PortalPaymentsProps {
  payments: PortalPaymentRow[]
  hostelId: string
  month: string
  acUnitRate: number
  acRooms: ACRoom[]
  acReadings: ACReading[]
  acJoinReadings: ACJoinRead[]
  acTenants: ACTenant[]
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  jazzcash: "JazzCash",
  easypaisa: "EasyPaisa",
  other: "Other",
}

// ── Pay modal ────────────────────────────────────────────────────────────────

function PayModal({
  payment,
  acUnitRate,
  open,
  onOpenChange,
  onPaid,
}: {
  payment: PortalPaymentRow
  acUnitRate: number
  open: boolean
  onOpenChange: (o: boolean) => void
  onPaid: () => void
}) {
  const isAcTier   = payment.packageTier === "space_food_ac"
  const defaultTotal = payment.amount + payment.late_fee

  const [amount, setAmount]   = useState(String(defaultTotal))
  const [method, setMethod]   = useState("cash")
  const [acUnits, setAcUnits] = useState("")
  const [error, setError]     = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const computedAcCharge =
    isAcTier && acUnits !== "" && Number.isInteger(Number(acUnits))
      ? Number(acUnits) * acUnitRate
      : null

  const handleClose = () => {
    setAmount(String(defaultTotal))
    setMethod("cash")
    setAcUnits("")
    setError(null)
    onOpenChange(false)
  }

  const handleConfirm = () => {
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) { setError("Enter a valid amount."); return }
    if (isAcTier && acUnits === "") { setError("Enter AC units consumed for this month."); return }
    const parsedUnits = isAcTier ? parseInt(acUnits, 10) : undefined
    if (isAcTier && (!Number.isInteger(parsedUnits) || parsedUnits! < 0)) {
      setError("AC units must be a whole number (0 or more).")
      return
    }
    setError(null)

    startTransition(async () => {
      const result = await recordPaymentAsManager(payment.tenant_id, parsed, method, payment.for_month, parsedUnits)
      if (result.error) { setError(result.error); return }
      toast({ title: "Payment recorded" })
      onPaid()
      handleClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark Paid — {payment.tenantName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-white/[0.03] border border-white/10 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Month: </span>
            <span className="font-medium">{payment.for_month}</span>
            {payment.late_fee > 0 && (
              <span className="ml-2 text-xs text-amber/70">(includes Rs. {payment.late_fee.toLocaleString()} late fee)</span>
            )}
          </div>

          {isAcTier && (
            <div className="space-y-1.5">
              <Label htmlFor="ac-units" className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber" />
                AC Units Consumed
              </Label>
              <Input
                id="ac-units"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 120"
                value={acUnits}
                onChange={(e) => setAcUnits(e.target.value)}
                disabled={isPending}
              />
              {computedAcCharge !== null && (
                <p className="text-xs text-muted-foreground">
                  AC charge: <span className="text-foreground font-medium">Rs. {computedAcCharge.toLocaleString()}</span>
                  {acUnitRate > 0 && <span className="ml-1">@ Rs. {acUnitRate}/unit</span>}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount Collected (Rs.)</Label>
            <Input
              id="pay-amount"
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pay-method">Payment Method</Label>
            <Select value={method} onValueChange={setMethod} disabled={isPending}>
              <SelectTrigger id="pay-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(METHOD_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={isPending} className="bg-amber text-black hover:bg-amber/90">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── AC Billing section ────────────────────────────────────────────────────────

function ACBillingSection({
  acRooms,
  acReadings,
  acJoinReadings,
  acTenants,
  payments,
  month,
}: {
  acRooms: ACRoom[]
  acReadings: ACReading[]
  acJoinReadings: ACJoinRead[]
  acTenants: ACTenant[]
  payments: PortalPaymentRow[]
  month: string
}) {
  const [units, setUnits]         = useState<Record<string, string>>({})
  const [applying, setApplying]   = useState<string | null>(null)
  const [joinUnits, setJoinUnits] = useState<Record<string, string>>({})
  const [savingJoin, setSavingJoin] = useState<string | null>(null)

  if (acRooms.length === 0) return null

  async function handleApply(roomId: string) {
    const val = Number(units[roomId] ?? "")
    if (!Number.isFinite(val) || val < 0) return
    setApplying(roomId)
    const result = await applyRoomACUnitsAsManager(roomId, month, val)
    setApplying(null)
    if (result.error) {
      toast({ title: "AC Billing Error", description: result.error, variant: "destructive" })
    } else {
      toast({
        title: val === 0 ? "AC charge cleared" : "AC units applied",
        description: val === 0
          ? "AC charges removed for all tenants in this room."
          : `${result.eligibleCount} tenant${result.eligibleCount === 1 ? "" : "s"} · ${result.perTenantUnits} units each · Rs. ${result.perTenantCharge?.toLocaleString()} each`,
      })
    }
  }

  async function handleSaveJoinReading(roomId: string, tenantId: string) {
    const key = `${tenantId}_${month}`
    const val = parseFloat(joinUnits[key] ?? "")
    if (!Number.isFinite(val) || val < 0) return
    setSavingJoin(tenantId)
    const result = await saveACJoinReadingAsManager(roomId, month, tenantId, val)
    setSavingJoin(null)
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
    } else {
      toast({ title: "Join reading saved" })
    }
  }

  const displayMonth = (() => {
    const [y, m] = month.split("-").map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString("en-PK", { month: "long", year: "numeric" })
  })()

  return (
    <div className="space-y-2">
        {acRooms.map((room) => {
          const saved           = acReadings.find((r) => r.room_id === room.id)
          const midMonthJoiners = acTenants.filter((t) => t.room_id === room.id && t.check_in.startsWith(month))
          const tenantsInRoom   = acTenants.filter((t) => t.room_id === room.id)

          // Per-tenant breakdown rows (only when AC units have been allocated)
          const breakdownRows = tenantsInRoom
            .map((t) => {
              const p = payments.find((pay) => pay.tenant_id === t.id)
              return { name: t.full_name, units: p?.acUnitsConsumed ?? 0, charge: p?.acCharge ?? 0 }
            })
            .filter((r) => r.units > 0)

          return (
            <div key={room.id} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 space-y-3">
              {/* Room header + units input */}
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Room {room.room_number}</p>
                  {saved ? (
                    <p className="text-xs text-emerald-400 mt-0.5">
                      {saved.total_units} units saved · Rs. {saved.per_unit_rate}/unit · {saved.tenant_count} tenant{saved.tenant_count === 1 ? "" : "s"} billed
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground/50 mt-0.5">No reading for this month yet</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={99999}
                    placeholder="Units"
                    value={units[room.id] ?? ""}
                    onChange={(e) => setUnits((prev) => ({ ...prev, [room.id]: e.target.value }))}
                    className="w-28 h-9 text-sm text-center"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 px-4 text-xs gap-1.5 bg-amber/10 text-amber border border-amber/25 hover:bg-amber/20 disabled:opacity-40"
                    disabled={applying === room.id || !units[room.id] || units[room.id] === ""}
                    onClick={() => handleApply(room.id)}
                  >
                    {applying === room.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Zap className="w-3 h-3" />}
                    Apply
                  </Button>
                </div>
              </div>

              {/* Mid-month joiners */}
              {midMonthJoiners.length > 0 && (
                <div className="border-t border-white/5 pt-3 space-y-2">
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">Mid-month joiners</p>
                    <p className="text-[10px] text-muted-foreground/40 mt-0.5">meter reading when they joined</p>
                  </div>
                  {midMonthJoiners.map((tenant) => {
                    const key     = `${tenant.id}_${month}`
                    const already = acJoinReadings.find((r) => r.tenant_id === tenant.id && r.for_month === month)
                    const edited  = joinUnits[key] !== undefined
                    const isSaved = !!already && !edited
                    return (
                      <div key={tenant.id} className="flex items-center gap-2">
                        <p className="flex-1 min-w-0 text-xs text-muted-foreground truncate">{tenant.full_name}</p>
                        <Input
                          type="number"
                          min={0}
                          max={99999}
                          placeholder={already ? String(already.units_at_join) : "Units at join"}
                          value={joinUnits[key] ?? ""}
                          onChange={(e) => setJoinUnits((prev) => ({ ...prev, [key]: e.target.value }))}
                          className="w-32 h-8 text-xs text-center"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`h-8 px-3 text-xs gap-1.5 shrink-0 ${
                            isSaved
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-white/5 text-muted-foreground border border-white/10 hover:text-foreground"
                          }`}
                          disabled={savingJoin === tenant.id || (!joinUnits[key] && !isSaved)}
                          onClick={() => handleSaveJoinReading(room.id, tenant.id)}
                        >
                          {savingJoin === tenant.id
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : isSaved
                              ? <CheckCircle2 className="w-3 h-3" />
                              : <Zap className="w-3 h-3" />}
                          {isSaved ? "Saved" : "Save"}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Per-tenant allocation breakdown */}
              {breakdownRows.length > 0 && (
                <div className="border-t border-white/5 pt-3 space-y-1.5">
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">Allocated per tenant</p>
                  {breakdownRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 min-w-0 truncate text-muted-foreground">{row.name}</span>
                      <span className="text-muted-foreground/60">{row.units} units</span>
                      <span className="text-emerald-400 font-medium w-20 text-right">Rs. {row.charge.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-xs border-t border-white/5 pt-1.5 mt-1">
                    <span className="flex-1 font-medium">Total</span>
                    <span className="text-muted-foreground/60">{breakdownRows.reduce((s, r) => s + r.units, 0)} units</span>
                    <span className="text-emerald-400 font-semibold w-20 text-right">
                      Rs. {breakdownRows.reduce((s, r) => s + r.charge, 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PortalPayments({
  payments: initial,
  month,
  acUnitRate,
  acRooms,
  acReadings,
  acJoinReadings,
  acTenants,
}: PortalPaymentsProps) {
  const [payments, setPayments]       = useState<PortalPaymentRow[]>(initial)
  const [activeModal, setActiveModal] = useState<PortalPaymentRow | null>(null)

  const markPaid = (id: string) => setPayments((prev) => prev.filter((p) => p.id !== id))

  const displayMonth = (() => {
    const [y, m] = month.split("-").map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString("en-PK", { month: "long", year: "numeric" })
  })()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{displayMonth}</p>
      </div>

      <Tabs defaultValue="payments">
        <TabsList className="mb-4">
          <TabsTrigger value="payments" className="gap-1.5 data-[state=active]:bg-amber data-[state=active]:text-black data-[state=active]:shadow-none">
            <BanknoteIcon className="w-3.5 h-3.5" />
            Collections
            {payments.length > 0 && (
              <span className="ml-1 rounded-full bg-black/20 text-[10px] font-semibold px-1.5 py-0.5 leading-none">
                {payments.length}
              </span>
            )}
          </TabsTrigger>
          {acRooms.length > 0 && (
            <TabsTrigger value="ac" className="gap-1.5 data-[state=active]:bg-amber data-[state=active]:text-black data-[state=active]:shadow-none">
              <Zap className="w-3.5 h-3.5" />
              AC Billing
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="payments" className="mt-0">
          {payments.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] py-16 text-center">
              <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">All caught up</p>
              <p className="text-xs text-muted-foreground/60 mt-1">No pending or overdue payments this month.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{payment.tenantName}</span>
                      {payment.roomNumber && (
                        <span className="text-xs text-muted-foreground">Room {payment.roomNumber}</span>
                      )}
                      {payment.packageTier === "space_food_ac" && (
                        <Badge className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20 gap-1 hover:bg-blue-500/10">
                          <Zap className="w-2.5 h-2.5" />
                          AC
                        </Badge>
                      )}
                      {payment.status === "overdue" ? (
                        <Badge className="text-[10px] bg-rose-500/10 text-rose-400 border-rose-500/20 gap-1 hover:bg-rose-500/10">
                          <AlertCircle className="w-2.5 h-2.5" />
                          Overdue
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] bg-amber/10 text-amber border-amber/20 hover:bg-amber/10">
                          Pending
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-semibold mt-0.5">
                      Rs. {(payment.amount + payment.late_fee).toLocaleString()}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => setActiveModal(payment)}
                    className="shrink-0 bg-amber text-black hover:bg-amber/90 h-8 px-3"
                  >
                    <CreditCard className="w-3.5 h-3.5 mr-1.5" />
                    Mark Paid
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {acRooms.length > 0 && (
          <TabsContent value="ac" className="mt-0">
            <ACBillingSection
              acRooms={acRooms}
              acReadings={acReadings}
              acJoinReadings={acJoinReadings}
              acTenants={acTenants}
              payments={payments}
              month={month}
            />
          </TabsContent>
        )}
      </Tabs>

      {activeModal && (
        <PayModal
          payment={activeModal}
          acUnitRate={acUnitRate}
          open={!!activeModal}
          onOpenChange={(o) => { if (!o) setActiveModal(null) }}
          onPaid={() => markPaid(activeModal.id)}
        />
      )}
    </div>
  )
}
