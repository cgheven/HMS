export type SpaceType = "student" | "professional" | "general";
export type RoomStatus = "available" | "occupied" | "maintenance";
export type BillStatus = "paid" | "unpaid" | "overdue";
export type BillCategory = "electricity" | "water" | "internet" | "gas" | "maintenance" | "other";
export type ExpenseCategory = "furniture" | "repairs" | "cleaning" | "security" | "utilities" | "other";
export type MealType = "breakfast" | "lunch" | "dinner";
export type PaymentStatus = "paid" | "pending" | "overdue" | "waived";
export type PaymentMethod = "cash" | "bank_transfer" | "jazzcash" | "easypaisa" | "sadapay" | "other";
export type ComplaintCategory = "plumbing" | "electricity" | "cleanliness" | "security" | "furniture" | "other";
export type ComplaintPriority = "low" | "medium" | "high";
export type ComplaintStatus = "open" | "in_progress" | "resolved";
export type EmployeeRole = "cook" | "guard" | "cleaner" | "manager" | "driver" | "other";
export type HostelType = "boys" | "girls" | "mixed" | "family";
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
  package_tier?: FormFieldConfig;
  room_preference?: FormFieldConfig;
  move_in_date?: FormFieldConfig;
  notes?: FormFieldConfig;
}

export const DEFAULT_FORM_CONFIG: Required<FormConfig> = {
  email:           { enabled: true, required: false },
  cnic:            { enabled: true, required: false },
  package_tier:    { enabled: true, required: false },
  room_preference: { enabled: true, required: false },
  move_in_date:    { enabled: true, required: false },
  notes:           { enabled: true, required: false },
};

export interface PaymentMethodAccount {
  id: string;
  label: string;
  account_title?: string;
  account_number?: string;
  iban?: string;
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
  form_config: FormConfig | null;
  food_closed_on_sundays: boolean;
  cover_image_url: string | null;
  payment_methods: PaymentMethodAccount[];
  reminder_template: string | null;
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
  notes: string | null;
  photo_url: string | null;
  documents: TenantDocument[];
  created_at: string;
}

export interface Payment {
  id: string;
  hostel_id: string;
  tenant_id: string;
  for_month: string;
  amount: number;
  late_fee: number;
  payment_method: PaymentMethod | null;
  payment_date: string | null;
  status: PaymentStatus;
  receipt_number: string | null;
  notes: string | null;
  food_charge?: number;
  ac_units_consumed?: number;
  ac_charge?: number;
  payment_package_tier?: PackageTier | null;
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

export interface FoodItem {
  id: string;
  hostel_id: string;
  date: string;
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
  monthly_ac_units: number;
}

export interface Defaulter {
  id: string;
  name: string;
  amount: number;
  status: string;
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
  package_prices: Partial<Record<PackageTier, PackagePrices>>;
  seater_prices: Partial<Record<string, { no_ac: number; ac: number; deposit_no_ac?: number; deposit_ac?: number }>>;
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
  room_preference: string | null;
  room_id: string | null;
  package_tier: PackageTier;
  move_in_date: string | null;
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
}

export interface WaitlistEntry {
  id: string;
  hostel_id: string;
  name: string;
  phone: string;
  created_at: string;
}

export type StaffPermission = "add_members" | "collect_payments" | "add_expenses"

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
