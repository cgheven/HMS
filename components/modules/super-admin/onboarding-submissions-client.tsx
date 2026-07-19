"use client";

import { useState } from "react";
import {
  Building2, Loader2, Rocket, ChevronDown, ChevronRight, Copy, Check,
  Link2, Users2, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SEATER_LABELS } from "@/lib/seater-pricing";
import { provisionOnboarding } from "@/app/actions/onboarding-provision";
import type { ProvisionResult, SubmissionRow } from "@/app/actions/onboarding-provision";
import type { OnboardingBranch, OnboardingBranchConfig } from "@/types";

export function OnboardingSubmissionsClient({
  initialSubmissions,
}: {
  initialSubmissions: SubmissionRow[];
}) {
  const [rows, setRows] = useState(initialSubmissions);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [pending, setPending] = useState<SubmissionRow | null>(null);
  const [result, setResult] = useState<(ProvisionResult & { id: string }) | null>(null);

  const submitted = rows.filter((r) => r.status === "submitted");
  const drafts = rows.filter((r) => r.status === "draft");
  const done = rows.filter((r) => r.status === "provisioned");

  async function handleProvision(row: SubmissionRow) {
    setPending(null);
    setProvisioning(row.id);
    const res = await provisionOnboarding(row.id);
    setProvisioning(null);

    if (res.error) {
      toast({ title: "Could not provision", description: res.error, variant: "destructive" });
      return;
    }
    setResult({ ...res, id: row.id });
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "provisioned" } : r)));
    toast({ title: "Account created", description: `${row.ownerEmail} is live.` });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Onboarding</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Setup forms owners have filled in. Provisioning creates the account, every branch, and its
          pricing in one step.
        </p>
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <p className="text-sm font-medium text-foreground">Account created — share these credentials once</p>
          </div>
          <CredentialLine label="Owner" email={result.ownerEmail ?? ""} password={result.ownerPassword ?? ""} />
          {result.partnerCredentials?.filter((p) => p.password).map((p) => (
            <CredentialLine key={p.email} label={`Partner · ${p.name}`} email={p.email} password={p.password ?? ""} />
          ))}
          <button onClick={() => setResult(null)} className="text-xs text-muted-foreground hover:text-foreground">
            Dismiss
          </button>
        </div>
      )}

      <Group title="Ready to provision" count={submitted.length} tone="amber">
        {submitted.length === 0
          ? <Empty>Nothing waiting.</Empty>
          : submitted.map((r) => (
              <Row
                key={r.id} row={r}
                expanded={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                action={
                  <Button size="sm" onClick={() => setPending(r)} disabled={provisioning === r.id} className="gap-1.5">
                    {provisioning === r.id
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</>
                      : <><Rocket className="w-3.5 h-3.5" /> Provision</>}
                  </Button>
                }
              />
            ))}
      </Group>

      <Group title="Still filling in" count={drafts.length} tone="muted">
        {drafts.length === 0
          ? <Empty>No drafts in progress.</Empty>
          : drafts.map((r) => (
              <Row
                key={r.id} row={r}
                expanded={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                action={<CopyLink token={r.token} />}
              />
            ))}
      </Group>

      <Group title="Provisioned" count={done.length} tone="emerald">
        {done.length === 0
          ? <Empty>None yet.</Empty>
          : done.map((r) => (
              <Row
                key={r.id} row={r}
                expanded={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                action={<span className="text-xs text-emerald-400 font-medium">Live</span>}
              />
            ))}
      </Group>

      <ProvisionDialog
        row={pending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && handleProvision(pending)}
      />
    </div>
  );
}

// Not the shared ConfirmDialog: that one renders a red destructive button, and
// this creates an account rather than destroying one. It also earns a summary —
// provisioning mints real logins and cannot be undone from the UI.
function ProvisionDialog({ row, onCancel, onConfirm }: {
  row: SubmissionRow | null; onCancel: () => void; onConfirm: () => void;
}) {
  const partnersWithEmail = (row?.data.partners ?? []).filter((p) => p.email?.trim());

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-amber/10 border border-amber/20 flex items-center justify-center shrink-0">
              <Rocket className="w-4 h-4 text-amber" />
            </span>
            Create this account?
          </DialogTitle>
          <DialogDescription>
            This is what will be set up for{" "}
            <span className="text-foreground">{row?.ownerName || row?.ownerEmail}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <SummaryLine label="Owner login" value={row?.ownerEmail ?? ""} />
          <SummaryLine
            label={row?.branchCount === 1 ? "Branch" : `${row?.branchCount} branches`}
            value={row?.branchNames.join(", ") || "—"}
          />
          <SummaryLine
            label="Pricing"
            value="AC rate, deposit, notice period, meals and room rates applied to every branch"
          />
          {partnersWithEmail.length > 0 && (
            <SummaryLine
              label={partnersWithEmail.length === 1 ? "Partner login" : `${partnersWithEmail.length} partner logins`}
              value={partnersWithEmail.map((p) => p.name || p.email).join(", ")}
            />
          )}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Passwords are generated now and shown{" "}
          <span className="text-foreground">once</span> — copy them before leaving this page.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm} className="gap-1.5">
            <Rocket className="w-4 h-4" /> Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-xs">
      <span className="text-muted-foreground w-28 shrink-0">{label}</span>
      <span className="text-foreground flex-1 break-words">{value}</span>
    </div>
  );
}

function Row({ row, expanded, onToggle, action }: {
  row: SubmissionRow; expanded: boolean; onToggle: () => void; action: React.ReactNode;
}) {
  const d = row.data;
  return (
    <div className="rounded-xl border border-sidebar-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {row.ownerName || "Unnamed"} <span className="text-muted-foreground font-normal">· {row.ownerEmail || "no email"}</span>
          </p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {row.branchCount} branch{row.branchCount === 1 ? "" : "es"}
            {row.branchNames.length > 0 && ` · ${row.branchNames.join(", ")}`}
            {row.partnerCount > 0 && ` · ${row.partnerCount} partner${row.partnerCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>

      {expanded && (
        <div className="border-t border-sidebar-border px-4 py-4 space-y-5 bg-white/[0.015]">
          <WillCreate row={row} />

          <Detail icon={Users2} title="Owner account">
            <div className="space-y-1">
              <KV label="Name" value={d.owner?.name || "—"} />
              <KV label="Email" value={d.owner?.email || "—"} mono />
              <KV label="WhatsApp" value={d.owner?.phone || "—"} />
            </div>
          </Detail>

          {/* Each branch is rendered with its config already resolved
              (shared + that branch's overrides). Showing the shared block alone
              was actively misleading once a branch overrode anything — the
              numbers on screen then applied to no branch at all. */}
          {d.branches?.map((b, i) => (
            <BranchPanel key={i} branch={b} index={i} shared={d.config} />
          ))}

          {d.partners?.length > 0 && (
            <Detail icon={Users2} title="Partner logins">
              <div className="space-y-1.5">
                {d.partners.map((p, i) => {
                  const names = p.branchIndexes?.length
                    ? p.branchIndexes.map((x) => d.branches[x]?.name || `Branch ${x + 1}`).join(", ")
                    : "every branch";
                  return (
                    <div key={i} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{p.name || "Unnamed"}</span>
                      {p.email && <> · <span className="font-mono">{p.email}</span></>}
                      {" · "}<Pill>{p.tier.replace("_", " ")}</Pill>
                      <span className="ml-1">on {names}</span>
                    </div>
                  );
                })}
              </div>
            </Detail>
          )}
        </div>
      )}
    </div>
  );
}

/** Exactly what provisioning will write, counted from the submission. */
function WillCreate({ row }: { row: SubmissionRow }) {
  const d = row.data;
  const partnerLogins = (d.partners ?? []).filter((p) => p.email?.trim()).length;
  const items = [
    { n: 1, label: "owner login" },
    { n: d.branches?.length ?? 0, label: "branch", plural: "branches" },
    { n: d.branches?.length ?? 0, label: "pricing config", plural: "pricing configs" },
    ...(partnerLogins > 0 ? [{ n: partnerLogins, label: "partner login", plural: "partner logins" }] : []),
  ];
  return (
    <div className="rounded-lg border border-amber/20 bg-amber/[0.04] px-3 py-2.5">
      <p className="text-[11px] font-semibold text-amber uppercase tracking-wide mb-1.5">
        Provisioning will create
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((it) => (
          <span key={it.label} className="text-xs text-foreground">
            <span className="font-semibold">{it.n}</span>{" "}
            <span className="text-muted-foreground">
              {it.n === 1 ? it.label : (it.plural ?? `${it.label}s`)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** One branch with its config fully resolved; overridden fields are marked. */
function BranchPanel({ branch, index, shared }: {
  branch: OnboardingBranch; index: number; shared: OnboardingBranchConfig;
}) {
  const ov = branch.overrides ?? {};
  const cfg: OnboardingBranchConfig = { ...shared, ...ov };
  const isOverridden = (k: keyof OnboardingBranchConfig) => k in ov;

  const location = [branch.area, branch.city].filter(Boolean).join(", ");
  const seaterRows = Object.entries(cfg.seater_prices ?? {})
    .filter(([, v]) => v && (v.no_ac || v.ac || v.deposit_no_ac || v.deposit_ac))
    .sort(([a], [b]) => Number(a) - Number(b));

  return (
    <div className="rounded-lg border border-sidebar-border bg-card overflow-hidden">
      <div className="px-3 py-2.5 border-b border-sidebar-border flex items-center gap-2 flex-wrap">
        <span className="w-5 h-5 rounded bg-amber/10 border border-amber/20 text-amber text-[10px] font-bold flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <p className="text-sm font-medium text-foreground">{branch.name || `Branch ${index + 1}`}</p>
        {location && <span className="text-xs text-muted-foreground">— {location}</span>}
        {branch.total_capacity && (
          <span className="text-xs text-muted-foreground">· {branch.total_capacity} beds</span>
        )}
        {Object.keys(ov).length > 0 && (
          <span className="ml-auto text-[10px] font-semibold text-amber uppercase tracking-wide">
            {Object.keys(ov).length} custom {Object.keys(ov).length === 1 ? "field" : "fields"}
          </span>
        )}
      </div>

      <div className="px-3 py-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          {branch.address && <KV label="Address" value={branch.address} />}
          {branch.phone && <KV label="Phone" value={branch.phone} />}
          <KV label="Type" value={cfg.hostel_type ?? "not set"} flag={isOverridden("hostel_type")} />
          <KV
            label="Sunday kitchen"
            value={cfg.food_closed_on_sundays ? "Closed" : "Open"}
            flag={isOverridden("food_closed_on_sundays")}
          />
        </div>

        <KV
          label="Amenities"
          value={cfg.amenities?.length ? cfg.amenities.join(", ") : "none"}
          flag={isOverridden("amenities")}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1">
          <KV label="AC per unit" value={`Rs. ${cfg.ac_per_unit_rate || 0}`} flag={isOverridden("ac_per_unit_rate")} />
          <KV label="Deposit" value={`Rs. ${cfg.security_deposit || 0}`} flag={isOverridden("security_deposit")} />
          <KV label="Notice" value={`${cfg.notice_period_days || 30} days`} flag={isOverridden("notice_period_days")} />
        </div>

        <KV
          label="Meals / month"
          value={
            [cfg.food_breakfast_rate, cfg.food_lunch_rate, cfg.food_dinner_rate, cfg.food_all_meals_rate].some(Boolean)
              ? `Breakfast ${cfg.food_breakfast_rate || 0} · Lunch ${cfg.food_lunch_rate || 0} · Dinner ${cfg.food_dinner_rate || 0} · All three ${cfg.food_all_meals_rate || 0}`
              : "not offered"
          }
          flag={["food_breakfast_rate", "food_lunch_rate", "food_dinner_rate", "food_all_meals_rate"]
            .some((k) => k in ov)}
        />

        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[11px] text-muted-foreground">Room pricing</p>
            {isOverridden("seater_prices") && <Dot />}
          </div>
          {seaterRows.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">Not set — rooms priced individually.</p>
          ) : (
            <div className="rounded border border-sidebar-border overflow-hidden">
              <div className="grid grid-cols-[1fr_repeat(4,minmax(52px,1fr))] bg-white/[0.02] text-[10px] font-medium text-muted-foreground uppercase">
                <div className="px-2 py-1.5">Room</div>
                <div className="px-1 py-1.5 text-center">Rent<br />Non-AC</div>
                <div className="px-1 py-1.5 text-center">Rent<br />AC</div>
                <div className="px-1 py-1.5 text-center">Dep.<br />Non-AC</div>
                <div className="px-1 py-1.5 text-center">Dep.<br />AC</div>
              </div>
              {seaterRows.map(([cap, v]) => (
                <div key={cap} className="grid grid-cols-[1fr_repeat(4,minmax(52px,1fr))] border-t border-sidebar-border/60 text-xs">
                  <div className="px-2 py-1.5 text-foreground">{SEATER_LABELS[cap]}</div>
                  <div className="px-1 py-1.5 text-center text-muted-foreground">{v?.no_ac || "—"}</div>
                  <div className="px-1 py-1.5 text-center text-muted-foreground">{v?.ac || "—"}</div>
                  <div className="px-1 py-1.5 text-center text-muted-foreground">{v?.deposit_no_ac || "—"}</div>
                  <div className="px-1 py-1.5 text-center text-muted-foreground">{v?.deposit_ac || "—"}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[11px] text-muted-foreground">Payment accounts</p>
            {isOverridden("payment_methods") && <Dot />}
          </div>
          {cfg.payment_methods?.length ? (
            <div className="space-y-0.5">
              {cfg.payment_methods.map((m) => (
                <p key={m.id} className="text-xs text-muted-foreground">
                  <span className="text-foreground">{m.label || "—"}</span>
                  {m.account_title && ` · ${m.account_title}`}
                  {m.account_number && <> · <span className="font-mono">{m.account_number}</span></>}
                  {m.iban && <> · <span className="font-mono">{m.iban}</span></>}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60">None — reminders won&apos;t show account details.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function KV({ label, value, mono, flag }: {
  label: string; value: string; mono?: boolean; flag?: boolean;
}) {
  return (
    <div className="flex gap-2 text-xs min-w-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-foreground break-words min-w-0", mono && "font-mono")}>{value}</span>
      {flag && <Dot />}
    </div>
  );
}

/** Marks a value that this branch overrode rather than inheriting. */
function Dot() {
  return <span className="w-1.5 h-1.5 rounded-full bg-amber shrink-0 mt-1.5" title="Customised for this branch" />;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/5 border border-sidebar-border text-[10px] text-foreground uppercase tracking-wide">
      {children}
    </span>
  );
}

function Detail({ icon: Icon, title, children }: {
  icon: typeof Building2; title: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      </div>
      {children}
    </div>
  );
}

function Group({ title, count, tone, children }: {
  title: string; count: number; tone: "amber" | "emerald" | "muted"; children: React.ReactNode;
}) {
  const dot = tone === "amber" ? "bg-amber" : tone === "emerald" ? "bg-emerald-400" : "bg-muted-foreground/40";
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className={cn("w-1.5 h-1.5 rounded-full", dot)} />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">({count})</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-sidebar-border py-6 text-center">
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

function CopyLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline" size="sm" className="gap-1.5"
      onClick={() => {
        navigator.clipboard.writeText(`${window.location.origin}/onboarding/${token}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

function CredentialLine({ label, email, password }: { label: string; email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-32 shrink-0">{label}</span>
      <code className="text-foreground font-mono truncate">{email}</code>
      <code className="text-amber font-mono truncate">{password}</code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(`Email: ${email}\nPassword: ${password}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
