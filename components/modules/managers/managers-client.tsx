"use client"

import { useState } from "react"
import {
  Plus, Edit2, Trash2, Building2, ShieldCheck,
  Eye, EyeOff, Copy, Check, Loader2, KeyRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/hooks/use-toast"
import {
  createManager,
  updateManagerPermissions,
  updateManagerHostels,
  createManagerLogin,
  resetManagerPassword,
  deleteManager,
} from "@/app/actions/managers"
import type { Manager, StaffPermission } from "@/types"

interface ManagersClientProps {
  hostelId:         string | null
  managers:         Manager[]
  availableHostels: { id: string; name: string }[]
}

const PERMISSION_LABELS: Record<StaffPermission, string> = {
  add_members:           "Add Members",
  collect_payments:      "Collect Payments",
  add_expenses:          "Add Expenses",
  add_kitchen_expenses:  "Add Kitchen Expenses",
  edit_members:          "Edit Members",
  edit_expenses:         "Edit Expenses",
  edit_kitchen_expenses: "Edit Kitchen Expenses",
  manage_rooms:          "Manage Rooms (Add/Edit)",
}

// Delete is intentionally absent everywhere — no delete permission exists for
// any of these areas. Room/tenant deletion always stays owner/full-partner only.
const ALL_PERMISSIONS: StaffPermission[] = [
  "add_members", "edit_members",
  "collect_payments",
  "add_expenses", "edit_expenses",
  "add_kitchen_expenses", "edit_kitchen_expenses",
  "manage_rooms",
]

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
// Create Manager Modal
// ---------------------------------------------------------------------------

function CreateManagerModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (m: Manager) => void
}) {
  const [name, setName]     = useState("")
  const [phone, setPhone]   = useState("")
  const [loading, setLoading] = useState(false)
  const [phoneError, setPhoneError] = useState("")

  const handleClose = () => {
    setName(""); setPhone(""); setPhoneError(""); setLoading(false)
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    const normalizedPhone = phone.replace(/\D/g, "")
    if (!/^\d{7,15}$/.test(normalizedPhone)) {
      setPhoneError("Enter a valid mobile number (digits only, 7–15 digits).")
      return
    }
    setPhoneError("")
    setLoading(true)
    const result = await createManager(name.trim(), phone)
    setLoading(false)
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    if (result.manager) {
      onCreated(result.manager)
      toast({ title: "Manager created" })
      handleClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Manager</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="mgr-name">Full Name</Label>
            <Input
              id="mgr-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ali Hassan"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mgr-phone">Mobile Number</Label>
            <Input
              id="mgr-phone"
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
            disabled={loading || !name.trim() || !phone.trim()}
            className="bg-amber text-black hover:bg-amber/90"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Create Manager
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Permissions Modal
// ---------------------------------------------------------------------------

function PermissionsModal({
  manager,
  open,
  onOpenChange,
  onSaved,
}: {
  manager: Manager
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: (updated: Manager) => void
}) {
  const [selected, setSelected] = useState<Set<StaffPermission>>(
    new Set((manager.permissions ?? []) as StaffPermission[])
  )
  const [loading, setLoading] = useState(false)

  const toggle = (p: StaffPermission) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  const handleSave = async () => {
    setLoading(true)
    const perms = [...selected]
    const result = await updateManagerPermissions(manager.id, perms)
    setLoading(false)
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    onSaved({ ...manager, permissions: perms })
    toast({ title: "Permissions updated" })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Permissions — {manager.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {ALL_PERMISSIONS.map((p) => (
            <div key={p} className="flex items-center gap-3">
              <input
                type="checkbox"
                id={`perm-${p}`}
                checked={selected.has(p)}
                onChange={() => toggle(p)}
                disabled={loading}
                className="w-4 h-4 accent-amber cursor-pointer"
              />
              <Label htmlFor={`perm-${p}`} className="cursor-pointer font-normal">
                {PERMISSION_LABELS[p]}
              </Label>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={loading}
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
// Branch Assignment Modal
// ---------------------------------------------------------------------------

function BranchModal({
  manager,
  availableHostels,
  open,
  onOpenChange,
  onSaved,
}: {
  manager: Manager
  availableHostels: { id: string; name: string }[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: (updated: Manager) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set((manager.hostels ?? []).map((h) => h.id))
  )
  const [loading, setLoading] = useState(false)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    setLoading(true)
    const hostelIds = [...selected]
    const result = await updateManagerHostels(manager.id, hostelIds)
    setLoading(false)
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    const updatedHostels = availableHostels.filter((h) => selected.has(h.id))
    onSaved({ ...manager, hostels: updatedHostels })
    toast({ title: "Branches updated" })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Branch Access — {manager.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {availableHostels.length === 0 && (
            <p className="text-sm text-muted-foreground">No hostels found.</p>
          )}
          {availableHostels.map((h) => (
            <div key={h.id} className="flex items-center gap-3">
              <input
                type="checkbox"
                id={`hostel-${h.id}`}
                checked={selected.has(h.id)}
                onChange={() => toggle(h.id)}
                disabled={loading}
                className="w-4 h-4 accent-amber cursor-pointer"
              />
              <Label htmlFor={`hostel-${h.id}`} className="cursor-pointer font-normal">
                {h.name}
              </Label>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={loading}
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
// Login Modal
// ---------------------------------------------------------------------------

function LoginModal({
  manager,
  open,
  onOpenChange,
  onLoginCreated,
}: {
  manager: Manager
  open: boolean
  onOpenChange: (o: boolean) => void
  onLoginCreated: (updated: Manager) => void
}) {
  const [credentials, setCredentials] = useState<{ phone: string; password: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const handleClose = () => {
    setCredentials(null)
    setShowPassword(false)
    onOpenChange(false)
  }

  const handleCreate = async () => {
    setLoading(true)
    const result = await createManagerLogin(manager.id)
    setLoading(false)
    if ("error" in result) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    setCredentials(result)
    onLoginCreated({ ...manager, has_login: true })
  }

  const handleReset = async () => {
    setLoading(true)
    const result = await resetManagerPassword(manager.id)
    setLoading(false)
    if ("error" in result) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    setCredentials({ phone: manager.phone, password: result.password })
    toast({ title: "Password reset" })
  }

  const getWhatsAppMessage = () => {
    if (!credentials) return ""
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return (
      `Assalam o Alaikum ${manager.name},\n\n` +
      `Here are your login details for Pulse:\n\n` +
      `Login: ${origin}/login\n` +
      `Mobile Number: ${credentials.phone}\n` +
      `Password: ${credentials.password}\n\n` +
      `_Please keep this confidential._`
    )
  }

  // wa.me REQUIRES the number in the path — "wa.me/?text=" is not a supported
  // format and silently fails to open a compose window on most platforms, which
  // is why this button appeared to do nothing. Pakistani numbers are stored as
  // 03xx…, so strip formatting and swap the leading 0 for the 92 country code.
  // api.whatsapp.com/send is the documented phone-less fallback.
  const getWhatsAppUrl = () => {
    const text = encodeURIComponent(getWhatsAppMessage())
    const digits = (credentials?.phone ?? manager.phone ?? "").replace(/\D/g, "").replace(/^0/, "92")
    return digits ? `https://wa.me/${digits}?text=${text}` : `https://api.whatsapp.com/send?text=${text}`
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {manager.has_login ? "Manager Login" : "Create Login"} — {manager.name}
          </DialogTitle>
        </DialogHeader>

        {!credentials ? (
          <div className="py-4 space-y-4">
            {!manager.has_login ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Generate login credentials for this manager. The password will be shown once.
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
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  This manager already has a login. You can reset their password below.
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
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Mobile Number</span>
                <div className="flex items-center">
                  <span className="text-sm font-mono">{credentials.phone}</span>
                  <CopyButton value={credentials.phone} />
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

              <div className="space-y-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Login URL</span>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-amber/80 break-all">
                    {typeof window !== "undefined" ? window.location.origin : ""}/login
                  </span>
                  <CopyButton value={`${typeof window !== "undefined" ? window.location.origin : ""}/login`} />
                </div>
              </div>
            </div>

            <p className="text-xs text-amber/70 bg-amber/5 border border-amber/10 rounded-lg px-3 py-2">
              Save these credentials now — the password cannot be retrieved after closing this window.
            </p>

            <Button
              onClick={() => window.open(getWhatsAppUrl(), "_blank", "noopener,noreferrer")}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Send to {manager.phone || "WhatsApp"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main ManagersClient
// ---------------------------------------------------------------------------

export function ManagersClient({ managers: initial, availableHostels, hostelId: _ }: ManagersClientProps) {
  const [managers, setManagers] = useState<Manager[]>(initial)

  const [createOpen, setCreateOpen] = useState(false)
  const [permissionsModal, setPermissionsModal] = useState<{ open: boolean; manager: Manager | null }>({ open: false, manager: null })
  const [branchModal, setBranchModal]           = useState<{ open: boolean; manager: Manager | null }>({ open: false, manager: null })
  const [loginModal, setLoginModal]             = useState<{ open: boolean; manager: Manager | null }>({ open: false, manager: null })
  const [deleteConfirm, setDeleteConfirm]       = useState<{ open: boolean; manager: Manager | null }>({ open: false, manager: null })
  const [deleting, setDeleting] = useState(false)

  const updateLocal = (updated: Manager) => {
    setManagers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
  }

  const handleDelete = async () => {
    if (!deleteConfirm.manager) return
    setDeleting(true)
    const result = await deleteManager(deleteConfirm.manager.id)
    setDeleting(false)
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    setManagers((prev) => prev.filter((m) => m.id !== deleteConfirm.manager!.id))
    setDeleteConfirm({ open: false, manager: null })
    toast({ title: "Manager deleted" })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Managers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage portal access and permissions</p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-amber text-black hover:bg-amber/90"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Manager
        </Button>
      </div>

      {/* Empty state */}
      {managers.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] py-16 text-center">
          <ShieldCheck className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No managers yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add a manager to delegate hostel operations.</p>
          <Button
            onClick={() => setCreateOpen(true)}
            className="mt-4 bg-amber text-black hover:bg-amber/90"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add Manager
          </Button>
        </div>
      )}

      {/* Manager list */}
      {managers.length > 0 && (
        <div className="space-y-3">
          {managers.map((manager) => (
            <div
              key={manager.id}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="space-y-2 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{manager.name}</span>
                  <span className="text-xs text-muted-foreground font-mono">{manager.phone}</span>
                  {manager.has_login ? (
                    <Badge className="gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                      Active
                    </Badge>
                  ) : (
                    <Badge className="gap-1 text-[10px] bg-white/5 text-muted-foreground border-white/10 hover:bg-white/5">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 inline-block" />
                      No Login
                    </Badge>
                  )}
                </div>

                {/* Permissions */}
                <div className="flex flex-wrap gap-1.5">
                  {ALL_PERMISSIONS.map((p) => {
                    const active = (manager.permissions ?? []).includes(p)
                    return (
                      <span
                        key={p}
                        className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                          active
                            ? "bg-amber/10 text-amber border-amber/20"
                            : "bg-white/5 text-muted-foreground/40 border-white/5"
                        }`}
                      >
                        {PERMISSION_LABELS[p]}
                      </span>
                    )
                  })}
                </div>

                {/* Branches */}
                {(manager.hostels ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(manager.hostels ?? []).map((h) => (
                      <span
                        key={h.id}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      >
                        {h.name}
                      </span>
                    ))}
                  </div>
                )}
                {(manager.hostels ?? []).length === 0 && (
                  <p className="text-[10px] text-amber/60">No branches assigned — manager cannot access portal.</p>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setPermissionsModal({ open: true, manager })}
                  title="Edit Permissions"
                >
                  <Edit2 className="w-3.5 h-3.5 mr-1" />
                  Permissions
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setBranchModal({ open: true, manager })}
                  title="Assign Branches"
                >
                  <Building2 className="w-3.5 h-3.5 mr-1" />
                  Branches
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setLoginModal({ open: true, manager })}
                  title={manager.has_login ? "Reset Password" : "Create Login"}
                >
                  <KeyRound className="w-3.5 h-3.5 mr-1" />
                  {manager.has_login ? "Reset" : "Login"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10"
                  onClick={() => setDeleteConfirm({ open: true, manager })}
                  title="Delete Manager"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      <CreateManagerModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(m) => setManagers((prev) => [m, ...prev])}
      />

      {permissionsModal.manager && (
        <PermissionsModal
          manager={permissionsModal.manager}
          open={permissionsModal.open}
          onOpenChange={(o) => setPermissionsModal((s) => ({ ...s, open: o }))}
          onSaved={(updated) => { updateLocal(updated); setPermissionsModal({ open: false, manager: null }) }}
        />
      )}

      {branchModal.manager && (
        <BranchModal
          manager={branchModal.manager}
          availableHostels={availableHostels}
          open={branchModal.open}
          onOpenChange={(o) => setBranchModal((s) => ({ ...s, open: o }))}
          onSaved={(updated) => { updateLocal(updated); setBranchModal({ open: false, manager: null }) }}
        />
      )}

      {loginModal.manager && (
        <LoginModal
          manager={loginModal.manager}
          open={loginModal.open}
          onOpenChange={(o) => setLoginModal((s) => ({ ...s, open: o }))}
          onLoginCreated={(updated) => { updateLocal(updated) }}
        />
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        title="Delete Manager"
        description={`Remove ${deleteConfirm.manager?.name ?? "this manager"}? This also revokes their login access.`}
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm({ open: false, manager: null })}
      />
    </div>
  )
}
