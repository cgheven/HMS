"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isTestOwner } from "@/lib/test-accounts";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("hms_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "super_admin") throw new Error("Forbidden: super_admin access required");
  return user;
}

export interface StudentRow {
  id: string;
  full_name: string;
  phone: string;
  type: string;
  hostel_id: string;
  hostel_name: string;
  city: string | null;
  room_number: string | null;
  institute_name: string | null;
  student_category: string | null;
  student_specialization: string | null;
  department: string | null;
  organization: string | null;
  organization_type: string | null;
  check_in: string | null;
}

// Cross-hostel resident directory for Super Admin — the read-only precursor to
// a student-facing portal that will match people by institute and department.
//
// CNIC, email, address and documents are deliberately not selected: this page
// exists to judge what academic data we hold across the platform, and none of
// those answer that question. Pulling them would put every client's residents'
// identity documents into one browsable list for no benefit.
export async function listAllStudents(): Promise<{
  students?: StudentRow[];
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    // FK joins rather than separate hostel/room queries — one round trip, no
    // JS id-map stitching.
    const { data, error } = await admin
      .from("hms_tenants")
      .select(
        "id, full_name, phone, type, hostel_id, check_in, institute_name, student_category, student_specialization, department, organization, organization_type, hostel:hms_hostels(name, city, owner_id), room:hms_rooms(room_number)"
      )
      .eq("is_active", true)
      .order("full_name");

    if (error) throw error;

    type Joined = {
      id: string;
      full_name: string;
      phone: string | null;
      type: string | null;
      hostel_id: string;
      check_in: string | null;
      institute_name: string | null;
      student_category: string | null;
      student_specialization: string | null;
      department: string | null;
      organization: string | null;
      organization_type: string | null;
      hostel: { name: string; city: string | null; owner_id: string } | { name: string; city: string | null; owner_id: string }[] | null;
      room: { room_number: string } | { room_number: string }[] | null;
    };

    const students: StudentRow[] = [];
    for (const t of (data ?? []) as unknown as Joined[]) {
      const hostel = Array.isArray(t.hostel) ? t.hostel[0] : t.hostel;
      const room = Array.isArray(t.room) ? t.room[0] : t.room;
      // Test accounts own real tenant rows; leaving them in would overstate how
      // much academic data the live client base has actually produced.
      if (!hostel || isTestOwner(hostel.owner_id)) continue;

      students.push({
        id: t.id,
        full_name: t.full_name,
        phone: t.phone ?? "",
        type: t.type ?? "general",
        hostel_id: t.hostel_id,
        hostel_name: hostel.name,
        city: hostel.city ?? null,
        room_number: room?.room_number ?? null,
        institute_name: t.institute_name ?? null,
        student_category: t.student_category ?? null,
        student_specialization: t.student_specialization ?? null,
        department: t.department ?? null,
        organization: t.organization ?? null,
        organization_type: t.organization_type ?? null,
        check_in: t.check_in ?? null,
      });
    }

    return { students };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load students" };
  }
}
