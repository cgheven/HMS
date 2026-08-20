import type { SeaterPrices } from "@/lib/seater-pricing";

export type SpaceType = "student" | "professional" | "general";
export type StudentCategory = "university" | "college" | "test_preparation" | "professional_course" | "skills_training";
/** Why a resident is in the city — orthogonal to SpaceType, which is what they are. Mirrors the CHECK in migration 168. */
export type VisitPurpose = "education" | "employment" | "job_interview" | "exam" | "medical" | "business" | "tourism" | "other";
export type RoomStatus = "available" | "occupied" | "maintenance";
export type BillStatus = "paid" | "unpaid" | "overdue";
export type BillCategory = "electricity" | "water" | "internet" | "gas" | "maintenance" | "other";
export type ExpenseCategory = "furniture" | "repairs" | "cleaning" | "security" | "utilities" | "other";
export type MealType = "breakfast" | "lunch" | "dinner";
export type PaymentStatus = "paid" | "pending" | "overdue" | "waived" | "partially_paid";
export type PaymentMethod = "cash" | "bank_transfer" | "jazzcash" | "easypaisa" | "sadapay" | "other";
export type ComplaintCategory = "kitchen" | "staff" | "cleanliness" | "maintenance" | "security" | "other";
export type ComplaintPriority = "low" | "medium" | "high";
export type ComplaintStatus = "open" | "in_progress" | "resolved";
export type EmployeeRole = "cook" | "guard" | "cleaner" | "manager" | "driver" | "other";
export type HostelType = "boys" | "girls";
export type EmployeeStatus = "active" | "inactive";
export type SalaryStatus = "pending" | "paid";
export type ProspectStatus = "pending" | "visited" | "onboarded";
export type PackageTier = "space_only" | "space_food" | "space_3meals" | "space_food_ac"  | "space_meals_cooler";
export type Role = "super_admin" | "owner" | "partner";
export type LeadStatus =
  | "new"
  | "contacted"
  | "follow_up"
  | "demo_scheduled"
  | "demo_done"
  | "onboarding"
  | "converted"
  | "rejected";
export type LeadActivityType = "call" | "visit" | "demo" | "note" | "status_change" | "whatsapp" | "email";
export type LeadPriority = "low" | "medium" | "high";
export type ApplicationStatus = "pending" | "approved" | "rejected";

export interface Profile {
  id: string;
  /** Present on hms_profiles; mirrored from auth.users at signup. Used by the Super Admin audit log. */
  email: string | null;
  role: Role;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  // Account-level public-site identity (migrations 155, 164, 165, 166).
  // Optional because callers that build a Profile by hand predate these
  // columns; every real read is a select("*") so they are always present at
  // runtime.
  subdomain?: string | null;
  business_name?: string | null;
  logo_url?: string | null;
  instagram_handle?: string | null;
  facebook_handle?: string | null;
  /** Appearance of the owner's PUBLIC page only — the dashboard is always dark.
   *  NULL means light, which is what every client is served today. */
  public_theme?: "light" | "dark" | null;
  primary_hostel_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Legacy shape retained for admin pages that still read email / is_admin */
export interface LegacyProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  hostels: { id: string; name: string; total_capacity: number }[];
}

export interface FormFieldConfig {
  enabled: boolean;
  required: boolean;
}

export interface FormConfig {
  email?: FormFieldConfig;
  cnic?: FormFieldConfig;
  type?: FormFieldConfig;
  room_preference?: FormFieldConfig;
  move_in_date?: FormFieldConfig;
  emergency_contact?: FormFieldConfig;
  permanent_address?: FormFieldConfig;
  father_name?: FormFieldConfig;
  purpose_of_visit?: FormFieldConfig;
  notes?: FormFieldConfig;
  // Shown only when Type is Student/Professional respectively (never for
  // General) — foundational data for a future roommate-matching platform.
  institute_name?: FormFieldConfig;
  student_category?: FormFieldConfig;
  organization?: FormFieldConfig;
  department?: FormFieldConfig;
}

export const DEFAULT_FORM_CONFIG: Required<FormConfig> = {
  email:              { enabled: true, required: false },
  cnic:               { enabled: true, required: true },
  type:               { enabled: true, required: true },
  room_preference:    { enabled: true, required: false },
  move_in_date:       { enabled: true, required: false },
  // The public form doubles as a casual registration/enquiry step, not only a
  // committed admission — so required fields here cost real submissions. Only
  // the zero-recall ones are mandatory. Emergency contact needs a phone number
  // the applicant may not have to hand, so it stays optional HERE and is
  // enforced in the staff Add Tenant dialog instead, where the person is
  // present and there is no drop-off to lose. Owners can require any of these
  // per branch from Settings.
  emergency_contact:  { enabled: true, required: false },
  permanent_address:  { enabled: true, required: true },
  father_name:        { enabled: true, required: true },
  purpose_of_visit:   { enabled: true, required: false },
  notes:              { enabled: true, required: false },
  institute_name:     { enabled: true, required: false },
  student_category:   { enabled: true, required: false },
  organization:       { enabled: true, required: false },
  department:         { enabled: true, required: false },
};

/**
 * Emergency-contact relationships, shared by the public admission form, the
 * staff Add Tenant dialog and the Approve Application dialog.
 *
 * One list because these are <Select> options bound to a stored string: a
 * dialog whose list omits a value the applicant already picked renders blank
 * and silently discards it on save. "Guardian" did exactly that before this
 * was unified.
 */
export const RELATIONSHIP_OPTIONS: readonly string[] = [
  "Father", "Mother", "Brother", "Sister", "Spouse",
  "Chachu (Paternal Uncle)", "Mamu (Maternal Uncle)", "Cousin", "Guardian", "Friend",
];

export interface PaymentMethodAccount {
  id: string;
  label: string;
  account_title?: string;
  account_number?: string;
  iban?: string;
}

export interface WifiNetwork {
  id: string;
  name: string;
  password?: string;
}

export interface MealTimeRange {
  from: string;
  to: string;
}

export interface MealTimes {
  breakfast?: MealTimeRange;
  lunch?: MealTimeRange;
  dinner?: MealTimeRange;
}

export interface RoomACReading {
  id: string;
  hostel_id: string;
  room_id: string;
  for_month: string;
  total_units: number;
  meter_reading?: number | null;
  per_unit_rate: number;
  tenant_count: number;
  created_at: string;
  updated_at: string;
}

export interface ACJoinReading {
  id: string;
  hostel_id: string;
  room_id: string;
  for_month: string;
  tenant_id: string;
  units_at_join: number;
  created_at: string;
  updated_at: string;
}

export interface Hostel {
  id: string;
  owner_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  total_capacity: number;
  city: string | null;
  area: string | null;
  maps_url: string | null;
  description: string | null;
  hostel_type: HostelType | null;
  amenities: string[];
  listing_enabled: boolean;
  slug: string | null;
  complaint_code: string | null;
  form_config: FormConfig | null;
  food_closed_on_sundays: boolean;
  food_menu_type: FoodMenuType;
  cover_image_url: string | null;
  payment_methods: PaymentMethodAccount[];
  reminder_template: string | null;
  whatsapp_enabled: boolean;
  /** Per-branch entitlement for tenant referral links. Super Admin only — a DB
   *  trigger rejects any write to this column that carries a user session. */
  referral_enabled: boolean;
  /** Bills every room for metered units, not only rooms with an air conditioner.
   *  For branches that charge electricity per room — has_ac stays the physical
   *  fact used by the public listing and by seater pricing. */
  meter_all_rooms?: boolean;
  wifi_networks: WifiNetwork[];
  welcome_message_template: string | null;
  meal_times: MealTimes;
  created_at: string;
  updated_at: string;
}

export interface PublicHostel {
  id: string;
  owner_id: string;
  owner_name: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  total_capacity: number;
  city: string | null;
  area: string | null;
  maps_url: string | null;
  description: string | null;
  hostel_type: HostelType | null;
  amenities: string[];
  available_beds: number;
  slug: string | null;
  food_closed_on_sundays: boolean;
  food_menu_type: FoodMenuType;
  cover_image_url: string | null;
}

export interface PublicRoom {
  id: string;
  room_number: string;
  floor: number | null;
  type: SpaceType;
  capacity: number;
  occupied: number;
  monthly_rent: number;
  status: RoomStatus;
  has_ac: boolean;
  has_cooler: boolean;
  has_attached_washroom: boolean;
  photo_path: string | null;
  photo_path_2: string | null;
  photo_path_3: string | null;
  photo_path_4: string | null;
  photo_path_5: string | null;
}

export interface PublicHostelDetail extends PublicHostel {
  rooms: PublicRoom[];
  food_menu: FoodItem[];
  package_config: PackageConfig | null;
  form_config: FormConfig | null;
}

// Minimal hostel info for the public complaint-form header — resolved via
// complaint_code, deliberately not gated on listing_enabled (see
// getPublicHostelByComplaintCode).
export interface PublicHostelComplaintInfo {
  id: string;
  name: string;
  city: string | null;
  area: string | null;
}

export interface Room {
  id: string;
  hostel_id: string;
  room_number: string;
  floor: number | null;
  type: SpaceType;
  capacity: number;
  occupied: number;
  monthly_rent: number;
  status: RoomStatus;
  has_ac: boolean;
  has_cooler: boolean;
  has_attached_washroom: boolean;
  photo_path: string | null;
  photo_path_2: string | null;
  photo_path_3: string | null;
  photo_path_4: string | null;
  photo_path_5: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentType = "cnic" | "police_verification" | "lease_agreement" | "passport" | "other";

export interface TenantDocument {
  id: string;
  name: string;
  path: string;       // storage path inside tenant-documents bucket, never a public URL
  type: DocumentType;
  uploaded_at: string;
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  cnic:                "CNIC Copy",
  police_verification: "Police Verification",
  lease_agreement:     "Lease Agreement",
  passport:            "Passport Copy",
  other:               "Other",
};

export interface Tenant {
  id: string;
  hostel_id: string;
  room_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  cnic: string | null;
  type: SpaceType;
  check_in: string;
  check_out: string | null;
  billing_type: "monthly" | "daily";
  package_tier: PackageTier;
  custom_package_id: string | null;
  monthly_rent: number;
  daily_rate: number;
  security_deposit: number;
  /**
   * The date the reservation deposit money was actually received. Prints on the
   * reservation receipt and answers "when did we take it". Never drives billing.
   */
  deposit_collected_on: string | null;
  /**
   * How much of `security_deposit` was already handed over ahead of check-in
   * (as a reservation, with its own paid hms_payments row). The check-in month
   * bills the REMAINDER — see computeDepositCharge. `security_deposit` itself is
   * untouched by a collection, so checkout still refunds the full agreed
   * deposit. 0 for every tenant who has never reserved.
   */
  deposit_collected_amount: number;
  /** One-time, non-refundable — billed only in check_in's month. Hidden on the Tenants page unless the hostel has a non-zero default configured in Settings. */
  registration_fee: number;
  /** On-file vehicle record for safety verification and parking-dispute resolution — all null when the tenant has no vehicle. */
  vehicle_type: string | null;
  vehicle_number: string | null;
  vehicle_model: string | null;
  joining_meter_reading: number | null;
  /** Storage path in the private ac-meter-photos bucket — photographic evidence of the move-in reading above. Never a URL; view via getMeterPhotoUrl. */
  joining_meter_photo: string | null;
  food_breakfast: boolean;
  food_lunch: boolean;
  food_dinner: boolean;
  /** Per-tenant AC maintenance. Null = charge this branch's configured rate
   *  (every tenant today); a number = this tenant's own monthly amount; 0 =
   *  opted out. Only ever applies to tenants in an AC room. */
  ac_maintenance: number | null;
  /** Generated column (migration 184) — hms_normalize_phone_digits(phone), the
   *  same canonical form lib/phone.ts produces. Read-only: a write is rejected
   *  by Postgres. Present on any `select *`. */
  phone_digits?: string | null;
  is_active: boolean;
  is_waiting: boolean;
  bed_number: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  emergency_relationship: string | null;
  /** Tenant's home/permanent address — distinct from the hostel they live in. */
  permanent_address: string | null;
  father_name: string | null;
  /** Why they are in the city, as distinct from `type` (what they are). Render via visitPurposeLabel(). */
  purpose_of_visit: VisitPurpose | null;
  /** Only meaningful when purpose_of_visit is "other". */
  purpose_of_visit_detail: string | null;
  notes: string | null;
  photo_url: string | null;
  documents: TenantDocument[];
  notice_given_date: string | null;
  intended_checkout_date: string | null;
  leaving_reminder_sent_at: string | null;
  // Foundational data for a future roommate-matching platform — students
  // match by institute_name + department, professionals by organization
  // (+ organization_type) + department. Never required, opt-in per hostel.
  institute_name: string | null;
  student_category: StudentCategory | null;
  student_specialization: string | null;
  organization: string | null;
  organization_type: "private" | "government" | null;
  department: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  hostel_id: string;
  tenant_id: string;
  for_month: string;
  amount: number;
  amount_paid?: number;
  late_fee: number;
  payment_method: PaymentMethod | null;
  payment_date: string | null;
  status: PaymentStatus;
  receipt_number: string | null;
  notes: string | null;
  food_charge?: number;
  ac_units_consumed?: number;
  ac_charge?: number;
  security_deposit_charge?: number;
  /** One-time, populated only in the tenant's check-in month. Trusted from the app by the recalculation trigger. */
  registration_fee_charge?: number;
  /** Recurring monthly, re-derived fresh by the recalculation trigger from room.has_ac plus either the tenant's own hms_tenants.ac_maintenance override or, when that is null, the hostel's ac_maintenance_rate — independent of package tier. */
  ac_maintenance_charge?: number;
  /**
   * TRIGGER-OWNED. Derived from hms_referral_rewards on every write; any value a
   * caller sends is discarded. `amount` is stored NET of this, so the row's gross
   * is always `amount + referral_discount` — use grossAmountOf() rather than
   * re-deriving it. A writer that computes `amount` from gross components must
   * send `referral_discount: 0` alongside it; a writer that derives `amount` from
   * a value read out of the row must send no referral_discount key at all.
   */
  referral_discount?: number;
  /** TRIGGER-OWNED. The percent the discount was computed from, pinned on a collected bill so it can be re-derived off a rent that later moved. */
  referral_percent?: number;
  payment_package_tier?: PackageTier | null;
  /** Nights billed for a daily-rate tenant. null/undefined = not a daily row, or billed before migration 099. */
  billed_days?: number | null;
  /** The daily_rate in force when this row was billed — snapshotted, not re-read from the tenant. */
  daily_rate_billed?: number | null;
  /** Owner-chosen base rent replacing monthly_rent in the amount recomputation (checkout pro-rating). */
  base_rent_override?: number | null;
  /**
   * A deposit taken to hold a bed before the tenant moves in. Carries no rent,
   * food or AC — a DB trigger forces those to 0 and sets
   * amount = security_deposit_charge + registration_fee_charge. Its for_month
   * is the month the money was collected, not the month the tenant joins.
   */
  is_reservation?: boolean;
  created_at: string;
  updated_at: string;
  tenant?: { full_name: string; room_id: string | null; phone?: string | null; check_in?: string; joining_meter_reading?: number | null } | null;
}

export interface CheckoutPaymentSettlement {
  paymentId: string;
  action: "pay" | "waive";
  paymentDate?: string;
  paymentMethod?: PaymentMethod;
}

export interface CheckoutInput {
  tenantId: string;
  checkoutDate: string;
  paymentSettlement?: CheckoutPaymentSettlement;
  notes?: string;
  acCheckoutReading?: number;
  acOpeningReading?: number;
  /**
   * Cash handed back to the tenant, out of whatever is left after outstanding dues
   * are settled from the deposit. Anything short of that remainder is a forfeit
   * (damages, etc). Omit to skip the return/forfeit split entirely.
   */
  depositReturned?: number;
  depositNotes?: string;
  /**
   * RULE 2 — opt in to charging a MONTHLY tenant only the nights they actually
   * slept in their final month, instead of the full month's rent. Owner-driven
   * and never automatic: when absent or false the checkout bills exactly what it
   * bills today. Base rent only — food, AC and deposit are never pro-rated.
   * Ignored for daily tenants, whose final month is always re-counted.
   */
  proRateFinalMonth?: boolean;
}

/** What checkoutTenantAction actually did with the money, so the UI can confirm it rather than guess. */
export interface CheckoutSettlement {
  duesSettled: number;
  depositApplied: number;
  cashCollected: number;
  depositReturned: number;
  depositForfeited: number;
}

export type TenantEventType = "room_changed" | "plan_changed" | "deposit_collected" | "deposit_returned" | "deposit_forfeited" | "deposit_applied" | "notice_given" | "notice_cancelled";

export interface TenantEvent {
  id: string;
  tenant_id: string;
  hostel_id: string;
  event_type: TenantEventType;
  from_value: string | null;
  to_value: string | null;
  amount: number | null;
  notes: string | null;
  created_at: string;
}

export interface ACCheckoutReading {
  id: string;
  hostel_id: string;
  room_id: string;
  tenant_id: string;
  for_month: string;
  meter_reading: number;
  units_consumed: number;
  tenant_count_at_checkout: number;
  ac_charge: number;
  checkout_date: string;
  created_at: string;
  updated_at: string;
}

export interface Complaint {
  id: string;
  hostel_id: string;
  tenant_id: string | null;
  room_id: string | null;
  title: string;
  description: string | null;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  tenant?: { full_name: string } | null;
  room?: { room_number: string } | null;
}

// ─── Tenant checkout feedback ────────────────────────────────────────────────
// Mirrors the CHECK constraints in migration 161. These unions are the ONLY
// permitted values; app/actions/feedback.ts re-validates every submitted answer
// against them at runtime, because a TypeScript union is erased before the
// request ever arrives.
export type FeedbackRating = "poor" | "fair" | "good" | "excellent";
export type FeedbackFood = FeedbackRating | "no_meals";
export type FeedbackRoommate = FeedbackRating | "no_roommate";
export type FeedbackRecommend = "yes" | "maybe" | "no";

export interface TenantFeedback {
  id: string;
  hostel_id: string;
  tenant_id: string;
  food: FeedbackFood;
  cleanliness: FeedbackRating;
  staff: FeedbackRating;
  roommate: FeedbackRoommate;
  recommend: FeedbackRecommend;
  comment: string | null;
  needs_attention: boolean;
  acknowledged_at: string | null;
  created_at: string;
  tenant?: { full_name: string; check_out: string | null; room?: { room_number: string } | null } | null;
}

// The dashboard tile's row shape. Deliberately narrow: no comment, no ratings
// beyond the single verdict word, because the tile is a nudge to open the page.
export interface NewFeedbackItem {
  id: string;
  name: string;
  needsAttention: boolean;
  verdict: string;
}

export interface Announcement {
  id: string;
  hostel_id: string;
  title: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  whatsapp_sent_at: string | null;
  whatsapp_sent_count: number;
}

export interface Expense {
  id: string;
  hostel_id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  date: string;
  notes: string | null;
  created_at: string;
}

export interface KitchenExpense {
  id: string;
  hostel_id: string;
  title: string;
  quantity: string | null;
  amount: number;
  date: string;
  type: "daily" | "monthly_grocery";
  notes: string | null;
  created_at: string;
}

export type FoodMenuType = "monthly" | "weekly";

export interface FoodItem {
  id: string;
  hostel_id: string;
  /** Real calendar date — set for "monthly" hostels, null for "weekly" ones. */
  date: string | null;
  /** ISO 8601 weekday (1=Monday...7=Sunday) — set for "weekly" hostels, null for "monthly" ones. */
  day_of_week: number | null;
  meal_type: MealType;
  item_name: string;
  quantity: string | null;
  unit_cost: number | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
}

export interface Bill {
  id: string;
  hostel_id: string;
  title: string;
  category: BillCategory;
  amount: number;
  due_date: string;
  paid_date: string | null;
  status: BillStatus;
  notes: string | null;
  created_at: string;
}

export interface DashboardStats {
  total_rooms: number;
  occupied_rooms: number;
  available_rooms: number;
  total_tenants: number;
  monthly_expenses: number;
  monthly_kitchen: number;
  monthly_salaries: number;
  /** Advances handed over this month — already included in monthly_salaries. */
  monthly_salary_advances: number;
  /** Total advance balance still owed back, across all months. */
  outstanding_salary_advances: number;
  monthly_collected: number;
  monthly_uncollected: number;
  net_profit: number;
  unpaid_bills: number;
  unpaid_bills_amount: number;
  occupancy_rate: number;
  monthly_revenue: number;
  security_deposit_total: number;
  security_deposit_count: number;
  /** Deposit money taken THIS month. Subtracted from net_profit (a deposit is
   *  refundable, not income), so it has to be visible or the profit figure
   *  cannot be reconciled from the other tiles. Distinct from
   *  security_deposit_total, which is everything currently held. */
  deposits_collected_month: number;
  monthly_ac_units: number;
}

// Opt-in, per-partner custom feature (currently one client's request for a
// day-by-day income + expense breakdown) — never enabled by default, set via
// Settings.
export interface PartnerFeatureFlags {
  daily_expenses?: boolean;
}

export interface Defaulter {
  id: string;
  name: string;
  amount: number;
  status: string;
}

export interface UpcomingVacancy {
  id: string;
  name: string;
  roomNumber: string | null;
  noticeGivenDate: string | null;
  intendedCheckoutDate: string | null;
}

export interface RevenueMonth {
  month: string;
  monthKey: string;
  collected: number;
  due: number;
  expenses: number;
  kitchen: number;
  salaries: number;
  profit: number;
  collectionRate: number;
  occupancyRate: number;
  moveIns: number;
  moveOuts: number;
}

export interface AgingBucket {
  count: number;
  amount: number;
}

export interface Employee {
  id: string;
  hostel_id: string;
  full_name: string;
  role: EmployeeRole;
  phone: string | null;
  cnic: string | null;
  join_date: string;
  monthly_salary: number;
  status: EmployeeStatus;
  notes: string | null;
  created_at: string;
}

export interface SalaryPayment {
  id: string;
  hostel_id: string;
  employee_id: string;
  for_month: string;
  amount: number;
  status: SalaryStatus;
  payment_method: string | null;
  payment_date: string | null;
  notes: string | null;
  receipt_number: string | null;
  /** Advance balance held back from this payment. `amount` stays GROSS — net handed over = amount - advance_deducted. */
  advance_deducted: number;
  created_at: string;
  employee?: { full_name: string; role: string };
}

export type SalaryAdvanceStatus = "outstanding" | "partially_recovered" | "recovered" | "written_off";

/** Money lent against future salary. A receivable, not a staff cost — see migration 160. */
export interface SalaryAdvance {
  id: string;
  hostel_id: string;
  employee_id: string;
  amount: number;
  advance_date: string;
  payment_method: string | null;
  receipt_number: string | null;
  notes: string | null;
  recovered_amount: number;
  written_off_amount: number;
  written_off_date: string | null;
  /** Generated in Postgres: amount - recovered - written off. Never set by hand. */
  balance: number;
  /** Generated in Postgres from the amounts, so it cannot drift from them. */
  status: SalaryAdvanceStatus;
  created_at: string;
  employee?: { full_name: string; role: string };
}

export interface Prospect {
  id: string;
  name: string;
  owner_name: string | null;
  phone: string | null;
  area: string | null;
  address: string | null;
  maps_url: string | null;
  location: string | null;
  status: ProspectStatus;
  notes: string | null;
  wave: number | null;
  priority_score: number;
  priority_reason: string | null;
  is_avoid: boolean;
  avoid_reason: string | null;
  created_at: string;
  updated_at: string;
}


export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_email: string;
  action: string;
  entity: string;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface PackagePrices {
  no_ac: number;
  ac: number;
  deposit_no_ac?: number;
  deposit_ac?: number;
}

export interface PackageConfig {
  id: string;
  hostel_id: string;
  food_monthly_rate: number;
  food_bd_rate: number;
  food_3meals_rate: number;
  food_breakfast_rate: number;
  food_lunch_rate: number;
  food_dinner_rate: number;
  food_all_meals_rate: number;
  ac_per_unit_rate: number;
  // Renames the metered AC line on this branch's receipts. Null = "AC Charges".
  // Wording only; billing is untouched.
  ac_charge_label: string | null;
  security_deposit: number;
  // Hostel-wide default one-time registration fee. 0 = not configured — the
  // Tenants page hides the per-tenant override field entirely until set.
  registration_fee: number;
  // Hostel-wide flat monthly AC maintenance charge, auto-applied to every
  // tenant whose room has_ac = true, regardless of package tier.
  ac_maintenance_rate: number;
  notice_period_days: number;
  package_prices: Partial<Record<PackageTier, PackagePrices>>;
  seater_prices: Partial<Record<string, { no_ac: number; ac: number; deposit_no_ac?: number; deposit_ac?: number }>>;
  // Flat, owner-editable add-on for any room with has_attached_washroom — same
  // amount regardless of seater count (e.g. +3,000 for a 2-seater or a 3-seater alike).
  washroom_premium: number;
  created_at: string;
  updated_at: string;
}

export interface LoginLog {
  id: string;
  user_id: string | null;
  email: string;
  logged_in_at: string;
  created_at: string;
}

export interface OwnerHostel {
  id: string;
  owner_id: string;
  hostel_id: string;
  is_primary: boolean;
  created_at: string;
}

export interface Partnership {
  id: string;
  hostel_id: string;
  partner_id: string;
  created_by: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PlatformLead {
  id: string;
  business_name: string;
  owner_name: string;
  phone: string;
  email: string | null;
  city: string | null;
  branch_count: number;
  hostel_type: string | null;
  quoted_annual_price: number | null;
  notes: string | null;
  status: LeadStatus;
  converted_hostel_id: string | null;
  ip_address: string | null;
  assigned_to: string | null;
  source: string | null;
  next_follow_up_date: string | null;
  priority: LeadPriority;
  created_by: string | null;
  marketing_opt_out: boolean;
  created_at: string;
  updated_at: string;
  sales_rep?: { id: string; name: string } | null;
}

/** Refuses the send outright. Not overridable from the UI — the send action
 *  recomputes every one of these from the database before dispatching. */
export type LeadAudienceBlock = "opted_out" | "already_sent" | "no_phone" | "no_name";

/** Reason to think twice. Selectable, just never pre-selected. */
export type LeadAudienceWarning = "converted" | "existing_client" | "rejected";

export interface CampaignAudienceRow {
  lead_id: string;
  business_name: string;
  owner_name: string;
  phone: string;
  city: string | null;
  status: LeadStatus;
  assigned_to: string | null;
  assigned_to_name: string | null;
  marketing_opt_out: boolean;
  /** What {{1}} will render as. null means this lead cannot be greeted at all. */
  greeting: string | null;
  /** True when owner_name was a placeholder and the business name was used
   *  instead — "Assalam o Alaikum Murad Hostel," rather than a person's name.
   *  Flagged in the table because it is otherwise indistinguishable. */
  greeting_from_business: boolean;
  blocked: LeadAudienceBlock | null;
  warnings: LeadAudienceWarning[];
  /** Maintained by the Meta delivery webhook — queued/sent/delivered/read/
   *  undelivered/failed. null until a first send exists. */
  delivery: string | null;
  sent_at: string | null;
}

export interface CampaignSendSummary {
  requested: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: { name: string; error: string }[];
}

export interface ClientBilling {
  owner_id: string;
  billing_cycle: "monthly" | "annual";
  monthly_rate: number | null;
  waive_onboarding: boolean;
  pricing_notes: string | null;
  next_invoice_date: string | null;
  updated_at: string;
}

export interface PlatformInvoice {
  id: string;
  owner_id: string;
  amount: number;
  billing_cycle: "monthly" | "annual";
  period_label: string;
  period_start: string;
  period_end: string;
  due_date: string;
  status: "unpaid" | "paid" | "cancelled";
  paid_at: string | null;
  marked_paid_by: string | null;
  notes: string | null;
  created_at: string;
  share_token: string;
  branch_count: number;
  /** Rate/discount/onboarding snapshot at generation time — an invoice is a historical record. */
  monthly_rate: number;
  discount_pct: number;
  onboarding_fee_charged: number;
  is_first_invoice: boolean;
  /** Set by the SuperAdmin "Send invoice" button. NULL means the client has
   *  never been emailed, and the reminder cron skips it entirely. */
  first_sent_at: string | null;
  last_reminder_at: string | null;
  reminder_count: number;
}

export const FEATURE_KEYS = [
  "tenants", "payments", "expenses", "kitchen", "staff", "complaints", "acBilling", "team",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

// One row per BRANCH (hostel), not per owner — a client's branches can vary
// wildly in how much they're actually used, and that's exactly the signal
// worth surfacing for outreach (a rolled-up owner average hides a dead branch).
export interface ClientActivityRow {
  hostelId: string;
  hostelName: string;
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string;
  lastLogin: string | null;
  features: Record<FeatureKey, { count: number; lastUsedAt: string | null }>;
}

// Raw chronological event — who did what, when, on which branch. Backed by
// hms_activity_log: automatic via DB trigger for client-side inserts (tenants,
// kitchen, expenses, staff, complaints), or an explicit logActivity() call for
// the handful of actions that run server-side (payments, AC billing, managers).
export interface ActivityFeedEvent {
  id: string;
  hostelId: string | null;
  hostelName: string | null;
  ownerName: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  sales_rep_id: string | null;
  actor_id: string | null;
  type: LeadActivityType;
  outcome: string | null;
  notes: string | null;
  occurred_at: string;
  created_at: string;
  sales_rep?: { id: string; name: string } | null;
}

export interface SalesRep {
  id: string;
  created_by: string;
  name: string;
  email: string | null;
  phone: string;
  supabase_user_id: string | null;
  has_login: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  target?: SalesTarget | null;
}

export interface SalesTarget {
  sales_rep_id: string;
  daily_calls_target: number;
  daily_visits_target: number;
  weekly_calls_target: number;
  weekly_visits_target: number;
  updated_at: string;
}

export interface SalesRepContext {
  salesRep: SalesRep;
}

export interface InvoiceLink {
  id: string;
  token: string;
  payment_id: string | null;
  hostel_id: string | null;
  expires_at: string;
  created_at: string;
}

export interface TenantApplication {
  id: string;
  hostel_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  cnic: string | null;
  type: SpaceType;
  room_preference: string | null;
  room_id: string | null;
  package_tier: PackageTier;
  move_in_date: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  emergency_relationship: string | null;
  /** Applicant's home/permanent address — copied to the tenant on approval. */
  permanent_address: string | null;
  father_name: string | null;
  purpose_of_visit: VisitPurpose | null;
  purpose_of_visit_detail: string | null;
  notes: string | null;
  photo_url: string | null;
  cnic_doc_path: string | null;
  food_breakfast: boolean;
  food_lunch: boolean;
  food_dinner: boolean;
  status: ApplicationStatus;
  applied_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  institute_name: string | null;
  student_category: StudentCategory | null;
  student_specialization: string | null;
  organization: string | null;
  organization_type: "private" | "government" | null;
  department: string | null;
}

export interface WaitlistEntry {
  id: string;
  hostel_id: string;
  name: string;
  phone: string;
  created_at: string;
}

export type StaffPermission =
  | "add_members" | "collect_payments" | "add_expenses" | "add_kitchen_expenses"
  | "edit_members" | "edit_expenses" | "edit_kitchen_expenses" | "manage_rooms"

export interface Manager {
  id: string
  owner_id: string
  supabase_user_id: string | null
  name: string
  phone: string
  has_login: boolean
  created_at: string
  updated_at?: string
  permissions?: StaffPermission[]
  hostels?: { id: string; name: string }[]
}

export interface ManagerContext {
  manager: Manager
  permissions: Set<StaffPermission>
  hostels: { id: string; name: string }[]
  activeHostel: { id: string; name: string } | null
}

export type PartnerTier = "read_only" | "standard" | "full"

export interface PartnerBranch {
  partnershipId: string
  hostelId: string
  hostelName: string
  tier: PartnerTier
}

export interface PartnerContext {
  userId: string
  branches: PartnerBranch[]
  activeBranch: PartnerBranch
}

// ---------------------------------------------------------------------------
// Onboarding intake (hms_onboarding_submissions.data)
// ---------------------------------------------------------------------------

/**
 * The owner's answers for their whole setup, captured before any account
 * exists. Every field outside `owner.name`/`owner.email` and a branch name is
 * optional — the wizard lets each step be skipped, and provisioning falls back
 * to the same DB defaults a hand-created hostel would get.
 *
 * `config` is filled once and applied to every branch. A branch that genuinely
 * differs carries its own `overrides`, which shadow `config` for that branch
 * only; anything absent from `overrides` still inherits.
 */
export interface OnboardingBranchConfig {
  hostel_type: HostelType | null
  amenities: string[]
  food_closed_on_sundays: boolean
  ac_per_unit_rate: string
  security_deposit: string
  notice_period_days: string
  food_breakfast_rate: string
  food_lunch_rate: string
  food_dinner_rate: string
  food_all_meals_rate: string
  seater_prices: SeaterPrices
  payment_methods: PaymentMethodAccount[]
}

export interface OnboardingBranch {
  name: string
  city: string
  area: string
  address: string
  phone: string
  total_capacity: string
  /** Present only when the owner ticked "customise this branch". */
  overrides?: Partial<OnboardingBranchConfig>
}

export interface OnboardingPartner {
  name: string
  email: string
  phone: string
  tier: PartnerTier
  /** Which branches this partner gets access to, by index into `branches`. */
  branchIndexes: number[]
}

export interface OnboardingData {
  owner: { name: string; email: string; phone: string }
  branches: OnboardingBranch[]
  config: OnboardingBranchConfig
  partners: OnboardingPartner[]
  /** Highest step the owner has reached, so a resumed link reopens in place. */
  furthestStep?: number
}

export const EMPTY_ONBOARDING_CONFIG: OnboardingBranchConfig = {
  hostel_type: null,
  amenities: [],
  food_closed_on_sundays: false,
  ac_per_unit_rate: "",
  security_deposit: "",
  notice_period_days: "30",
  food_breakfast_rate: "",
  food_lunch_rate: "",
  food_dinner_rate: "",
  food_all_meals_rate: "",
  seater_prices: {},
  payment_methods: [],
}

export const EMPTY_ONBOARDING_BRANCH: OnboardingBranch = {
  name: "",
  city: "",
  area: "",
  address: "",
  phone: "",
  total_capacity: "",
}

// ─── RedFlag (cross-organization defaulter registry) ──────────────────────────
// Every row below crosses an organization boundary, so the identifier fields are
// named for what they actually hold. `*Masked` values are redacted by SQL before
// they ever reach this process and must be rendered as-is; `*Display` values are
// only ever populated for reports the caller's own branch filed.

export type RedflagStatus = "reported" | "resolved"

/** Frozen on the report at insert time, so it stays put even if the branch's
 *  hostel_type is edited later. Same values as HostelType, but a branch with no
 *  type set has no peer group and is rejected by RedFlag rather than stored. */
export type RedflagGender = "boys" | "girls"

/** Why the money is owed. Mirrors the CHECK constraint on hms_redflags.reason —
 *  keep the two in step, and validate against REDFLAG_REASONS server-side
 *  before any insert. */
export type RedflagReason = "unpaid_rent" | "unpaid_utilities" | "damage" | "theft" | "other"

/** Order is the order shown in the picker and the filter: commonest first. */
export const REDFLAG_REASONS: readonly RedflagReason[] = [
  "unpaid_rent",
  "unpaid_utilities",
  "damage",
  "theft",
  "other",
]

/** THE wording. Every surface — the report dialog, the registry table, the
 *  filter, any future receipt — reads from this map. A registry that calls the
 *  same report "Theft" in one place and "Stolen items" in another is a registry
 *  nobody trusts, so there is deliberately no second, shorter copy of these
 *  strings anywhere. */
export const REDFLAG_REASON_LABELS: Record<RedflagReason, string> = {
  unpaid_rent: "Unpaid rent",
  unpaid_utilities: "Unpaid bills (AC / electricity)",
  damage: "Damage to property",
  theft: "Theft",
  other: "Other",
}

export function isRedflagReason(v: unknown): v is RedflagReason {
  return typeof v === "string" && (REDFLAG_REASONS as readonly string[]).includes(v)
}

/** One hit from a CNIC/phone lookup (hms_redflag_search).
 *
 *  Lives here rather than in app/actions/redflag.ts because that file carries
 *  the "use server" directive, and Turbopack permits ONLY async function
 *  exports there — a type alias or a `export type { … } from` re-export is a
 *  build error even though tsc and the webpack build both accept it. */
export interface RedflagMatch {
  id: string
  fullName: string
  cnicMasked: string | null
  phoneMasked: string | null
  amount: number
  /** Only meaningful when reason === 'unpaid_rent'. */
  monthsUnpaid: number | null
  reason: RedflagReason
  status: RedflagStatus
  reportedAt: string
  /** 'cnic' is authoritative; 'phone' is a weak signal — one number is shared by
   *  up to 28 tenants in real data, so the UI must render it as "possible". */
  matchKind: "cnic" | "phone"
  reportedBySelf: boolean
  /** The hostel that filed this report, and how to reach them. Unmasked on
   *  purpose: the disclaimer holds the reporting organisation responsible for
   *  accuracy, so a reader must be able to see who to weigh and who to ring.
   *  Null only if that branch has since been deleted. */
  reportedByHostelName: string | null
  reportedByHostelPhone: string | null
}

/** A row of the cross-organization listing (hms_redflag_list). */
export interface RedflagListRow {
  id: string
  fullName: string
  cnicMasked: string | null
  phoneMasked: string | null
  amount: number
  /** Only meaningful when reason === 'unpaid_rent'. */
  monthsUnpaid: number | null
  reason: RedflagReason
  status: RedflagStatus
  notes: string | null
  reportedAt: string
  resolvedAt: string | null
  /** True when the caller's own branch filed this report — drives the
   *  "Resolve" affordance, which is denied for everyone else's rows. */
  reportedBySelf: boolean
  /** The hostel that filed this report, and how to reach them. Unmasked on
   *  purpose: the disclaimer holds the reporting organisation responsible for
   *  accuracy, so a reader must be able to see who to weigh and who to ring.
   *  Null only if that branch has since been deleted. */
  reportedByHostelName: string | null
  reportedByHostelPhone: string | null
}

// ── Cross-branch portfolio (/overview) ──────────────────────────────────────
// Aggregates only — no tenant name, phone, CNIC or room number ever crosses the
// RSC boundary on this page. One record per (branch × month) so the client can
// re-slice any period inside the prefetched window without another server call.

/** One month of one branch. Every figure is the same definition the per-branch
 *  Reports page uses — both sides call lib/report-math.ts. */
export interface PortfolioBranchMonth {
  monthKey: string
  collected: number
  pending: number
  /** Refundable deposits sitting INSIDE `collected` — subtract for true profit. */
  depositsCollected: number
  expenses: number
  kitchen: number
  salaries: number
}

export interface PortfolioBranch {
  id: string
  name: string
  city: string | null
  /** Point-in-time NOW, never scoped to the selected period. */
  activeMembers: number
  beds: number
  occupied: number
  /** Refundable liability held today. Mirrors the branch Dashboard's
   *  security_deposit_total, agreed figure included. */
  depositsHeld: number
  depositCount: number
  /** Deposit money billed across the whole prefetched window that never arrived.
   *  Window-wide on purpose so it does not move when the period pill changes. */
  depositsUnreceived: number
  months: PortfolioBranchMonth[]
}

export interface PortfolioMonth {
  monthKey: string
  label: string
}

export interface PortfolioSummary {
  branches: PortfolioBranch[]
  months: PortfolioMonth[]
  windowFrom: string
  windowTo: string
  currentMonthKey: string
}

// ── Referrals (/marketing) ──────────────────────────────────────────────────

export type ReferralStatus = "pending" | "joined" | "rejected" | "expired"

/** One shareable link. At most one row per tenant is ever is_active. */
export interface ReferralCode {
  id: string
  tenant_id: string
  hostel_id: string
  code: string
  is_active: boolean
  created_at: string
  updated_at: string
}

/** A submission from the public /ref/{code} form.
 *  `ip_address` is deliberately absent: it is abuse forensics, written by the
 *  public action and read by nobody, so it must never cross to a client. */
export interface Referral {
  id: string
  code_id: string
  referrer_tenant_id: string
  hostel_id: string
  owner_id: string
  name: string
  /** Raw as typed, for display and for the owner to dial. */
  phone: string
  /** normalizePhoneDigits() output — the only column matching reads. */
  phone_digits: string
  status: ReferralStatus
  matched_tenant_id: string | null
  matched_at: string | null
  rejected_at: string | null
  rejected_by: string | null
  created_at: string
  updated_at: string
}

/** One active tenant and their link, as the Marketing page renders it. */
export interface ReferrerRow {
  tenantId: string
  tenantName: string
  roomNumber: string | null
  /** null until a code has been minted for this tenant. */
  code: string | null
  /** Powers the one-tap wa.me hand-off — the owner's own WhatsApp, not the
   *  platform's business number, so it needs no template and costs nothing. */
  phone: string | null
  pending: number
  joined: number
  /** Every submission made through this person's link, whatever became of it —
   *  the denominator for "10 referred, 5 joined". */
  totalReferred: number
  /** Rupees this person has actually had taken off their own bills for referring
   *  people. Only 'applied' counts: queued and held rewards are a promise, and
   *  showing them as earnings makes the page disagree with the tenant's bill. */
  discountEarned: number
  /** Still coming to them — 'scheduled' plus 'held', estimated. */
  discountPending: number
  /** All-time human opens of this person's link. NOT month-scoped, unlike every
   *  other figure on the page — the UI has to say so rather than let it be read
   *  as this month's. Preview-crawler fetches are excluded; see linkShares. */
  linkOpens: number
  /** All-time link-preview fetches: the closest observable proxy for this person
   *  pasting their link into a chat. Forwarding itself is invisible to us. */
  linkShares: number
  /** Did the invite telling them about their link actually arrive?
   *  'none' = never attempted. Belongs here rather than on Payments, where a
   *  failed marketing blast was badging paid tenants as "Failed" on the rent
   *  screen. */
  inviteStatus: "none" | "sending" | "sent" | "delivered" | "read" | "failed"
  /** Most recent submission through their link. Null if they have never been
   *  used. Drives the sort: the person who sent someone yesterday matters more
   *  than the person who has held a link since March. */
  lastReferralAt: string | null
  /** Everything the people THIS person brought in have paid, combined. Set
   *  against discountEarned + the welcome discounts those tenants received, it
   *  is the whole business case for one advocate. */
  revenueFromReferred: number
}

/** One submission, flattened for the table. */
export interface ReferralRow {
  id: string
  name: string
  phone: string
  status: ReferralStatus
  createdAt: string
  /** Who sent this lead. 'pulse' means the platform's own per-branch link, which
   *  has no referring tenant at all — referrerTenantId, referrerName and
   *  referrerRoom are all null and no referrer-side reward exists. */
  source: "tenant" | "pulse"
  /** Null for every 'pulse' row. */
  referrerTenantId: string | null
  /** Null when source is 'pulse', or if the referring tenant's row has since
   *  been deleted. */
  referrerName: string | null
  /** The referrer's room. Two tenants genuinely share a name often enough that
   *  the name alone does not identify who earned the reward — the room is what
   *  the owner uses to confirm it. Null if they have no room assigned. */
  referrerRoom: string | null
  matchedTenantName: string | null
  matchedAt: string | null
  rejectedAt: string | null
  rejectedByName: string | null
  /** One-line plain-English state of the money this referral produced, e.g.
   *  "Applied Rs 1,500 · Aug" or "Held — waiting for first payment". Null when
   *  the referral never reached 'joined'. */
  rewardSummary: string | null
  /** The reward as a bare figure, so the column can be a column of numbers
   *  instead of a column of sentences. Null when the referral produced none. */
  rewardAmount: number | null
  /** Where that money has got to: Applied (off a bill), Queued (placed, not yet
   *  collected), Held (earned, waiting on the referred person's first payment),
   *  Expired, or None. Separate from the referral's own Joined/Pending status —
   *  a referral can convert and still pay nobody. */
  rewardState: "Applied" | "Queued" | "Held" | "Expired" | "None" | null
  /** What this tenant has actually PAID since joining — money kept, not money
   *  held. Refundable deposits are excluded, because a deposit sitting in the
   *  owner's account is a liability, not revenue. Null until the referral
   *  reaches 'joined' and there is a tenant to measure. */
  revenueCollected: number | null
}

/** Which side of the referral this reward pays. */
export type ReferralRewardRole = "referred" | "referrer"

/** scheduled = placed on a specific bill, not yet collected.
 *  held      = earned but unplaced (the referred person has not paid yet).
 *  applied   = the bill it sat on was settled; this is money actually given.
 *  expired   = ran out of open months, or the beneficiary checked out.
 *  void      = cancelled (referral rejected, branch disabled, tenant deleted). */
export type ReferralRewardStatus = "scheduled" | "held" | "applied" | "expired" | "void"

export interface ReferralRewardRow {
  id: string
  role: ReferralRewardRole
  status: ReferralRewardStatus
  /** Beneficiary — the tenant whose bill this comes off. */
  tenantId: string
  tenantName: string | null
  /** The other side of the referral, snapshotted so an orphaned reward still renders. */
  counterpartyName: string | null
  percent: number
  /** Null while 'held', 'expired' or 'void' — those carry no bill. */
  forMonth: string | null
  /** Populated only once status is 'applied'. */
  appliedAmount: number | null
  /** Branch name, because rewards are listed owner-wide, not per-branch. */
  hostelName: string | null
  expiresOn: string
  createdAt: string
}

/** A submission the "first submission wins" index turned away, kept so the
 *  owner can see that a second person claimed a number someone else had
 *  already submitted. */
export interface ReferralDuplicateRow {
  id: string
  name: string
  phone: string
  createdAt: string
  source: "tenant" | "pulse"
  referrerName: string | null
}


export interface ReferralOverview {
  hostelId: string | null
  hostelName: string | null
  /** False when Super Admin has not granted this branch the feature — the page
   *  renders an explanatory empty state rather than a table. */
  enabled: boolean
  /** Per-branch, owner-set. referredPercent is what the PUBLIC page promises a
   *  visitor, so it must be the same number the owner sees here. 0 on either
   *  side switches that side off. */
  referrerPercent: number
  referredPercent: number
  referrers: ReferrerRow[]
  referrals: ReferralRow[]
  duplicateClaims: ReferralDuplicateRow[]
  /** Owner-wide, not branch-scoped: a link shared at one branch is legitimately
   *  answered by an admission at another under the same owner, and the owner must
   *  be able to see and undo that from wherever they happen to be standing. */
  rewards: ReferralRewardRow[]
  /** The month every scoped figure below refers to, 'YYYY-MM'. */
  month: string
  /** Referrals SUBMITTED in `month`. The lists on the page show these; the
   *  lifetime totals below deliberately do not move with the picker. */
  joinedInMonth: number
  /** Of those, the ones who have actually PAID something. A referral that moved
   *  in and never settled a bill has cost the branch a discount and returned
   *  nothing, so it does not belong in an impact figure. */
  joinedPaidInMonth: number
  submittedInMonth: number
  /** Rupees given away on bills for `month` — the cost side of the ROI readout. */
  discountGivenThisMonth: number
  /** Discounts billed by THIS branch in `month`. discountGivenThisMonth is
   *  owner-wide, which is right for the liability copy and wrong for a
   *  per-branch subtraction — use this one in any P&L arithmetic. */
  discountGivenThisMonthBranch: number
  /** Pulse's one-time commission on referrals that converted in `month`, from
   *  hms_referrals.pulse_commission_amount — the amount ACTUALLY charged and
   *  snapshotted at conversion, never re-derived from today's rate. */
  /** The rate Pulse charges THIS branch, resolved through any per-branch relief
   *  — never the platform default on its own, or a client on a discounted rate
   *  sees a number that does not match their invoice. */
  pulseCommissionPercent: number
  pulseCommissionInMonth: number
  /** The half of `pulseCommissionInMonth` whose referred tenant has actually
   *  paid something. The fee accrues at conversion while revenue is cash, so
   *  this is the only half that can be set against collected revenue without
   *  comparing two different accounting bases. */
  pulseCommissionConfirmedInMonth: number
  /** The remainder: fees charged for tenants who have not yet paid a rupee.
   *  Shown, never netted off — a tenant who joined this morning is not a loss. */
  pulseCommissionPendingInMonth: number
  /** Referrals that reached 'joined' in `month` but have paid nothing yet. */
  joinedUnpaidInMonth: number
  /** Rupees given away since the feature was switched on, both sides combined.
   *  Paired with joined count, this is the whole business case: what the branch
   *  paid, against how many tenants it bought. */
  discountGivenTotal: number
  /** Everything every referred tenant has paid, combined. The revenue side of
   *  the same equation — discountGivenTotal is what it cost to earn it. */
  revenueFromReferralsTotal: number
  /** The same, but only what landed on bills for `month`. */
  revenueInMonth: number
  /** Still owed: 'scheduled' + 'held'. Rendered even when enabled is false, so
   *  switching the feature off can never hide a live liability. */
  openRewardCount: number
  openRewardValue: number
  /** 'off' | 'active' | 'paused'. */
  campaign: string
  /** Residents who have not yet been sent their link — what Start will send. */
  unsentCount: number
}

/** One branch on the Super Admin growth page. Occupancy and referral performance
 *  side by side: empty seats are the problem a prospect already has, the
 *  referral figures are the evidence this product solves it. */
export interface GrowthBranchRow {
  hostelId: string
  name: string
  city: string | null
  /** Sum of hms_rooms.capacity for the branch. 0 means rooms were never set up,
   *  which is a data-entry state, not a full hostel. */
  capacity: number
  /** Active, non-waiting tenants who hold a room. Derived from hms_tenants —
   *  NOT hms_rooms.occupied, which has drifted from reality in production. */
  filled: number
  /** capacity - filled, clamped at 0. The pitch number. */
  emptySeats: number
  occupancyPercent: number
  /** Active tenants with no room assigned. They pay, but occupy no bed, so they
   *  are outside the occupancy ratio and would otherwise silently vanish. */
  unroomedTenants: number
  waitingTenants: number
  referralEnabled: boolean
  campaign: string
  referralsSubmitted: number
  referralsJoined: number
  /** Everything referred tenants have paid, net of refundable deposits. */
  referralRevenue: number
  /** Rupees actually taken off bills — 'applied' only, never promised. */
  referralDiscounts: number
  pulseCommission: number
  /** The branch's own Pulse referral link code, null until referrals are
   *  enabled. Pulse pastes {origin}/ref/{code} wherever it likes; there is no
   *  referring tenant behind it. */
  pulseCode: string | null
  /** Opens and shares of that Pulse link — the only per-branch distribution
   *  signal Pulse has for its own marketing. */
  pulseViews: number
  pulseShares: number
}

export interface GrowthTotals {
  branches: number
  capacity: number
  filled: number
  emptySeats: number
  occupancyPercent: number
  referralsJoined: number
  referralRevenue: number
  referralDiscounts: number
  pulseCommission: number
  branchesRunningReferrals: number
}
