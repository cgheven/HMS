# Prod deploy runbook — globalization branch (feat/country-keystone)

Ships migrations **236–253** + the code. Reviewed by a 6-dimension PK-safety /
existing-client audit (2026-09-13): no security holes, PK core money/tenant logic
byte-identical. This runbook covers the conditions that audit raised.

**Golden rule: apply ALL migrations to prod FIRST, verify, THEN deploy the code.**
The code now `SELECT`s columns that don't exist in prod yet (`country`,
`trial_ends_at`, `plan` business/enterprise, `billing_lock_at/token`,
`normalized_email`, `received_account`, admission fields). Deploying code first makes
those queries error → PK payment confirmations, WhatsApp reminders, branch creation,
and the billing page break fleet-wide. This is the exact class of the past
103-failed-messages incident.

---

## 0. Before you start — commit everything

All of this session's work is currently **uncommitted** on the branch, including new
files `lib/tier-pricing.ts`, `lib/tier-sync.ts`, `components/layout/add-property-dialog.tsx`.
If the branch is merged/deployed without them, the build fails on missing imports.

```
git status                     # confirm nothing intended is left as ?? / M
git add -A && git commit ...    # commit the full delta (your action)
npx tsc --noEmit && npx next build   # must both be green
```

---

## 1. Prod pre-flight (run BEFORE applying migrations)

### 1a. Owner canonical-email collisions (gate for migration 238)
238 builds a UNIQUE index on `normalized_email` scoped to `role='owner'`. If two
**owner** rows canonicalize to the same email, the index build aborts the migration.
(237 no longer builds an all-role index — that was removed; it aborted on legitimate
owner-also-manager shared emails. 238's owner-scoped index is the real constraint.)

Find collisions on prod:
```sql
SELECT public.hms_normalize_email(email) AS canonical, count(*), array_agg(id)
FROM public.hms_profiles
WHERE role = 'owner' AND email IS NOT NULL
GROUP BY 1 HAVING count(*) > 1;
```
`hms_normalize_email` only exists after 238's function is created, so either apply
236+237 first then run this before 238, or inline the same rule
(lower/trim → strip `+tag` → gmail dot-fold). Resolve every row returned (merge or
rename the duplicate owner accounts — known: `malikmajid940@gmail.com`) before 238.

### 1b. Confirm no existing owner needs card billing under a non-PK country
236 backfills `country='PK'` for all owners, routing them to the manual rail. Safe
**because there are currently no PK clients paying via Paddle** (confirmed by Musab).
Defensive check — expect zero rows:
```sql
SELECT p.id, p.email, s.status
FROM public.hms_profiles p
JOIN public.hms_paddle_subscriptions s ON s.owner_id = p.id
WHERE s.status = 'active';
```
If any row appears, decide that owner's true `country` before deploy (else their
billing UI flips to invoice framing while Paddle keeps charging their card).

---

## 2. Apply migrations 236 → 253, in numeric order

All are additive/nullable or CHECK-widenings (no table rewrites). Key ordering
constraints baked into the "migrations-first" rule:

| Migration | Why order matters |
|---|---|
| **236** country | code reads `country` everywhere; must exist first |
| **237** normalized_email | additive only now (index removed — see §1a); pair with 238 |
| **238** owner email uniqueness | needs §1a dedup done first, or it aborts |
| **241** trial_ends_at | the account-freeze cron calls `hms_freeze_expired_trials()`; missing → the daily job 500s |
| **250** plan business/enterprise CHECK | before any business/enterprise checkout can stamp the plan |
| **251 + 252** billing_lock columns | `createBranch` writes them unconditionally (PK included) — code before these breaks Add Property for everyone |
| **253** platform_invoices plan CHECK | mirror of 250 for the manual rail |

236–252 are already on **stage**; **253 applied to stage 2026-09-13**. Apply each to
prod with `psql -f`, `ON_ERROR_STOP=1`, in order. Verify columns/constraints exist
before moving on.

---

## 3. Deploy the code (only after §2 verified)

Verify a few columns are live in prod first:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name IN ('hms_profiles','hms_hostels')
  AND column_name IN ('country','trial_ends_at','billing_lock_at','billing_lock_token','normalized_email');
```
Then deploy the code (Vercel promote per project convention).

---

## 4. Post-deploy smoke checks (PK path — must stay byte-identical)

- A PK owner's **billing page** loads (manual plan card, no card-checkout picker).
- Record a PK **payment** → owner alert email + tenant WhatsApp confirmation fire.
- **Reminder cron** runs without error (or wait for the next scheduled run).
- A PK owner **adds a branch** → succeeds, no charge, no "in progress" error.
- A PK **receipt** (`/r/[token]`) renders (a "Room:" line is now included — approved).

---

## 5. Known accepted deltas on the PK path (approved by Musab, not bugs)

These are intentional and were signed off — listed so they're not mistaken for
regressions post-deploy:
- Receipt shows a **"Room: X"** line (approved as a good addition).
- Tenants page stat **"Vacant Rooms" → "Available Beds"** (approved).
- **"Received In"** line on receipts when an account is selected on a payment.
- Settings gains a **self-service email-change** flow.
- Sidebar **"My Public Page"** quick-link removed (page still reachable via Website nav).
- Report/expense **PDF header restyle** (figures/currency unchanged).
- CNIC error/hint **copy** reworded (validation unchanged); >13-digit CNIC now
  rejected instead of silently truncated.
- `MAX_PROPERTIES = 20` cap now applies to PK owners (verify none are at/over 20).

## 6. Fixed in this pass (audit follow-ups)
- **237** no longer builds the deploy-aborting all-role email index (moved to 238, owner-scoped).
- **billing-client** grandfathered "Pay by card" button is now hidden for manual/PK
  owners (was a dead-end button that `createPlanCheckoutAction` rejects).
- **253** widens the manual-rail invoice plan CHECK to business/enterprise.

## 7. Deferred (moot for current client base)
- Existing multi-branch Paddle subs created under the old per-property model show an
  understated recurring amount on the billing page (display-only). No such client
  today; revisit if any pre-tier multi-branch card subscription exists.
