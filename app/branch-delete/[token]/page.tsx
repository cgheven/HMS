import { getBranchDeletionInfo } from "@/app/actions/branches";
import { BranchDeleteConfirm } from "@/components/modules/branches/branch-delete-confirm";

export default async function BranchDeletePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await getBranchDeletionInfo(token);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <BranchDeleteConfirm token={token} info={info} />
    </div>
  );
}
