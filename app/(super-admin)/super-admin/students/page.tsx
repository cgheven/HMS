import { requireSuperAdmin } from "@/lib/auth";
import { listAllStudents } from "@/app/actions/students";
import { SuperAdminStudentsClient } from "@/components/modules/super-admin/students-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminStudentsPage() {
  await requireSuperAdmin();

  const { students } = await listAllStudents();

  return <SuperAdminStudentsClient students={students ?? []} />;
}
