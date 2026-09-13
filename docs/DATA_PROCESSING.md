# Data Processing & Residency Register (GDPR / UK GDPR)

> Internal record of processing activities (ROPA) — where Pulse stores and
> processes personal data, and which third parties (sub-processors) are involved.
> This is the factual compliance record that backs the public Privacy Policy
> (`app/privacy/page.tsx`).
>
> **Placeholders below (`[…]`) must be confirmed by the business before this is
> treated as authoritative.** They are facts the codebase cannot prove.

## 1. Roles

- **Pulse** is operated by **PULSEHUB (SMC-PRIVATE) LIMITED**, Flat #104, Block-B,
  Bait-ul-Hina Apartment, Gulistan-e-Johar, Gulshan Town, Karachi East, Sindh,
  Pakistan. It is the **data controller** for account/owner data (the hostel
  operators who sign up) and a **data processor** for resident and staff personal
  data, which the hostel operator controls.
- **Data protection contact:** musab.khan@yourpulse.io.

## 2. Categories of personal data

| Subject | Data | Source |
|---|---|---|
| Account owners / staff | Name, email, phone, password hash (auth), billing identity | Sign-up, settings |
| Residents / applicants | Name, mobile/phone, email, national ID (CNIC — PK only), date of birth, address, emergency contact, ID document scans, photo, payment history | Admission / public join form |
| Platform leads | Name, phone, business details | Marketing intake |

## 3. Systems & storage locations (sub-processors)

| Sub-processor | Purpose | Data held | Location / region |
|---|---|---|---|
| **Supabase** | Primary database, authentication, file storage (ID documents, photos) | All personal data above | Managed cloud |
| **Vercel** | Application hosting, serverless/edge execution | Transient request data; no primary personal-data store | Managed cloud |
| **Paddle** | SaaS subscription billing (Merchant of Record) | Owner billing identity + card data (Paddle-side only; Pulse never stores card data) | Per Paddle's own terms |
| **Resend** | Transactional email (welcome, notices, receipts) | Recipient email + message content | Per Resend's own terms |
| **Meta / WhatsApp Business** | Resident messaging — **Pakistan only** (gated off for non-PK by `country-config.whatsapp`) | Recipient phone + message content | Not used for UK/EU residents |

> Note: the WhatsApp channel never reaches a non-PK recipient — it is gated on
> the per-country `whatsapp` flag in `lib/country-config.ts`. UK residents are
> contacted by email only.

## 4. International transfers

Where personal data is processed outside the UK/EEA by a sub-processor, we rely
on appropriate safeguards as required by applicable law (e.g. the UK IDTA or
Standard Contractual Clauses in the relevant provider agreements).

## 5. Retention & erasure

- Financial records (payments, invoices) are retained for the statutory
  accounting-retention period even after a resident leaves.
- **Right to erasure** is implemented in-app:
  - `anonymiseTenantResidentAction` — pseudonymises resident PII in place. The
    **name is retained** (minimum needed to identify who a legally-retained
    payment/receipt belonged to); phone/email/CNIC/DoB/address/emergency-contact/vehicle
    nulled; ID-document + photo storage objects deleted; activity-log snapshots
    scrubbed, including generated `*_digits` columns) while **retaining the row
    and all financial foreign keys** so the ledger stays intact. It also erases
    the resident's original admission application (`hms_tenant_applications`),
    clears the cached receipt/invoice PDFs and the name embedded in their
    filenames (`hms_invoice_links` + the `receipts` bucket) so no previously
    shared receipt link keeps disclosing the old name, and blanks resident/
    operator free-text (`hms_tenant_feedback.comment`, `hms_tenant_events.notes`).
    Every ancillary store is scrubbed **before** the tenant row is nulled;
    `hms_tenants.anonymised_at` (migration 249) is stamped only in that final
    write, so a mid-way failure leaves the record un-stamped and a retry re-runs
    the whole erasure. Idempotent.
  - `hardDeleteTenantResidentAction` — explicit full deletion where retention
    does not apply. Purges the application and cached receipt objects first, then
    deletes the row (cascading its financial history). **Refused** when the
    resident is tied to referral-commission records (`hms_referral_rewards` /
    `hms_referrals`), which are platform-revenue accounting that must survive —
    the operator is steered to Anonymise instead.
  - Both are **owner / super-admin only**, hostel-scoped, and written to the
    audit log (`hms_audit_log`, field names only — never values).
- **Safety-report retention.** A red-flag report (`hms_redflags`) filed against a
  resident captures their name and CNIC/phone digits at file time and is
  `ON DELETE SET NULL` on the reported tenant (migration 148) **by design**: the
  warning is retained on a legitimate-interest basis so it outlives the resident
  record and still protects other operators. It is therefore intentionally **not**
  scrubbed by either erasure path, and the erasure confirmation dialog states
  this to the operator. `[LEGAL: confirm this legitimate-interest basis]`.

## 6. Audit logging

Personal-data actions are recorded in `hms_audit_log` via `lib/audit.ts`
(`logPiiAudit`), capturing actor, action, entity, and changed **field names**
(not values). See migrations `017_audit_log.sql` and `248_gdpr_audit_hostel_scope.sql`.

## 7. Open items (business to confirm)

- [x] Legal entity + address — PULSEHUB (SMC-PRIVATE) LIMITED, Karachi, Pakistan
- [x] Privacy contact — musab.khan@yourpulse.io
- [ ] Confirm each sub-processor's DPA is signed (Supabase, Paddle, Resend, Meta/WhatsApp)
- [ ] Confirm the retention + erasure policy (deferred)
