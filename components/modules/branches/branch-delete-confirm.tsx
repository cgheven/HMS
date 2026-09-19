"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Trash2, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmBranchDeletion } from "@/app/actions/branches";

type Info =
  | { branchName: string; roomCount: number; residentCount: number; paymentCount: number }
  | { error: string };

export function BranchDeleteConfirm({ token, info }: { token: string; info: Info }) {
  const [pending, start] = useTransition();
  const [doneName, setDoneName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>("error" in info ? info.error : null);

  function del() {
    setError(null);
    start(async () => {
      const res = await confirmBranchDeletion(token);
      if (res.success) setDoneName(res.branchName ?? ("branchName" in info ? info.branchName : "the branch"));
      else setError(res.error ?? "Could not delete the branch.");
    });
  }

  if (doneName) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-sidebar-border bg-card p-6 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Branch deleted</h1>
          <p className="text-sm text-muted-foreground">&ldquo;{doneName}&rdquo; has been permanently removed. Your plan will adjust at your next renewal.</p>
        </div>
        <Button asChild className="w-full">
          <Link href="/dashboard">Go to dashboard <ArrowRight className="ml-2 h-4 w-4" /></Link>
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-sidebar-border bg-card p-6 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Can&apos;t delete this branch</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link href="/settings">Back to Settings</Link>
        </Button>
      </div>
    );
  }

  // "error" is null here, so info is the details shape.
  const details = info as { branchName: string; roomCount: number; residentCount: number; paymentCount: number };
  const hasData = details.roomCount > 0 || details.residentCount > 0 || details.paymentCount > 0;

  return (
    <div className="w-full max-w-md rounded-2xl border border-sidebar-border bg-card p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
          <Trash2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Delete &ldquo;{details.branchName}&rdquo;?</h1>
          <p className="text-xs text-muted-foreground">This permanently removes the branch and everything in it.</p>
        </div>
      </div>

      <div className={`rounded-xl border p-3 text-sm ${hasData ? "border-rose-500/30 bg-rose-500/[0.06] text-rose-300" : "border-sidebar-border bg-white/[0.02] text-muted-foreground"}`}>
        {hasData ? (
          <>This permanently deletes everything in this branch. <span className="text-rose-200">This cannot be undone.</span></>
        ) : (
          <>This branch has no data yet — nothing else will be lost.</>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" disabled={pending}>
          <Link href="/settings">Cancel</Link>
        </Button>
        <Button variant="destructive" onClick={del} disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
          Delete permanently
        </Button>
      </div>
    </div>
  );
}
