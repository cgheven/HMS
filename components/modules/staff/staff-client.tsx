"use client";
import { useState, useMemo } from "react";
import {
  Plus, Search, Edit2, Trash2, UserCog, Wallet, HandCoins, MessageCircle,
  CheckCircle2, Clock, Users, TrendingDown,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { giveSalaryAdvance, paySalaryWithAdvance, writeOffSalaryAdvance, deleteSalaryAdvance } from "@/app/actions/salary-advances";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { QuickAddTray } from "@/components/ui/quick-add-tray";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { cn, formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import type { Employee, EmployeeRole, EmployeeStatus, SalaryPayment, SalaryAdvance, PaymentMethod, PartnerTier } from "@/types";

const ROLES: { value: EmployeeRole; label: string; icon: string }[] = [
  { value: "cook",    label: "Cook",    icon: "👨‍🍳" },
  { value: "guard",   label: "Guard",   icon: "🛡️" },
  { value: "cleaner", label: "Cleaner", icon: "🧹" },
  { value: "manager", label: "Manager", icon: "👔" },
  { value: "driver",  label: "Driver",  icon: "🚗" },
  { value: "other",   label: "Other",   icon: "👤" },
];

const QUICK_STAFF: { label: string; role: EmployeeRole }[] = [
  { label: "Cook",         role: "cook"    },
  { label: "Head Cook",    role: "cook"    },
  { label: "Helper Cook",  role: "cook"    },
  { label: "Night Guard",  role: "guard"   },
  { label: "Day Guard",    role: "guard"   },
  { label: "Security",     role: "guard"   },
  { label: "Cleaner",      role: "cleaner" },
  { label: "Sweeper",      role: "cleaner" },
  { label: "Warden",       role: "manager" },
  { label: "Manager",      role: "manager" },
  { label: "Receptionist", role: "manager" },
  { label: "Driver",       role: "driver"  },
  { label: "Electrician",  role: "other"   },
  { label: "Plumber",      role: "other"   },
  { label: "Laundry",      role: "other"   },
];

const ROLE_CHIP: Record<EmployeeRole, string> = {
  cook:    "bg-amber-500/10  border-amber-500/25  text-amber-400  hover:bg-amber-500/20",
  guard:   "bg-blue-500/10   border-blue-500/25   text-blue-400   hover:bg-blue-500/20",
  cleaner: "bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20",
  manager: "bg-purple-500/10 border-purple-500/25 text-purple-400 hover:bg-purple-500/20",
  driver:  "bg-orange-500/10 border-orange-500/25 text-orange-400 hover:bg-orange-500/20",
  other:   "bg-white/5       border-white/10      text-muted-foreground hover:bg-white/10",
};

const roleConfig: Record<EmployeeRole, { label: string; icon: string; color: string }> = {
  cook:    { label: "Cook",    icon: "👨‍🍳", color: "text-amber" },
  guard:   { label: "Guard",   icon: "🛡️",  color: "text-blue-400" },
  cleaner: { label: "Cleaner", icon: "🧹",  color: "text-emerald-400" },
  manager: { label: "Manager", icon: "👔",  color: "text-purple-400" },
  driver:  { label: "Driver",  icon: "🚗",  color: "text-orange-400" },
  other:   { label: "Other",   icon: "👤",  color: "text-muted-foreground" },
};

const methodLabels: Record<PaymentMethod, string> = {
  cash: "Cash", bank_transfer: "Bank Transfer",
  jazzcash: "JazzCash", easypaisa: "Easypaisa",
  sadapay: "SadaPay", other: "Other",
};

const emptyForm = {
  full_name: "", role: "other" as EmployeeRole, phone: "", cnic: "",
  join_date: formatDateInput(new Date()), monthly_salary: "", status: "active" as EmployeeStatus, notes: "",
};

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function genReceipt(name: string, month: string) {
  const initials = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  return `SAL-${month.replace("-", "")}-${initials}-${Math.floor(Math.random() * 900 + 100)}`;
}

/**
 * Click-to-send advance receipt.
 *
 * wa.me can only pre-fill a text message — it cannot attach a file — so the
 * receipt is the message itself, with every figure the employee would want to
 * check. Deliberately not the Business API: the owner presses send from their
 * own WhatsApp, so this works for every hostel including those that never
 * enabled automated messaging.
 */
function waReceiptLink(phone: string, employeeName: string, a: SalaryAdvance): string {
  // wa.me rejects spaces, dashes and a leading zero; Pakistan numbers become 92…
  const digits = phone.replace(/\D/g, "").replace(/^0/, "92");
  const lines = [
    `*Salary Advance Receipt*`,
    ``,
    `Name: ${employeeName}`,
    `Amount: Rs ${Number(a.amount).toLocaleString()}`,
    `Date: ${formatDate(a.advance_date)}`,
    a.receipt_number ? `Receipt No: ${a.receipt_number}` : null,
    a.payment_method ? `Paid by: ${a.payment_method}` : null,
    ``,
    `Recovered so far: Rs ${Number(a.recovered_amount).toLocaleString()}`,
    `*Balance owed: Rs ${Number(a.balance).toLocaleString()}*`,
    ``,
    `This amount will be deducted from your upcoming salary.`,
  ].filter(Boolean);
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join("\n"))}`;
}

interface Props {
  hostelId: string | null;
  employees: Employee[];
  salaryPayments: SalaryPayment[];
  advances: SalaryAdvance[];
  partnerTier?: PartnerTier | null;
}

export function StaffClient({ hostelId, employees: initialEmployees, salaryPayments: initialPayments, advances: initialAdvances, partnerTier = null }: Props) {
  const canFullTier = !partnerTier || partnerTier === "full";
  // ── Employee state ────────────────────────────────────────
  const [employees, setEmployees] = useState(initialEmployees);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // ── Salary state ──────────────────────────────────────────
  const [salaryPayments, setSalaryPayments] = useState(initialPayments);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [generating, setGenerating] = useState(false);
  const [payDialog, setPayDialog] = useState<SalaryPayment | null>(null);
  const [payForm, setPayForm] = useState({ method: "cash" as PaymentMethod, date: formatDateInput(new Date()), notes: "", receipt: "" });
  const [paying, setPaying] = useState(false);

  // ── Advance state ─────────────────────────────────────────
  const [advances, setAdvances] = useState(initialAdvances);
  const [advanceDialog, setAdvanceDialog] = useState<Employee | null>(null);
  const [advanceForm, setAdvanceForm] = useState({ amount: "", date: formatDateInput(new Date()), method: "cash" as PaymentMethod, receipt: "", notes: "" });
  const [savingAdvance, setSavingAdvance] = useState(false);
  // What the owner has chosen to hold back on this payment. Pre-filled with the
  // full outstanding balance when the dialog opens, then theirs to change —
  // lowering it just carries the rest into next month.
  const [deductInput, setDeductInput] = useState("");
  const [writeOffId, setWriteOffId] = useState<string | null>(null);

  /** Unsettled balance per employee — drives the badge and the pay dialog. */
  const outstandingByEmployee = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of advances) {
      const bal = Number(a.balance ?? 0);
      if (bal > 0) map[a.employee_id] = (map[a.employee_id] ?? 0) + bal;
    }
    return map;
  }, [advances]);

  // ── Data helpers ──────────────────────────────────────────
  async function reloadEmployees() {
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_employees").select("*").eq("hostel_id", hostelId).order("full_name");
    setEmployees((data as Employee[]) ?? []);
  }

  async function reloadAdvances() {
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_salary_advances")
      .select("*, employee:hms_employees(full_name, role)")
      .eq("hostel_id", hostelId)
      .order("advance_date", { ascending: false });
    setAdvances((data as SalaryAdvance[]) ?? []);
  }

  async function handleGiveAdvance() {
    if (!advanceDialog) return;
    setSavingAdvance(true);
    const res = await giveSalaryAdvance({
      employeeId: advanceDialog.id,
      amount: Number(advanceForm.amount) || 0,
      advanceDate: advanceForm.date,
      paymentMethod: advanceForm.method,
      receiptNumber: advanceForm.receipt || null,
      notes: advanceForm.notes || null,
    });
    setSavingAdvance(false);
    if (res.error) { toast({ title: "Error", description: res.error, variant: "destructive" }); return; }
    toast({ title: `Advance of ${formatCurrency(Number(advanceForm.amount) || 0)} recorded` });
    setAdvanceDialog(null);
    await reloadAdvances();
  }

  async function handleWriteOff(id: string) {
    const res = await writeOffSalaryAdvance({ advanceId: id, date: formatDateInput(new Date()) });
    if (res.error) { toast({ title: "Error", description: res.error, variant: "destructive" }); return; }
    toast({
      title: "Advance written off",
      description: `${formatCurrency(res.writtenOff ?? 0)} booked as an expense today — earlier months are unchanged.`,
    });
    setWriteOffId(null);
    await reloadAdvances();
  }

  async function handleDeleteAdvance(id: string) {
    const res = await deleteSalaryAdvance(id);
    if (res.error) { toast({ title: "Cannot delete", description: res.error, variant: "destructive" }); return; }
    toast({ title: "Advance removed" });
    await reloadAdvances();
  }

  async function reloadSalaries(month: string) {
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_salary_payments")
      .select("*, employee:hms_employees(full_name, role)")
      .eq("hostel_id", hostelId).eq("for_month", month)
      .order("created_at", { ascending: false });
    setSalaryPayments((prev) => {
      const others = prev.filter((p) => p.for_month !== month);
      return [...others, ...((data as SalaryPayment[]) ?? [])];
    });
  }

  // ── Employee CRUD ─────────────────────────────────────────
  function openAdd() { setEditing(null); setForm(emptyForm); setDialogOpen(true); }
  function quickStaff(item: { label: string; role: EmployeeRole }) {
    setEditing(null);
    setForm({ ...emptyForm, full_name: item.label, role: item.role });
    setDialogOpen(true);
  }
  function openEdit(e: Employee) {
    setEditing(e);
    setForm({ full_name: e.full_name, role: e.role, phone: e.phone ?? "", cnic: e.cnic ?? "", join_date: e.join_date, monthly_salary: e.monthly_salary.toString(), status: e.status, notes: e.notes ?? "" });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!hostelId || !form.full_name || !form.monthly_salary) return;
    setSaving(true);
    const supabase = createClient();
    const payload = {
      hostel_id: hostelId, full_name: form.full_name, role: form.role,
      phone: form.phone || null, cnic: form.cnic || null,
      join_date: form.join_date, monthly_salary: parseFloat(form.monthly_salary) || 0,
      status: form.status, notes: form.notes || null,
    };
    if (editing) {
      const { data, error } = await supabase.from("hms_employees").update(payload).eq("id", editing.id).select("id");
      setSaving(false);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      if (!data || data.length === 0) {
        toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
        return;
      }
      toast({ title: "Updated" }); setDialogOpen(false); reloadEmployees();
      return;
    }
    const { error } = await supabase.from("hms_employees").insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Employee added" }); setDialogOpen(false); reloadEmployees(); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    const { data, error } = await supabase.from("hms_employees").delete().eq("id", id).select("id");
    if (error) {
      // Migration 160 makes hms_salary_advances RESTRICT this delete on purpose:
      // an unrecovered advance is money owed, and cascading it away would erase
      // the debt silently. Translate the FK error into what the owner has to do.
      const blockedByAdvance = error.code === "23503" && error.message.includes("salary_advances");
      toast({
        title: blockedByAdvance ? "Settle their advance first" : "Error",
        description: blockedByAdvance
          ? "This employee has a salary advance on record. Recover or write it off from the Advances tab before deleting them."
          : error.message,
        variant: "destructive",
      });
      return;
    }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    toast({ title: "Deleted" }); reloadEmployees();
  }

  // ── Salary actions ────────────────────────────────────────
  async function generateSalaries() {
    const active = employees.filter((e) => e.status === "active");
    if (!active.length || !hostelId) { toast({ title: "No active employees" }); return; }
    setGenerating(true);
    const supabase = createClient();
    const rows = active.map((e) => ({
      hostel_id: hostelId, employee_id: e.id,
      for_month: selectedMonth, amount: e.monthly_salary, status: "pending",
    }));
    // ignoreDuplicates makes this ON CONFLICT DO NOTHING, so rows.length is what
    // we tried to write, not what landed — report the rows actually inserted.
    const { data, error } = await supabase.from("hms_salary_payments").upsert(rows, { onConflict: "employee_id,for_month", ignoreDuplicates: true }).select("id");
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      const created = data?.length ?? 0;
      toast({ title: created > 0 ? `Generated ${created} salary records` : "All salary records already exist for this month" });
      await reloadSalaries(selectedMonth);
    }
    setGenerating(false);
  }

  function openPay(p: SalaryPayment) {
    setPayDialog(p);
    setPayForm({ method: "cash", date: formatDateInput(new Date()), notes: "", receipt: genReceipt(p.employee?.full_name ?? "", p.for_month) });
    // Pre-fill with everything they owe, capped at the salary so the net can
    // never go negative. The owner is free to lower it — whatever is left just
    // carries into next month.
    const owed = outstandingByEmployee[p.employee_id] ?? 0;
    setDeductInput(owed > 0 ? String(Math.min(owed, Number(p.amount ?? 0))) : "");
  }

  async function handlePay() {
    if (!payDialog) return;
    setPaying(true);

    // Routed through a server action rather than the browser SDK used elsewhere
    // on this page: paying a salary and settling an advance are one operation,
    // and a deduction that landed without its salary row (or the reverse) would
    // misstate what an employee is still owed.
    const deduct = Number(deductInput || 0) || 0;
    const res = await paySalaryWithAdvance({
      salaryPaymentId: payDialog.id,
      deduct,
      paymentMethod: payForm.method,
      paymentDate: payForm.date,
      receiptNumber: payForm.receipt || null,
      notes: payForm.notes || null,
    });
    setPaying(false);
    if (res.error) { toast({ title: "Error", description: res.error, variant: "destructive" }); return; }
    toast({
      title: "Salary paid",
      description: deduct > 0
        ? `${formatCurrency(res.netPaid ?? 0)} handed over · ${formatCurrency(deduct)} advance recovered`
        : undefined,
    });
    setPayDialog(null);
    setDeductInput("");
    await reloadSalaries(selectedMonth);
    await reloadAdvances();
  }

  // ── Derived ───────────────────────────────────────────────
  const filteredEmployees = useMemo(() => {
    const q = search.toLowerCase();
    return employees.filter((e) => e.full_name.toLowerCase().includes(q) || e.role.includes(q));
  }, [search, employees]);

  const monthPayments = useMemo(() => salaryPayments.filter((p) => p.for_month === selectedMonth), [salaryPayments, selectedMonth]);

  const stats = useMemo(() => {
    const active = employees.filter((e) => e.status === "active");
    const payroll = active.reduce((s, e) => s + Number(e.monthly_salary), 0);
    const paid = monthPayments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
    const pending = monthPayments.filter((p) => p.status === "pending").reduce((s, p) => s + Number(p.amount), 0);
    return { total: employees.length, active: active.length, payroll, paid, pending };
  }, [employees, monthPayments]);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Staff</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage employees and salaries</p>
        </div>
        {canFullTier && (
          <Button onClick={openAdd} className="gap-2 w-full sm:w-auto">
            <Plus className="w-4 h-4" /> Add Employee
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Staff",     short: "Staff",   value: stats.total,              icon: Users,        color: "text-blue-400",    bg: "bg-blue-500/10 border border-blue-500/20" },
          { label: "Monthly Payroll", short: "Payroll", value: formatCurrency(stats.payroll), icon: TrendingDown, color: "text-amber",        bg: "bg-amber/10 border border-amber/20" },
          { label: "Paid This Month", short: "Paid",    value: formatCurrency(stats.paid),    icon: CheckCircle2, color: "text-emerald-400",  bg: "bg-emerald-500/10 border border-emerald-500/20" },
          { label: "Pending",                           value: formatCurrency(stats.pending),  icon: Clock,        color: "text-rose-400",    bg: "bg-rose-500/10 border border-rose-500/20" },
        ].map(({ label, short, value, icon: Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-2 lg:gap-3">
              {/* Tighter icon below lg. Four half-width cards leave ~89px for
                  text at 390px, and "Rs 25,000" at text-xl needs ~95px — so the
                  figure itself was being clipped to "Rs 25,…". A truncated label
                  is a cosmetic loss; a truncated AMOUNT is the page lying about
                  money, so the icon gives up the room and the number shrinks a
                  step rather than the other way round. */}
              <div className={`p-1.5 lg:p-2 rounded-lg shrink-0 ${bg}`}><Icon className={`w-3.5 h-3.5 lg:w-4 lg:h-4 ${color}`} /></div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">
                  {short ? (<><span className="lg:hidden">{short}</span><span className="hidden lg:inline">{label}</span></>) : label}
                </p>
                <p className="text-lg lg:text-xl font-bold">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="employees" className="space-y-6">
        {/* Laid out to fit rather than scrolled. Three triggers plus the amber
            outstanding figure ran past the right edge of a phone, so "Advances
            Rs 5,0…" was clipped — and the clipped part is money owed. Equal
            thirds at full width, with the icons dropped below sm to buy the
            room back. */}
        <TabsList noFade className="w-full grid grid-cols-3 sm:w-auto sm:inline-flex">
          <TabsTrigger value="employees" className="px-2 sm:px-3">
            <Users className="hidden sm:inline-block w-3.5 h-3.5 mr-1.5" />Employees
          </TabsTrigger>
          <TabsTrigger value="salaries" className="px-2 sm:px-3">
            <Wallet className="hidden sm:inline-block w-3.5 h-3.5 mr-1.5" />Salaries
          </TabsTrigger>
          <TabsTrigger value="advances" className="px-2 sm:px-3">
            {/* Label only. The outstanding figure rode along here and was the
                first thing to be clipped when the strip ran out of room —
                "Advances Rs 5,0…" — and a half-shown amount owed is worse than
                none. The tab itself is one tap from the real number. */}
            <HandCoins className="hidden sm:inline-block w-3.5 h-3.5 mr-1.5" />Advances
          </TabsTrigger>
        </TabsList>

        {/* ── Employees tab ──────────────────────────────── */}
        <TabsContent value="employees" className="space-y-4">
          {/* Quick Add */}
          {canFullTier && (
          <QuickAddTray count={QUICK_STAFF.length} hint="— tap to pre-fill the form">
            {QUICK_STAFF.map((item) => (
              <button
                key={item.label}
                onClick={() => quickStaff(item)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${ROLE_CHIP[item.role]}`}
              >
                {item.label}
              </button>
            ))}
          </QuickAddTray>
          )}

          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>

          {filteredEmployees.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <UserCog className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium">{search ? "No employees match" : "No employees yet"}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0 divide-y divide-sidebar-border">
                {filteredEmployees.map((emp) => {
                  const rc = roleConfig[emp.role];
                  return (
                    /* Stacked on a phone for the same reason as the salaries
                       row: the avatar, the salary and two icon buttons are all
                       shrink-0, so the badges and the phone/CNIC/joined line
                       were being squeezed into a column too narrow to hold
                       them. */
                    <div key={emp.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-start gap-3 sm:gap-4 min-w-0 sm:flex-1">
                      {/* Avatar */}
                      <div className="flex items-center justify-center w-9 h-9 rounded-full bg-white/5 border border-sidebar-border text-sm font-semibold shrink-0">
                        {rc.icon}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{emp.full_name}</p>
                          <Badge variant="secondary" className={`text-xs capitalize ${rc.color}`}>{rc.label}</Badge>
                          {emp.status === "inactive" && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                          {(outstandingByEmployee[emp.id] ?? 0) > 0 && (
                            <Badge variant="secondary" className="text-xs bg-amber/10 text-amber border-amber/25">
                              Advance due {formatCurrency(outstandingByEmployee[emp.id])}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          {emp.phone && <span className="text-xs text-muted-foreground">{emp.phone}</span>}
                          {emp.cnic && <span className="text-xs text-muted-foreground">{emp.cnic}</span>}
                          <span className="text-xs text-muted-foreground">Joined: {formatDate(emp.join_date)}</span>
                        </div>
                      </div>
                      </div>
                      {/* Salary + actions. The salary was hidden outright below
                          sm, so a phone showed a staff list with no pay on it —
                          on a page whose whole subject is pay. It now shows
                          inline on its own line instead of being dropped. */}
                      <div className="flex items-center justify-between gap-3 pl-12 sm:pl-0 sm:justify-end sm:shrink-0">
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{formatCurrency(emp.monthly_salary)}</p>
                        <p className="text-xs text-muted-foreground">/month</p>
                      </div>
                      {/* Actions */}
                      {canFullTier && (
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(emp)}><Edit2 className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteId(emp.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Salaries tab ───────────────────────────────── */}
        <TabsContent value="salaries" className="space-y-4">
          {/* One row, not two ragged left-aligned blocks. The month picker and
              the button that acts on that month belong together — stacked at
              their own natural widths they read as unrelated controls, and the
              flex-col also stretched the picker to full width for no reason.
              "Generate for All Active" shortens to "Generate All" on a phone so
              the pair fits one line. */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Input
              type="month"
              value={selectedMonth}
              onChange={(e) => { setSelectedMonth(e.target.value); reloadSalaries(e.target.value); }}
              className="w-auto shrink-0"
            />
            {canFullTier && (
              <Button onClick={generateSalaries} disabled={generating} variant="outline" className="gap-2 shrink-0">
                <Plus className="w-4 h-4" />
                {generating ? "Generating…" : (
                  <><span className="sm:hidden">Generate All</span><span className="hidden sm:inline">Generate for All Active</span></>
                )}
              </Button>
            )}
            {monthPayments.length > 0 && (
              <span className="w-full sm:w-auto text-xs text-muted-foreground sm:ml-auto">
                {monthPayments.filter((p) => p.status === "paid").length}/{monthPayments.length} paid
              </span>
            )}
          </div>

          {monthPayments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Wallet className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium">No salary records for this month</p>
                {canFullTier && <p className="text-sm mt-1">Click "Generate for All Active" to create them</p>}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0 divide-y divide-sidebar-border">
                {monthPayments.map((p) => {
                  const role = (p.employee?.role ?? "other") as EmployeeRole;
                  const rc = roleConfig[role];
                  const isPaid = p.status === "paid";
                  return (
                    /* Stacked on a phone, one row from sm up.
                     *
                     * This row did not merely crowd — it OVERLAPPED. The icon,
                     * the amount block and two buttons are all shrink-0, which
                     * left the flex-1 middle roughly 55px at 390px. A Badge
                     * cannot shrink below its own min-content, so "Manager" and
                     * "Advance due Rs 5,000" spilled out of their box and painted
                     * over the amount and the status beside them. Giving the
                     * name and its badges the full width is the fix; min-w-0
                     * alone could never have been enough. */
                    <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-start gap-3 min-w-0 sm:flex-1">
                        <span className="text-lg shrink-0 leading-none">{rc.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium">{p.employee?.full_name ?? "—"}</p>
                            <Badge variant="secondary" className={`text-xs ${rc.color}`}>{rc.label}</Badge>
                            {(outstandingByEmployee[p.employee_id] ?? 0) > 0 && (
                              <Badge variant="secondary" className="text-xs bg-amber/10 text-amber border-amber/25">
                                Advance due {formatCurrency(outstandingByEmployee[p.employee_id])}
                              </Badge>
                            )}
                          </div>
                          {isPaid && p.payment_date && (
                            <p className="text-xs text-muted-foreground mt-0.5">Paid {formatDate(p.payment_date)} · {p.receipt_number}</p>
                          )}
                        </div>
                      </div>
                      {/* pl-7 lines the figure up under the name on a phone (the
                          text-lg icon plus its gap) and is dropped at sm. */}
                      <div className="flex items-center justify-between gap-3 pl-7 sm:pl-0 sm:justify-end sm:shrink-0">
                      <div className="sm:text-right shrink-0">
                        <p className="text-sm font-semibold">{formatCurrency(p.amount)}</p>
                        <p className={`text-xs font-medium ${isPaid ? "text-emerald-400" : "text-amber"}`}>
                          {isPaid ? "Paid" : "Pending"}
                        </p>
                      </div>
                      {canFullTier && (
                        <div className="flex gap-1.5 shrink-0">
                          {/* Sits beside Pay because that is where an owner already
                              is on payday — an advance is asked for in the same
                              breath as "when do I get paid". Stays available on a
                              paid row too: someone can ask for money the day after
                              payday, and it just becomes next month's deduction. */}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 text-xs gap-1 text-amber hover:bg-amber/10 border border-amber/25"
                            onClick={() => {
                              const emp = employees.find((e) => e.id === p.employee_id);
                              if (!emp) {
                                toast({ title: "Employee not found", variant: "destructive" });
                                return;
                              }
                              setAdvanceDialog(emp);
                              setAdvanceForm({ amount: "", date: formatDateInput(new Date()), method: "cash", receipt: genReceipt(emp.full_name, "ADV"), notes: "" });
                            }}
                          >
                            <HandCoins className="w-3 h-3" /> Advance
                          </Button>
                          {!isPaid && (
                            <Button
                              size="sm"
                              className="h-8 text-xs gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                              variant="ghost"
                              onClick={() => openPay(p)}
                            >
                              <CheckCircle2 className="w-3 h-3" /> Pay
                            </Button>
                          )}
                        </div>
                      )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Advances tab ───────────────────────────────── */}
        <TabsContent value="advances" className="space-y-4">
          {advances.length === 0 ? (
            <Card><CardContent className="py-16 text-center text-muted-foreground">
              <HandCoins className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No advances given</p>
              <p className="text-sm mt-1">Use the Advance button on an employee to record one.</p>
            </CardContent></Card>
          ) : (
            <Card><CardContent className="p-0 divide-y divide-white/5">
              {advances.map((a) => {
                const bal = Number(a.balance ?? 0);
                const name = a.employee?.full_name ?? "Employee";
                const emp = employees.find((e) => e.id === a.employee_id);
                return (
                  <div key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{name}</p>
                        {a.status === "outstanding" && <Badge variant="secondary" className="text-xs bg-amber/10 text-amber border-amber/25">Outstanding</Badge>}
                        {a.status === "partially_recovered" && <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/25">Part recovered</Badge>}
                        {a.status === "recovered" && <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/25">Settled</Badge>}
                        {a.status === "written_off" && <Badge variant="destructive" className="text-xs">Written off</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatCurrency(a.amount)} on {formatDate(a.advance_date)}
                        {Number(a.recovered_amount) > 0 && ` · ${formatCurrency(a.recovered_amount)} recovered`}
                        {a.receipt_number && ` · ${a.receipt_number}`}
                      </p>
                      {a.notes && <p className="text-xs text-muted-foreground/70 mt-0.5">{a.notes}</p>}
                    </div>

                    {/* Balance and actions share one line on a phone. Stacked,
                        the figure was right-aligned across the full width — far
                        from the name it belongs to — with the buttons stranded
                        on a third line below it. sm:contents dissolves this
                        wrapper from sm up so the desktop row is untouched. */}
                    <div className="flex items-center justify-between gap-3 sm:contents">
                    <div className="text-left sm:text-right shrink-0">
                      <p className={cn("text-sm font-bold", bal > 0 ? "text-amber" : "text-muted-foreground")}>
                        {formatCurrency(bal)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">still owed</p>
                    </div>

                    {canFullTier && (
                      <div className="flex gap-1 shrink-0">
                        {/* wa.me carries text only — it cannot attach a file — so the
                            receipt IS the message, with every detail spelled out. */}
                        {emp?.phone && (
                          <a
                            href={waReceiptLink(emp.phone, name, a)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            aria-label="Send receipt on WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {bal > 0 && (
                          <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs text-rose-400 hover:bg-rose-500/10" onClick={() => setWriteOffId(a.id)}>
                            Write off
                          </Button>
                        )}
                        {Number(a.recovered_amount) === 0 && Number(a.written_off_amount) === 0 && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteAdvance(a.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                    </div>
                  </div>
                );
              })}
            </CardContent></Card>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete employee?"
        description="This employee and all their salary records will be permanently deleted. Not allowed while they still owe a salary advance."
        onConfirm={() => { handleDelete(deleteId!); setDeleteId(null); }}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        open={!!writeOffId}
        title="Write off this advance?"
        description="The unrecovered balance is recorded as an expense dated today, so earlier months stay exactly as they are. This cannot be undone."
        onConfirm={() => handleWriteOff(writeOffId!)}
        onCancel={() => setWriteOffId(null)}
      />

      {/* ── Add / Edit Employee Dialog ────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2"><Label>Full Name *</Label><Input placeholder="Ahmed Khan" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as EmployeeRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.icon} {r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as EmployeeStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Phone</Label><Input placeholder="+92 300 0000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>CNIC</Label><Input placeholder="00000-0000000-0" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Monthly Salary (PKR) *</Label><Input type="number" placeholder="0" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Join Date</Label><Input type="date" value={form.join_date} onChange={(e) => setForm({ ...form, join_date: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea placeholder="Optional…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.full_name || !form.monthly_salary}>
              {saving ? "Saving…" : editing ? "Update" : "Add Employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Give Advance Dialog ──────────────────────────── */}
      <Dialog open={!!advanceDialog} onOpenChange={(o) => !o && setAdvanceDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Give Advance — {advanceDialog?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {/* Stated plainly because it is the thing most likely to be
                misunderstood: this is a loan, and it does not reduce what the
                employee earns. */}
            <p className="text-xs text-muted-foreground">
              Recorded as money owed back, not as salary. It will be offered as a deduction on their next salary.
            </p>
            <div className="space-y-1.5">
              <Label>Amount *</Label>
              <Input
                type="number" min={0} step="0.01" placeholder="5000"
                value={advanceForm.amount}
                onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })}
              />
              {advanceDialog && Number(advanceForm.amount) > Number(advanceDialog.monthly_salary) && (
                <p className="text-[11px] text-amber/80">
                  More than one month&apos;s salary of {formatCurrency(advanceDialog.monthly_salary)} — it will be recovered over several months.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={advanceForm.date} onChange={(e) => setAdvanceForm({ ...advanceForm, date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Receipt No.</Label>
                <Input value={advanceForm.receipt} onChange={(e) => setAdvanceForm({ ...advanceForm, receipt: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Paid By</Label>
              <Select value={advanceForm.method} onValueChange={(v) => setAdvanceForm({ ...advanceForm, method: v as PaymentMethod })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(methodLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reason / Notes</Label>
              <Input placeholder="Optional…" value={advanceForm.notes} onChange={(e) => setAdvanceForm({ ...advanceForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceDialog(null)}>Cancel</Button>
            <Button
              onClick={handleGiveAdvance}
              disabled={savingAdvance || !(Number(advanceForm.amount) > 0)}
              className="bg-amber/10 border border-amber/25 text-amber hover:bg-amber/20"
            >
              {savingAdvance ? "Saving…" : "Record Advance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Mark Paid Dialog ─────────────────────────────── */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay Salary — {payDialog?.employee?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {(() => {
              const gross = Number(payDialog?.amount ?? 0);
              const owed = payDialog ? outstandingByEmployee[payDialog.employee_id] ?? 0 : 0;
              const deduct = Math.max(0, Math.min(Number(deductInput || 0) || 0, gross, owed));
              const net = gross - deduct;
              const carried = owed - deduct;
              return (
                <div className="rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Salary</span>
                    <span className="text-sm font-semibold">{formatCurrency(gross)}</span>
                  </div>

                  {owed > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Advance taken</span>
                        <span className="text-sm font-semibold text-amber">{formatCurrency(owed)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <Label className="text-sm text-muted-foreground shrink-0">Deduct now</Label>
                        <Input
                          type="number" min={0} max={Math.min(gross, owed)} step="0.01"
                          value={deductInput}
                          onChange={(e) => setDeductInput(e.target.value)}
                          className="h-8 w-32 text-right text-sm"
                        />
                      </div>
                    </>
                  )}

                  <div className="flex items-center justify-between border-t border-emerald-500/20 pt-2">
                    <span className="text-sm text-muted-foreground">Pay now</span>
                    <span className="text-lg font-bold text-emerald-400">{formatCurrency(net)}</span>
                  </div>

                  {/* Says out loud that lowering the deduction is not forgiveness —
                      the rest simply follows them into next month. */}
                  {carried > 0 && (
                    <p className="text-[11px] text-amber/80">
                      {formatCurrency(carried)} advance still owed after this — carries to next month.
                    </p>
                  )}
                </div>
              );
            })()}
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: v as PaymentMethod })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(methodLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Payment Date</Label><Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Receipt No.</Label><Input value={payForm.receipt} onChange={(e) => setPayForm({ ...payForm, receipt: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Input placeholder="Optional…" value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog(null)}>Cancel</Button>
            <Button onClick={handlePay} disabled={paying} className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20">
              {paying ? "Saving…" : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
