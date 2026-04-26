export type SpaceType = "student" | "professional" | "general";
export type RoomStatus = "available" | "occupied" | "maintenance";
export type BillStatus = "paid" | "unpaid" | "overdue";
export type BillCategory = "electricity" | "water" | "internet" | "gas" | "maintenance" | "other";
export type ExpenseCategory = "furniture" | "repairs" | "cleaning" | "security" | "utilities" | "other";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type PaymentStatus = "paid" | "pending" | "overdue" | "waived";
export type PaymentMethod = "cash" | "bank_transfer" | "jazzcash" | "easypaisa" | "sadapay" | "other";
export type ComplaintCategory = "plumbing" | "electricity" | "cleanliness" | "security" | "furniture" | "other";
export type ComplaintPriority = "low" | "medium" | "high";
export type ComplaintStatus = "open" | "in_progress" | "resolved";

export interface Profile {
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
  hostel: { id: string; name: string; total_capacity: number } | null;
}

export interface Hostel {
  id: string;
  owner_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  total_capacity: number;
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
}

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
  monthly_rent: number;
  security_deposit: number;
  is_active: boolean;
  is_waiting: boolean;
  bed_number: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  notes: string | null;
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
  created_at: string;
  updated_at: string;
  tenant?: { full_name: string; room_id: string | null } | null;
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
  unpaid_bills: number;
  unpaid_bills_amount: number;
  occupancy_rate: number;
  monthly_revenue: number;
}

export interface RevenueMonth {
  month: string;
  monthKey: string;
  collected: number;
  due: number;
  expenses: number;
  collectionRate: number;
  occupancyRate: number;
  moveIns: number;
  moveOuts: number;
}

export interface AgingBucket {
  count: number;
  amount: number;
}
