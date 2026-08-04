import type { SeaterPrices } from "@/lib/seater-pricing";

export type SpaceType = "student" | "professional" | "general";
export type StudentCategory = "university" | "college" | "test_preparation" | "professional_course" | "skills_training";
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
  role: Role;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
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
  emergency_contact:  { enabled: true, required: false },
  permanent_address:  { enabled: true, required: true },
  notes:              { enabled: true, required: false },
  institute_name:     { enabled: true, required: false },
  student_category:   { enabled: true, required: false },
  organization:       { enabled: true, required: false },
  department:         { enabled: true, required: false },
};

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
  food_breakfast: boolean;
  food_lunch: boolean;
  food_dinner: boolean;
  is_active: boolean;
  is_waiting: boolean;
  bed_number: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  emergency_relationship: string | null;
  /** Tenant's home/permanent address — distinct from the hostel they live in. */
  permanent_address: string | null;
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
  /** Recurring monthly, re-derived fresh by the recalculation trigger from room.has_ac + the hostel's ac_maintenance_rate — independent of package tier. */
  ac_maintenance_charge?: number;
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
  created_at: string;
  updated_at: string;
  sales_rep?: { id: string; name: string } | null;
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
