"use client";
import { useState, useMemo } from "react";
import {
  RefreshCw, Search, ShieldCheck, User, Building2, LogIn, Crown, Users2,
  Activity, Users, Wallet, Receipt, UtensilsCrossed, Briefcase, MessageSquareWarning, Snowflake,
  Grid3x3,
} from "lucide-react";
import {
  listAuditLogs, listLoginLogs, listClientActivity, listActivityFeed,
  type LoginLogWithProfile,
} from "@/app/actions/super-admin-audit";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { FEATURE_KEYS, type AuditLog, type ClientActivityRow, type FeatureKey, type ActivityFeedEvent } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isWithinDays(dateStr: string, days: number): boolean {
  return Date.now() - new Date(dateStr).getTime() <= days * 86400 * 1000;
}

function describeAction(log: AuditLog): string {
  const m = log.meta ?? {};
  switch (log.action) {
    case "user.create": return `Created user ${m.email ?? log.entity_id ?? ""}`;
    case "user.invite": return `Invited ${m.email ?? log.entity_id ?? ""}`;
    case "user.update": return `Updated user ${log.entity_id ?? ""}`;
    case "user.delete": return `Deleted user ${log.entity_id ?? ""}`;
    case "hostel.create": return `Created hostel "${m.name ?? log.entity_id ?? ""}"`;
    case "hostel.update": return `Updated hostel ${log.entity_id ?? ""}`;
    case "hostel.delete": return `Deleted hostel "${m.name ?? log.entity_id ?? ""}"`;
    default: return `${log.action} on ${log.entity}`;
  }
}

function describeActivity(event: ActivityFeedEvent): string {
  const m = event.meta ?? {};
  switch (event.action) {
    case "tenant.create": return `Added tenant "${m.full_name ?? ""}"`;
    case "kitchen_expense.create": return `Logged kitchen expense "${m.title ?? ""}" (${formatCurrency(Number(m.amount ?? 0))})`;
    case "expense.create": return `Added expense "${m.title ?? ""}" (${formatCurrency(Number(m.amount ?? 0))})`;
    case "employee.create": return `Added staff member "${m.full_name ?? ""}"${m.role ? ` (${m.role})` : ""}`;
    case "complaint.create": return `Filed complaint "${m.title ?? ""}"`;
    case "payment.paid": return `Recorded a payment of ${formatCurrency(Number(m.amount ?? 0))}${m.tenant_name ? ` from ${m.tenant_name}` : ""}`;
    case "payment.undo": return `Undid a payment of ${formatCurrency(Number(m.amount ?? 0))}${m.tenant_name ? ` from ${m.tenant_name}` : ""}${m.undone_by_name ? ` (${m.undone_by_name})` : ""}`;
    case "ac_reading.submit": return m.vacant
      ? `Submitted an AC meter reading for an EMPTY room (${m.total_units ?? 0} units, charged to nobody)`
      : `Submitted an AC meter reading (${m.total_units ?? 0} units)`;
    case "manager.invite": return `Invited manager "${m.name ?? ""}"`;
    default: return `${event.action} on ${event.entity}`;
  }
}

function activityEntityIcon(entity: string): typeof User {
  switch (entity) {
    case "tenant": return Users;
    case "payment": return Wallet;
    case "expense": return Receipt;
    case "kitchen_expense": return UtensilsCrossed;
    case "employee": return Briefcase;
    case "complaint": return MessageSquareWarning;
    case "ac_reading": return Snowflake;
    case "manager": return Users2;
    default: return Activity;
  }
}

function actionBadge(action: string): { label: string; cls: string } {
  if (action.includes("delete")) return { label: "Delete", cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" };
  if (action.includes("update")) return { label: "Update", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
  if (action.includes("invite")) return { label: "Invite", cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" };
  return { label: "Create", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
}

function entityIcon(entity: string) {
  if (entity === "hostel") return <Building2 className="w-3.5 h-3.5 text-muted-foreground" />;
  return <User className="w-3.5 h-3.5 text-muted-foreground" />;
}

function roleBadge(role: string | null): { label: string; cls: string; icon: typeof User } {
  switch (role) {
    case "super_admin": return { label: "Super Admin", cls: "bg-amber/10 text-amber border-amber/20", icon: Crown };
    case "owner":        return { label: "Owner",       cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: ShieldCheck };
    case "manager":      return { label: "Manager",     cls: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: Users2 };
    case "partner":      return { label: "Partner",     cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20", icon: User };
    case "sales_rep":    return { label: "Sales Rep",   cls: "bg-orange-500/10 text-orange-400 border-orange-500/20", icon: User };
    default:              return { label: "Unknown",     cls: "bg-white/5 text-muted-foreground border-sidebar-border", icon: User };
  }
}

const FEATURE_COLUMNS: { key: FeatureKey; label: string; icon: typeof User }[] = [
  { key: "tenants", label: "Tenants", icon: Users },
  { key: "payments", label: "Payments", icon: Wallet },
  { key: "expenses", label: "Expenses", icon: Receipt },
  { key: "kitchen", label: "Kitchen", icon: UtensilsCrossed },
  { key: "staff", label: "Staff", icon: Briefcase },
  { key: "complaints", label: "Complaints", icon: MessageSquareWarning },
  { key: "acBilling", label: "AC Billing", icon: Snowflake },
  { key: "team", label: "Team", icon: Users2 },
];

// Shows the raw count (not just a yes/no dot) so volume is visible at a glance —
// a branch with 2 tenants and one with 170 both "used" the feature, but that's a
// very different outreach conversation. Color still layers in recency on top.
function featureCellColor(entry: { count: number; lastUsedAt: string | null }): string {
  if (entry.count === 0) return "text-muted-foreground/30";
  if (entry.lastUsedAt && isWithinDays(entry.lastUsedAt, 7)) return "text-emerald-400";
  if (entry.lastUsedAt && isWithinDays(entry.lastUsedAt, 30)) return "text-amber";
  return "text-muted-foreground";
}

function featuresUsedCount(row: ClientActivityRow): number {
  return FEATURE_KEYS.filter((k) => row.features[k].count > 0).length;
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-sidebar-border bg-card px-5 py-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-serif font-normal text-foreground mt-1">{value}</p>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  initialLogs: AuditLog[];
  initialLoginLogs: LoginLogWithProfile[];
  initialActivity: ClientActivityRow[];
  initialFeed: ActivityFeedEvent[];
}

type Tab = "feed" | "activity" | "actions" | "logins";

export function SuperAdminAuditClient({ initialLogs, initialLoginLogs, initialActivity, initialFeed }: Props) {
  const [tab, setTab]           = useState<Tab>("feed");
  const [logs, setLogs]         = useState<AuditLog[]>(initialLogs);
  const [loginLogs, setLoginLogs] = useState<LoginLogWithProfile[]>(initialLoginLogs);
  const [activity, setActivity] = useState<ClientActivityRow[]>(initialActivity);
  const [feed, setFeed]         = useState<ActivityFeedEvent[]>(initialFeed);
  const [search, setSearch]     = useState("");
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    if (tab === "actions") {
      const { logs: fresh, error } = await listAuditLogs();
      if (error) toast({ title: "Failed to refresh", description: error, variant: "destructive" });
      else setLogs(fresh ?? []);
    } else if (tab === "logins") {
      const { logs: fresh, error } = await listLoginLogs();
      if (error) toast({ title: "Failed to refresh", description: error, variant: "destructive" });
      else setLoginLogs(fresh ?? []);
    } else if (tab === "activity") {
      const { rows: fresh, error } = await listClientActivity();
      if (error) toast({ title: "Failed to refresh", description: error, variant: "destructive" });
      else setActivity(fresh ?? []);
    } else {
      const { events: fresh, error } = await listActivityFeed();
      if (error) toast({ title: "Failed to refresh", description: error, variant: "destructive" });
      else setFeed(fresh ?? []);
    }
    setRefreshing(false);
  }

  const filteredActions = useMemo(() => {
    if (!search) return logs;
    const q = search.toLowerCase();
    return logs.filter((l) =>
      l.actor_email.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      describeAction(l).toLowerCase().includes(q)
    );
  }, [logs, search]);

  const filteredLogins = useMemo(() => {
    if (!search) return loginLogs;
    const q = search.toLowerCase();
    return loginLogs.filter((l) =>
      l.email.toLowerCase().includes(q) ||
      (l.full_name ?? "").toLowerCase().includes(q) ||
      (l.role ?? "").toLowerCase().includes(q)
    );
  }, [loginLogs, search]);

  const sortedActivity = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = !search
      ? activity
      : activity.filter((r) =>
          r.hostelName.toLowerCase().includes(q) ||
          (r.ownerName ?? "").toLowerCase().includes(q) ||
          r.ownerEmail.toLowerCase().includes(q)
        );
    // Least-active branches first — the ones most worth a proactive outreach call.
    return [...filtered].sort((a, b) => featuresUsedCount(a) - featuresUsedCount(b));
  }, [activity, search]);

  const filteredFeed = useMemo(() => {
    if (!search) return feed;
    const q = search.toLowerCase();
    return feed.filter((e) =>
      (e.hostelName ?? "").toLowerCase().includes(q) ||
      (e.ownerName ?? "").toLowerCase().includes(q) ||
      (e.actorName ?? "").toLowerCase().includes(q) ||
      (e.actorEmail ?? "").toLowerCase().includes(q) ||
      describeActivity(e).toLowerCase().includes(q)
    );
  }, [feed, search]);

  const feedStats = useMemo(() => ({
    today: feed.filter((e) => isToday(e.createdAt)).length,
    thisWeek: feed.filter((e) => isWithinDays(e.createdAt, 7)).length,
    activeBranches: new Set(feed.filter((e) => isWithinDays(e.createdAt, 7)).map((e) => e.hostelId).filter(Boolean)).size,
  }), [feed]);

  const loginStats = useMemo(() => ({
    total: loginLogs.length,
    uniqueUsers: new Set(loginLogs.map((l) => l.email)).size,
    today: loginLogs.filter((l) => isToday(l.logged_in_at)).length,
  }), [loginLogs]);

  const actionStats = useMemo(() => ({
    total: logs.length,
    thisWeek: logs.filter((l) => isWithinDays(l.created_at, 7)).length,
    uniqueAdmins: new Set(logs.map((l) => l.actor_email)).size,
  }), [logs]);

  const activityStats = useMemo(() => {
    const total = activity.length;
    const needsOutreach = activity.filter((r) => {
      const used = featuresUsedCount(r);
      const loginStale = !r.lastLogin || !isWithinDays(r.lastLogin, 30);
      return used <= 2 || loginStale;
    }).length;
    const avgUsed = total > 0
      ? activity.reduce((sum, r) => sum + featuresUsedCount(r), 0) / total
      : 0;
    return { total, needsOutreach, avgUsed: avgUsed.toFixed(1) };
  }, [activity]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Audit Trail</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Who did what, when, and on which branch — plus logins and admin changes.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={refreshing} className="gap-2 w-full sm:w-auto">
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tab === "feed" ? (
          <>
            <StatTile label="Events today" value={feedStats.today} />
            <StatTile label="Events this week" value={feedStats.thisWeek} />
            <StatTile label="Active branches (7d)" value={feedStats.activeBranches} />
          </>
        ) : tab === "activity" ? (
          <>
            <StatTile label="Total branches" value={activityStats.total} />
            <StatTile label="Needs outreach" value={activityStats.needsOutreach} />
            <StatTile label="Avg. features used" value={`${activityStats.avgUsed}/${FEATURE_KEYS.length}`} />
          </>
        ) : tab === "logins" ? (
          <>
            <StatTile label="Logins recorded" value={loginStats.total} />
            <StatTile label="Unique users" value={loginStats.uniqueUsers} />
            <StatTile label="Logins today" value={loginStats.today} />
          </>
        ) : (
          <>
            <StatTile label="Actions recorded" value={actionStats.total} />
            <StatTile label="Last 7 days" value={actionStats.thisWeek} />
            <StatTile label="Unique admins" value={actionStats.uniqueAdmins} />
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-white/[0.03] border border-sidebar-border rounded-xl w-fit">
        <button
          onClick={() => { setTab("feed"); setSearch(""); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "feed"
              ? "bg-amber/10 text-amber"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Activity Feed
        </button>
        <button
          onClick={() => { setTab("activity"); setSearch(""); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "activity"
              ? "bg-amber/10 text-amber"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Grid3x3 className="w-3.5 h-3.5" />
          Client Activity
        </button>
        <button
          onClick={() => { setTab("logins"); setSearch(""); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "logins"
              ? "bg-amber/10 text-amber"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <LogIn className="w-3.5 h-3.5" />
          Login History
        </button>
        <button
          onClick={() => { setTab("actions"); setSearch(""); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "actions"
              ? "bg-amber/10 text-amber"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Admin Actions
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={
            tab === "actions" ? "Search by admin, action…"
            : tab === "logins" ? "Search by name, email, role…"
            : tab === "feed" ? "Search by branch, actor, event…"
            : "Search by branch, client name, email…"
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Activity Feed Table */}
      {tab === "feed" && (
        <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
          {filteredFeed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Activity className="w-10 h-10 opacity-20" />
              <p className="text-sm font-medium">{search ? "No matching events" : "No activity yet"}</p>
              <p className="text-xs">Events appear here as clients add tenants, record payments, and use other features.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sidebar-border bg-white/[0.02]">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Time</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Branch</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Actor</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Event</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sidebar-border">
                  {filteredFeed.map((event) => {
                    const Icon = activityEntityIcon(event.entity);
                    return (
                      <tr key={event.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 shrink-0">
                          <span className="text-xs text-muted-foreground whitespace-nowrap" title={new Date(event.createdAt).toLocaleString()}>
                            {timeAgo(event.createdAt)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-foreground/90 truncate max-w-[180px]">{event.hostelName ?? "—"}</p>
                          {event.ownerName && (
                            <p className="text-xs text-muted-foreground truncate max-w-[180px]">{event.ownerName}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-foreground/90 truncate max-w-[180px]">{event.actorName || event.actorEmail || "Unknown"}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground/90 max-w-md">
                          <div className="flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            {describeActivity(event)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Client Activity Table */}
      {tab === "activity" && (
        <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
          {sortedActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Activity className="w-10 h-10 opacity-20" />
              <p className="text-sm font-medium">{search ? "No matching branches" : "No branches yet"}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sidebar-border bg-white/[0.02]">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Branch</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Owner Login</th>
                    {FEATURE_COLUMNS.map(({ key, label, icon: Icon }) => (
                      <th key={key} className="text-center text-xs font-medium text-muted-foreground px-2 py-3" title={label}>
                        <Icon className="w-3.5 h-3.5 mx-auto" />
                      </th>
                    ))}
                    <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">Used</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sidebar-border">
                  {sortedActivity.map((row) => (
                    <tr key={row.hostelId} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm text-foreground/90 truncate max-w-[200px]">{row.hostelName}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {row.ownerName || row.ownerEmail}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground whitespace-nowrap" title={row.lastLogin ? new Date(row.lastLogin).toLocaleString() : "Never logged in"}>
                          {row.lastLogin ? timeAgo(row.lastLogin) : "Never"}
                        </span>
                      </td>
                      {FEATURE_COLUMNS.map(({ key, label }) => {
                        const entry = row.features[key];
                        const tooltip = entry.count === 0
                          ? `${label}: never used`
                          : `${label}: ${entry.count} total, last used ${entry.lastUsedAt ? timeAgo(entry.lastUsedAt) : "?"}`;
                        return (
                          <td key={key} className="px-2 py-3 text-center" title={tooltip}>
                            <span className={`text-xs font-semibold tabular-nums ${featureCellColor(entry)}`}>
                              {entry.count > 0 ? entry.count : "–"}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs font-medium text-foreground/80 whitespace-nowrap">
                          {featuresUsedCount(row)}/{FEATURE_KEYS.length}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Login History Table */}
      {tab === "logins" && (
        <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
          {filteredLogins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <LogIn className="w-10 h-10 opacity-20" />
              <p className="text-sm font-medium">{search ? "No matching logins" : "No login events yet"}</p>
              <p className="text-xs">Login events are recorded automatically when users sign in.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sidebar-border bg-white/[0.02]">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Time</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">User</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Role</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Signed In At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sidebar-border">
                  {filteredLogins.map((log) => {
                    const badge = roleBadge(log.role);
                    const RoleIcon = badge.icon;
                    return (
                      <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 shrink-0">
                          <span className="text-xs text-muted-foreground whitespace-nowrap" title={new Date(log.logged_in_at).toLocaleString()}>
                            {timeAgo(log.logged_in_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm text-foreground/90 truncate max-w-[220px]">
                              {log.full_name || log.email}
                            </p>
                            {log.full_name && (
                              <p className="text-xs text-muted-foreground font-mono truncate max-w-[220px]">{log.email}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${badge.cls}`}>
                            <RoleIcon className="w-3 h-3" />
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.logged_in_at).toLocaleString()}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Admin Actions Table */}
      {tab === "actions" && (
        <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
          {filteredActions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <ShieldCheck className="w-10 h-10 opacity-20" />
              <p className="text-sm font-medium">{search ? "No matching events" : "No audit events yet"}</p>
              <p className="text-xs">Actions will appear here after admins create, update, or delete records.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sidebar-border bg-white/[0.02]">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Time</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Admin</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Action</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Description</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Entity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sidebar-border">
                  {filteredActions.map((log) => {
                    const badge = actionBadge(log.action);
                    return (
                      <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 shrink-0">
                          <span className="text-xs text-muted-foreground whitespace-nowrap" title={new Date(log.created_at).toLocaleString()}>
                            {timeAgo(log.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-foreground/80 font-mono truncate max-w-[160px] block">
                            {log.actor_email}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground/90 max-w-xs">
                          {describeAction(log)}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <div className="flex items-center gap-1.5">
                            {entityIcon(log.entity)}
                            <span className="text-xs text-muted-foreground capitalize">{log.entity}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
