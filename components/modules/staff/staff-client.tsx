"use client";
import { useState, useMemo } from "react";
import {
  Plus, Search, Edit2, Trash2, UserCog, Wallet,
  CheckCircle2, Clock, Users, TrendingDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import type { Employee, EmployeeRole, EmployeeStatus, SalaryPayment, PaymentMethod } from "@/types";

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

interface Props {
  hostelId: string | null;
  employees: Employee[];
  salaryPayments: SalaryPayment[];
}

export function StaffClient({ hostelId, employees: initialEmployees, salaryPayments: initialPayments }: Props) {
  // ── Employee state ────────────────────────────────────────
  const [employees, setEmployees] = useState(initialEmployees);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // ── Salary state ──────────────────────────────────────────
  const [salaryPayments, setSalaryPayments] = useState(initialPayments);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [generating, setGenerating] = useState(false);
  const [payDialog, setPayDialog] = useState<SalaryPayment | null>(null);
  const [payForm, setPayForm] = useState({ method: "cash" as PaymentMethod, date: formatDateInput(new Date()), notes: "", receipt: "" });
  const [paying, setPaying] = useState(false);

  // ── Data helpers ──────────────────────────────────────────
  async function reloadEmployees() {
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_employees").select("*").eq("hostel_id", hostelId).order("full_name");
    setEmployees((data as Employee[]) ?? []);
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
    const { error } = editing
      ? await supabase.from("hms_employees").update(payload).eq("id", editing.id)
      : await supabase.from("hms_employees").insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: editing ? "Updated" : "Employee added" }); setDialogOpen(false); reloadEmployees(); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this employee? Their salary records will also be removed.")) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_employees").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); reloadEmployees(); }
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
    const { error } = await supabase.from("hms_salary_payments").upsert(rows, { onConflict: "employee_id,for_month", ignoreDuplicates: true });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: `Generated ${rows.length} salary records` }); await reloadSalaries(selectedMonth); }
    setGenerating(false);
  }

  function openPay(p: SalaryPayment) {
    setPayDialog(p);
    setPayForm({ method: "cash", date: formatDateInput(new Date()), notes: "", receipt: genReceipt(p.employee?.full_name ?? "", p.for_month) });
  }

  async function handlePay() {
    if (!payDialog) return;
    setPaying(true);
    const supabase = createClient();
    const { error } = await supabase.from("hms_salary_payments").update({
      status: "paid", payment_method: payForm.method,
      payment_date: payForm.date, notes: payForm.notes || null,
      receipt_number: payForm.receipt,
    }).eq("id", payDialog.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Salary paid" }); setPayDialog(null); await reloadSalaries(selectedMonth); }
    setPaying(false);
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
        <Button onClick={openAdd} className="gap-2 w-full sm:w-auto">
          <Plus className="w-4 h-4" /> Add Employee
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Staff",     value: stats.total,              icon: Users,        color: "text-blue-400",    bg: "bg-blue-500/10 border border-blue-500/20" },
          { label: "Monthly Payroll", value: formatCurrency(stats.payroll), icon: TrendingDown, color: "text-amber",        bg: "bg-amber/10 border border-amber/20" },
          { label: "Paid This Month", value: formatCurrency(stats.paid),    icon: CheckCircle2, color: "text-emerald-400",  bg: "bg-emerald-500/10 border border-emerald-500/20" },
          { label: "Pending",         value: formatCurrency(stats.pending),  icon: Clock,        color: "text-rose-400",    bg: "bg-rose-500/10 border border-rose-500/20" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div>
              <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="employees" className="space-y-6">
        <TabsList>
          <TabsTrigger value="employees"><Users className="w-3.5 h-3.5 mr-1.5" />Employees</TabsTrigger>
          <TabsTrigger value="salaries"><Wallet className="w-3.5 h-3.5 mr-1.5" />Salaries</TabsTrigger>
        </TabsList>

        {/* ── Employees tab ──────────────────────────────── */}
        <TabsContent value="employees" className="space-y-4">
          {/* Quick Add */}
          <div className="rounded-2xl border border-sidebar-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quick Add</p>
              <span className="text-xs text-muted-foreground/50">— tap to pre-fill the form</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_STAFF.map((item) => (
                <button
                  key={item.label}
                  onClick={() => quickStaff(item)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${ROLE_CHIP[item.role]}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

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
                    <div key={emp.id} className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors">
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
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          {emp.phone && <span className="text-xs text-muted-foreground">{emp.phone}</span>}
                          {emp.cnic && <span className="text-xs text-muted-foreground">{emp.cnic}</span>}
                          <span className="text-xs text-muted-foreground">Joined: {formatDate(emp.join_date)}</span>
                        </div>
                      </div>
                      {/* Salary */}
                      <div className="text-right shrink-0 hidden sm:block">
                        <p className="text-sm font-semibold">{formatCurrency(emp.monthly_salary)}</p>
                        <p className="text-xs text-muted-foreground">/month</p>
                      </div>
                      {/* Actions */}
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(emp)}><Edit2 className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(emp.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <Input type="month" value={selectedMonth} onChange={(e) => { setSelectedMonth(e.target.value); reloadSalaries(e.target.value); }} className="w-auto" />
            <Button onClick={generateSalaries} disabled={generating} variant="outline" className="gap-2">
              <Plus className="w-4 h-4" />
              {generating ? "Generating…" : "Generate for All Active"}
            </Button>
            {monthPayments.length > 0 && (
              <span className="text-xs text-muted-foreground ml-auto">
                {monthPayments.filter((p) => p.status === "paid").length}/{monthPayments.length} paid
              </span>
            )}
          </div>

          {monthPayments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Wallet className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium">No salary records for this month</p>
                <p className="text-sm mt-1">Click "Generate for All Active" to create them</p>
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
                    <div key={p.id} className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                      <span className="text-lg shrink-0">{rc.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{p.employee?.full_name ?? "—"}</p>
                          <Badge variant="secondary" className={`text-xs ${rc.color}`}>{rc.label}</Badge>
                        </div>
                        {isPaid && p.payment_date && (
                          <p className="text-xs text-muted-foreground mt-0.5">Paid {formatDate(p.payment_date)} · {p.receipt_number}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{formatCurrency(p.amount)}</p>
                        <p className={`text-xs font-medium ${isPaid ? "text-emerald-400" : "text-amber"}`}>
                          {isPaid ? "Paid" : "Pending"}
                        </p>
                      </div>
                      {!isPaid && (
                        <Button
                          size="sm"
                          className="h-8 text-xs gap-1 shrink-0 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                          variant="ghost"
                          onClick={() => openPay(p)}
                        >
                          <CheckCircle2 className="w-3 h-3" /> Pay
                        </Button>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

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

      {/* ── Mark Paid Dialog ─────────────────────────────── */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay Salary — {payDialog?.employee?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="flex items-center justify-between rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20 px-4 py-3">
              <span className="text-sm text-muted-foreground">Amount</span>
              <span className="text-lg font-bold text-emerald-400">{formatCurrency(payDialog?.amount ?? 0)}</span>
            </div>
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
