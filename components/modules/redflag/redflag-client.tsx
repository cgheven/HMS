"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Flag, Loader2, Plus, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listRedflagsAction, resolveRedflagAction } from "@/app/actions/redflag";
import { toast } from "@/hooks/use-toast";
import { REDFLAG_REASONS, REDFLAG_REASON_LABELS } from "@/types";
import type { PartnerTier, RedflagListRow, RedflagReason } from "@/types";
import { RedflagTable, REASON_STYLES } from "./redflag-table";
import { ReportDefaulterDialog } from "./report-defaulter-dialog";
import { useRedflagGate } from "./redflag-shell";

/** Every keystroke would otherwise be a cross-organisation read, and each one
 *  spends part of the caller's 300-per-hour budget. */
const SEARCH_DEBOUNCE_MS = 400;
const MIN_SEARCH_CHARS = 2;

type StatusChip = "all" | "reported" | "resolved";

function chipClass(key: StatusChip | "mine", active: boolean): string {
  return cn(
    "h-7 px-3 rounded-full text-xs font-medium border transition-all",
    active && key === "reported" ? "bg-rose-500/15 border-rose-500/40 text-rose-400" :
    active && key === "resolved" ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" :
    active && key === "mine"     ? "bg-amber/15 border-amber/40 text-amber" :
    active                       ? "bg-sidebar-accent border-sidebar-border text-foreground" :
    "border-transparent text-muted-foreground hover:text-foreground hover:border-sidebar-border"
  );
}

interface Props {
  pageSize: number;
  partnerTier?: PartnerTier | null;
  /** The first page, fetched in the server component. null means the fetch
   *  failed — never an empty registry. */
  initialRows: RedflagListRow[] | null;
  initialTotal: number;
  initialHasMore: boolean;
  initialNextOffset: number;
  initialError: string | null;
}

export function RedflagClient({
  pageSize, partnerTier = null,
  initialRows, initialTotal, initialHasMore, initialNextOffset, initialError,
}: Props) {
  const { gateOnDisclaimerError, reloadKey } = useRedflagGate();
  const canWrite = partnerTier !== "read_only";

  const [rows, setRows] = useState<RedflagListRow[] | null>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  // A failed load is NEVER rendered as an empty registry — that reads as a
  // clean bill of health for someone who may well be reported.
  const [error, setError] = useState<string | null>(
    initialError && initialError !== "DISCLAIMER_NOT_ACCEPTED" ? initialError : null
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [statusChip, setStatusChip] = useState<StatusChip>("all");
  const [onlyMine, setOnlyMine] = useState(false);
  const [reasonFilter, setReasonFilter] = useState<RedflagReason | "">("");

  const [reportOpen, setReportOpen] = useState(false);
  const [resolveRow, setResolveRow] = useState<RedflagListRow | null>(null);

  // The server render already answered this query; only re-fetch once a filter,
  // the search or the disclaimer acceptance actually changes it.
  const isFirstRun = useRef(true);
  // Guards against a slow early response overwriting a later, narrower one.
  const requestId = useRef(0);

  useEffect(() => {
    if (initialError) gateOnDisclaimerError(initialError);
  }, [initialError, gateOnDisclaimerError]);

  useEffect(() => {
    const q = searchInput.trim();
    const next = q.length >= MIN_SEARCH_CHARS ? q : "";
    if (next === activeSearch) return;
    const timer = setTimeout(() => setActiveSearch(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, activeSearch]);

  // Every filter below is sent to SQL, which applies it to the WHOLE registry
  // and then pages the result. Filtering the returned page in JS would answer
  // "no match" for anyone reported past the first page.
  const runQuery = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const result = await listRedflagsAction({
      limit: pageSize,
      offset: 0,
      search: activeSearch || undefined,
      status: statusChip === "all" ? undefined : statusChip,
      onlyMine: onlyMine || undefined,
      reason: reasonFilter || undefined,
    });
    if (id !== requestId.current) return;
    setLoading(false);
    if (result.error) {
      if (!gateOnDisclaimerError(result.error)) setError(result.error);
      setRows(null);
      setTotal(0);
      setHasMore(false);
      return;
    }
    setError(null);
    setRows(result.rows ?? []);
    setTotal(result.total ?? 0);
    setHasMore(result.hasMore ?? false);
    setNextOffset(result.nextOffset ?? (result.rows?.length ?? 0));
  }, [pageSize, activeSearch, statusChip, onlyMine, reasonFilter, gateOnDisclaimerError]);

  useEffect(() => {
    if (isFirstRun.current) { isFirstRun.current = false; return; }
    void runQuery();
  }, [runQuery, reloadKey]);

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    const result = await listRedflagsAction({
      limit: pageSize,
      offset: nextOffset,
      search: activeSearch || undefined,
      status: statusChip === "all" ? undefined : statusChip,
      onlyMine: onlyMine || undefined,
      reason: reasonFilter || undefined,
    });
    setLoadingMore(false);
    if (result.error) {
      if (!gateOnDisclaimerError(result.error)) setError(result.error);
      return;
    }
    const more = result.rows ?? [];
    setRows((prev) => {
      const seen = new Set((prev ?? []).map((r) => r.id));
      return [...(prev ?? []), ...more.filter((r) => !seen.has(r.id))];
    });
    setHasMore(result.hasMore ?? false);
    setNextOffset(result.nextOffset ?? nextOffset + more.length);
  }

  async function handleResolve(id: string) {
    const result = await resolveRedflagAction(id);
    if (result.error) {
      if (gateOnDisclaimerError(result.error)) return;
      toast({ title: "Could not update report", description: result.error, variant: "destructive" });
      return;
    }
    toast(
      result.notified === "sent"
        ? { title: "Marked resolved", description: "The member has been emailed that the balance is settled." }
        : result.notified === "failed"
          ? { title: "Marked resolved — email not delivered", description: "The settled notice could not be sent. Let them know directly." }
          : { title: "Marked resolved", description: "No email address on record, so the member was not notified." }
    );
    await runQuery();
  }

  function clearSearch() {
    setSearchInput("");
    setActiveSearch("");
  }

  function clearFilters() {
    setReasonFilter("");
    setStatusChip("all");
    setOnlyMine(false);
  }

  const searching = activeSearch.length > 0;
  const pendingSearch = searchInput.trim().length >= MIN_SEARCH_CHARS && searchInput.trim() !== activeSearch;
  const shown = rows?.length ?? 0;

  /** Any filter that hides rows a search would otherwise have matched. It exists
   *  because "no match" means two very different things: nobody reported this
   *  person, or nobody reported them FOR THIS REASON. Only the first is a clean
   *  bill of health, and only this flag can tell them apart. */
  const narrowed = reasonFilter !== "" || statusChip !== "all" || onlyMine;

  const summary = useMemo(() => {
    if (error) return "The registry could not be read";
    if (rows === null) return "Loading…";
    // The reason narrows the count exactly as much as status or search does, so
    // it is named here too: "12 reports in the registry" while filtered to theft
    // describes a registry the reader is not actually looking at.
    const lens = reasonFilter ? ` · ${REDFLAG_REASON_LABELS[reasonFilter]}` : "";
    if (searching) {
      return (total === 0
        ? `No results for “${activeSearch}”`
        : `${total} result${total === 1 ? "" : "s"} for “${activeSearch}”`) + lens;
    }
    const scope = onlyMine ? "of your reports" : "in the registry";
    const label = statusChip === "all" ? "report" : `${statusChip} report`;
    return `${total} ${label}${total === 1 ? "" : "s"} ${scope}${lens}`;
  }, [error, rows, searching, total, activeSearch, onlyMine, statusChip, reasonFilter]);

  // The SQL raises a distinct, quotable message for the gender case; every other
  // failure (rate limit, missing migration, network) must not be mislabelled.
  const isGenderError = !!error && /gender|Boys or Girls/i.test(error);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">RedFlag</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Search someone before you give them a bed — hostel owners report members who left without paying.
          </p>
        </div>
        {canWrite && (
          <Button
            onClick={() => setReportOpen(true)}
            disabled={!!error}
            title={error ? "RedFlag is unavailable, so a report cannot be filed right now." : undefined}
            className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold shrink-0"
          >
            <Plus className="w-4 h-4" /> Report a Defaulter
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-sidebar-border bg-card p-4 sm:p-6 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, CNIC or phone number…"
            className="pl-9 pr-24 h-12 text-base"
            maxLength={120}
            autoFocus
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {(pendingSearch || (loading && searching)) && (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            )}
            {searchInput && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSearch}
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
        {/* Shown only while the box holds too little to search on. A permanent
            line explaining the minimum is noise for everyone who never hits it. */}
        {searchInput.trim().length > 0 && searchInput.trim().length < MIN_SEARCH_CHARS && (
          <p className="text-xs text-muted-foreground">
            Keep typing — at least {MIN_SEARCH_CHARS} characters to search.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {([
            { key: "all", label: "All" },
            { key: "reported", label: "Reported" },
            { key: "resolved", label: "Resolved" },
          ] as { key: StatusChip; label: string }[]).map(({ key, label }) => {
            const active = statusChip === key;
            return (
              <button key={key} onClick={() => setStatusChip(key)} className={chipClass(key, active)}>
                {label}
                {active && !error && rows !== null && <span className="ml-1 opacity-60">{total}</span>}
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-sidebar-border" aria-hidden />
          <button onClick={() => setOnlyMine((v) => !v)} className={chipClass("mine", onlyMine)}>
            Only mine
          </button>
          <span className="mx-1 h-4 w-px bg-sidebar-border" aria-hidden />
          {/* A select, not six more chips. Status is the primary filter and has
              to stay the loudest thing on this bar; five reasons as chips would
              double its width and read as equally important. This stays one
              control on one line, and carries the reason's own tint once set so
              an active filter is still obvious at a glance. */}
          <select
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value as RedflagReason | "")}
            aria-label="Filter by reason"
            className={cn(
              "h-7 pl-3 pr-2 rounded-full text-xs font-medium border bg-transparent cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-ring",
              reasonFilter
                ? REASON_STYLES[reasonFilter]
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-sidebar-border"
            )}
          >
            <option value="" className="bg-card text-foreground">Any reason</option>
            {REDFLAG_REASONS.map((key) => (
              <option key={key} value={key} className="bg-card text-foreground">
                {REDFLAG_REASON_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 gap-2 text-center rounded-2xl border border-amber/25 bg-amber/10">
          <AlertTriangle className="w-10 h-10 opacity-40 text-amber" />
          <p className="text-sm text-foreground">{error}</p>
          {isGenderError ? (
            <>
              <p className="text-xs text-muted-foreground max-w-md">
                RedFlag only shows reports from hostels of the same gender as your branch, so your
                branch needs a gender set before this list can be shown.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href="/settings">Open Settings</Link>
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground max-w-md">
              Nothing was found because nothing could be read — this is not the same as nobody
              being reported. Try again in a moment before you decide about anyone.
            </p>
          )}
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void runQuery()} disabled={loading}>
            {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Retrying…</> : "Try again"}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm">
            <p className={cn("text-muted-foreground", loading && "opacity-60")}>{summary}</p>
            {shown > 0 && shown < total && (
              <span className="text-xs text-muted-foreground/70">· showing {shown}</span>
            )}
            {searching && (
              <button onClick={clearSearch} className="text-xs text-amber hover:underline ml-auto">
                Clear search
              </button>
            )}
          </div>

          <div
            className={cn(
              "rounded-2xl border border-sidebar-border bg-card p-4 sm:p-6",
              loading && "opacity-60 pointer-events-none"
            )}
          >
            {rows === null ? (
              <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading reports…
              </div>
            ) : rows.length === 0 ? (
              searching ? (
                narrowed ? (
                  /* Filters were hiding rows, so this is NOT "nobody reported
                     them" — saying so would clear a person the registry may well
                     have flagged for some other reason. State only what is true
                     and put the wider search one click away. */
                  <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                    <AlertTriangle className="w-10 h-10 opacity-30 text-amber" />
                    <p className="text-sm text-foreground">
                      No match for “{activeSearch}” with these filters
                    </p>
                    <p className="text-xs text-muted-foreground max-w-md">
                      This is not a clean record — filters are hiding part of the registry. Search
                      everything before you decide.
                    </p>
                    <Button size="sm" variant="outline" className="mt-2 h-8" onClick={clearFilters}>
                      Clear filters and search again
                    </Button>
                  </div>
                ) : (
                  /* Deliberately just the fact. The old sub-line claimed "no
                     hostel has reported anyone with that name, CNIC or phone
                     number", which the registry cannot actually know: it is
                     partitioned by branch gender, so a boys branch never sees a
                     girls branch's reports and vice versa. */
                  <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                    <CheckCircle2 className="w-10 h-10 opacity-20 text-emerald-400" />
                    <p className="text-sm text-foreground">No reports match “{activeSearch}”</p>
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-center text-muted-foreground">
                  {onlyMine ? <Flag className="w-10 h-10 opacity-20" /> : <ShieldAlert className="w-10 h-10 opacity-20" />}
                  <p className="text-sm">
                    {onlyMine
                      ? "You haven't reported anyone yet"
                      : statusChip === "all"
                        ? "No red flags reported yet"
                        : `No ${statusChip} reports`}
                  </p>
                  <p className="text-xs max-w-md">
                    {onlyMine
                      ? "Use Report a Defaulter when someone leaves without paying."
                      : "Reports filed by hostels like yours will appear here."}
                  </p>
                </div>
              )
            ) : (
              <RedflagTable rows={rows} onResolve={canWrite ? setResolveRow : undefined} />
            )}
          </div>

          {hasMore && rows !== null && rows.length > 0 && (
            <div className="flex flex-col items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</>) : "Load more"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Showing {shown} of {total}. Searching looks through all of them, not just the ones
                on screen.
              </p>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!resolveRow}
        title="Mark this report resolved?"
        description={`${resolveRow?.fullName ?? "This person"} will be shown as settled, so other hostels no longer see an open report.`}
        confirmLabel="Mark Resolved"
        onConfirm={() => { if (resolveRow) void handleResolve(resolveRow.id); setResolveRow(null); }}
        onCancel={() => setResolveRow(null)}
      />

      {canWrite && (
        <ReportDefaulterDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          onReported={() => { void runQuery(); }}
          gateOnDisclaimerError={gateOnDisclaimerError}
        />
      )}
    </div>
  );
}
