"use client";

import { useState } from "react";
import { Gift, Check, Loader2 } from "lucide-react";
import { checkReferralStatus } from "@/app/actions/referral-status";
import type { ReferralStatus } from "@/lib/referral-status";

const rs = (n: number) => `Rs ${new Intl.NumberFormat("en-PK").format(Math.round(n))}`;

export function ReferralStatusClient({ token }: { token: string }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReferralStatus | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await checkReferralStatus(token, phone);
    if (res.data) setData(res.data);
    else setError(res.error ?? "Something went wrong.");
    setBusy(false);
  }

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm space-y-5">
          <div className="text-center space-y-2">
            <Gift className="w-8 h-8 mx-auto text-emerald-500" />
            <h1 className="text-xl font-semibold">My referrals</h1>
            <p className="text-sm text-muted-foreground">
              Enter your mobile number to see who you have referred and what you have earned.
            </p>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="03001234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border px-4 py-3 text-base"
              required
            />
            {error && <p className="text-sm text-rose-500">{error}</p>}
            <button
              type="submit"
              disabled={busy || !phone.trim()}
              className="w-full rounded-xl bg-emerald-600 text-white py-3 font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Show my referrals
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto w-full max-w-sm space-y-5">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Hello {data.tenantName.split(" ")[0]}</h1>
          <p className="text-sm text-muted-foreground">{data.hostelName}</p>
        </div>

        {data.campaign === "paused" && (
          /* Told, not left to guess. A tenant whose link has quietly stopped
             working would otherwise keep sharing it and keep wondering. */
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            This referral programme is paused right now. Anything you have already
            earned is safe.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Tile label="Referred" value={String(data.totalReferred)} />
          <Tile label="Joined" value={String(data.joined)} />
          <Tile label="Earned" value={rs(data.earned)} accent />
          <Tile
            label="On the way"
            value={
              data.pendingAmount > 0
                ? rs(data.pendingAmount)
                : data.pending > 0
                  ? `${data.pending} pending`
                  : "—"
            }
          />
        </div>

        {/* Earned counts BOTH the joining discount and referral earnings, so a
            tenant who has referred nobody can still legitimately see a figure.
            Left unexplained that reads as a mistake, so the breakdown is stated
            rather than left to be inferred from the referral count beside it. */}
        {data.joiningDiscount > 0 && data.earned > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            {data.earned > data.joiningDiscount
              ? `Includes ${rs(data.joiningDiscount)} off your own first month for joining through a referral.`
              : `That is ${rs(data.joiningDiscount)} off your own first month for joining through a referral.`}
          </p>
        )}

        {/* Without this, somebody who has just referred a friend who joined AND
            paid reads "Earned Rs 0" and concludes the programme did nothing.
            Worded to hold in both cases: the discount may already be sitting on
            an unpaid bill, or be waiting for the next one to be raised. Earned
            counts only what has been settled, which is the part nobody guesses. */}
        {data.pendingAmount > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            {rs(data.pendingAmount)} is lined up for you — it moves to Earned once
            the rent bill it lands on is paid.
          </p>
        )}

        {data.campaign !== "paused" && (
          <div className="rounded-xl border p-4 space-y-2">
            <p className="text-sm font-medium">Share your link</p>
            <p className="text-xs text-muted-foreground">
              When they join and pay their first month, you get {data.referrerPercent}% off your
              rent and they get {data.referredPercent}% off their first month.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={data.shareUrl}
                className="flex-1 min-w-0 rounded-lg border px-3 py-2 text-xs"
              />
              <CopyButton value={data.shareUrl} />
            </div>
          </div>
        )}

        <div className="rounded-xl border p-4">
          <p className="text-sm font-medium mb-2">People you referred</p>
          {data.people.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nobody yet. Share your link and they will appear here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.people.map((p, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span>{p.name}</span>
                  <span className={p.joined ? "text-emerald-600 text-xs" : "text-muted-foreground text-xs"}>
                    {p.joined ? "Joined" : "Waiting"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border p-3 text-center">
      <p className={`text-lg font-semibold ${accent ? "text-emerald-600" : ""}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="shrink-0 rounded-lg border px-3 py-2 text-xs"
    >
      {done ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : "Copy"}
    </button>
  );
}
