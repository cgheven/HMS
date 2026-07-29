import { notFound } from "next/navigation";
import { getPublicHostelByComplaintCode } from "@/app/actions/public";
import { ComplaintFormClient } from "./complaint-form-client";

interface Props {
  params: Promise<{ code: string }>;
}

export default async function ComplaintPage({ params }: Props) {
  const { code } = await params;
  const { hostel, error } = await getPublicHostelByComplaintCode(code);

  if (error || !hostel) notFound();

  return <ComplaintFormClient hostel={hostel} complaintCode={code} />;
}
