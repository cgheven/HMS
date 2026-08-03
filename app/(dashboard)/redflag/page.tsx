import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/data";
import { REDFLAG_ENABLED } from "@/lib/redflag-flag";
import { listRedflagsAction } from "@/app/actions/redflag";
import { RedflagShell } from "@/components/modules/redflag/redflag-shell";
import { RedflagClient } from "@/components/modules/redflag/redflag-client";

/** Rows per request. The SQL function clamps its own ceiling (100), so this is
 *  only ever a smaller ask — one round trip, quick first paint, and "Load more"
 *  for the rest. */
const PAGE_SIZE = 50;

export default async function RedflagPage() {
  // Gated: see lib/redflag-flag.ts. Blocks direct URL access, not just the nav.
  if (!REDFLAG_ENABLED) notFound();

  // The first page is fetched HERE, not in a mount effect, so the list is part
  // of the server render instead of a second round trip after hydration.
  // listRedflagsAction never throws — it returns { error } for everything,
  // including the disclaimer gate, which the client hands to RedflagShell.
  const [ctx, first] = await Promise.all([
    getAuthContext(),
    listRedflagsAction({ limit: PAGE_SIZE, offset: 0 }),
  ]);

  // The first page's error already carries the gate state, so the shell does not
  // have to ask again after hydration. Only a definite DISCLAIMER_NOT_ACCEPTED
  // raises the gate; any other failure steps aside, because a gate whose accept
  // button cannot work is a dead end.
  const notAccepted = first.error === "DISCLAIMER_NOT_ACCEPTED";
  const unavailable = !!first.error && !notAccepted;

  return (
    <RedflagShell
      key={ctx?.hostelId ?? ""}
      initialAccepted={!notAccepted}
      initialUnavailable={unavailable}
    >
      <RedflagClient
        key={ctx?.hostelId ?? ""}
        pageSize={PAGE_SIZE}
        partnerTier={ctx?.partnerTier}
        initialRows={first.error ? null : first.rows ?? []}
        initialTotal={first.total ?? 0}
        initialHasMore={first.hasMore ?? false}
        initialNextOffset={first.nextOffset ?? 0}
        initialError={first.error ?? null}
      />
    </RedflagShell>
  );
}
