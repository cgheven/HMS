/**
 * RedFlag rollout flag.
 *
 * RedFlag publishes a named accusation about a real person to other companies,
 * and the build is not finished: gender segregation is not enforced, reports
 * have no expiry, and most subjects are never notified. The database migration
 * is additive and safe to apply, but applying it would otherwise switch the
 * feature on for every owner account at once — schema and exposure are the same
 * event unless something separates them. This flag separates them.
 *
 * Default OFF. Absent env var means hidden, so nothing is enabled by forgetting.
 * Set NEXT_PUBLIC_REDFLAG_ENABLED=true in .env.local to work on it; leave it
 * unset everywhere else and the routes 404 for everyone.
 *
 * NEXT_PUBLIC_ so the sidebar (a client component) can read the same value the
 * server pages gate on — one source of truth, no chance of the nav offering a
 * link the page then refuses.
 */
export const REDFLAG_ENABLED = process.env.NEXT_PUBLIC_REDFLAG_ENABLED === "true";
