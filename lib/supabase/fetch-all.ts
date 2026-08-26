/**
 * PostgREST caps an unbounded select at 1000 rows and says nothing about it.
 *
 * Verified against this project, not assumed: `hms_payments` holds 1,867 rows
 * and `.select("id", { count: "exact" })` returns 1000 of them while the count
 * header reports 1867. No error, no flag — the array is simply short.
 *
 * That is survivable on a table nobody expects to be complete. It is not
 * survivable on the ones the campaign page is built from, where a short array
 * is indistinguishable from a smaller database:
 *
 *   - the duplicate-number check reads every known phone. Capped, it stops
 *     seeing the older half of the list and re-imports numbers that are
 *     already there — the one thing the shared-table design exists to prevent.
 *   - buildAudience() reads every lead, and sendLeadCampaign() re-derives
 *     eligibility from it. A lead past row 1000 is not blocked, it is absent,
 *     and absent reads as `skipped` in the send summary.
 *
 * So anything whose correctness depends on seeing ALL rows pages explicitly.
 */

const PAGE = 1000;

/** Belt and braces: 100 pages is 100k rows, far past anything this app holds.
 *  A loop that cannot terminate is worse than a truncated read. */
const MAX_PAGES = 100;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * @param page called once per 1000-row window; apply .range(from, to) to your
 *   query inside it. Every other filter and the order must be identical on
 *   each call, or the windows overlap and rows are lost between them.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<{ data: T[]; error: string | null }> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE;
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: out, error: error.message };
    const rows = data ?? [];
    out.push(...rows);
    // A short page is the last page. An exactly-full one might not be, so it
    // costs one more request to find out.
    if (rows.length < PAGE) return { data: out, error: null };
  }
  return { data: out, error: `Stopped after ${MAX_PAGES * PAGE} rows` };
}

/**
 * PostgREST puts `.in()` values in the query string, and the gateway rejects
 * the request once that string gets long enough.
 *
 * Measured on this project: 396 uuids go through, 397 fail outright with
 * "fetch failed" — a ~14.7kB URL. The campaign page passes every imported
 * contact id, so at 314 contacts it works and the next import breaks the page
 * on load. Chunked well below the ceiling so the margin does not depend on
 * anyone remembering the exact number.
 */
export const IN_CHUNK = 200;

export function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
