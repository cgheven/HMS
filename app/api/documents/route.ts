import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";

const ALLOWED_BUCKETS = new Set(["application-docs", "tenant-documents"]);

export async function GET(req: NextRequest) {
  // read_only: viewing a tenant's CNIC/lease scan is a read, available to any
  // active tier. Previously requireOwnerOrAbove(), which redirects partners and
  // surfaced here as a 401 — partners could not open their own branch's
  // documents at all.
  let ctx;
  try {
    await requireOwnerOrPartnerTier("read_only");
    ctx = await getAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ctx?.hostelId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  // path format: "<bucket>/<rest...>"
  const slashIdx = path.indexOf("/");
  if (slashIdx === -1) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  const bucket = path.slice(0, slashIdx);
  const objectPath = path.slice(slashIdx + 1);

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // The signed URL below is minted with the service role, which bypasses the
  // storage.objects policies entirely — so this route is the ONLY thing
  // deciding who may read the object, and objectPath is caller-supplied. Both
  // buckets encode the owning entity as the first path segment
  // (application-docs/<hostelId>/..., tenant-documents/<tenantId>/...); resolve
  // it back to a hostel and require it to match the caller's active branch.
  // Without this, any authenticated user could read any tenant's CNIC, passport
  // or lease scan from any hostel on the platform by supplying its path.
  const scopeId = objectPath.split("/")[0];
  if (!scopeId) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  if (bucket === "application-docs") {
    if (scopeId !== ctx.hostelId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    const { data: tenant } = await admin
      .from("hms_tenants")
      .select("hostel_id")
      .eq("id", scopeId)
      .maybeSingle();
    if (!tenant || tenant.hostel_id !== ctx.hostelId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(objectPath, 60); // 60-second URL — only used server-side

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Could not generate URL" }, { status: 500 });
  }

  // Proxy the file — Supabase URL never reaches the browser
  const upstream = await fetch(data.signedUrl);
  if (!upstream.ok) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  let contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

  // Supabase often returns octet-stream when no MIME type was set at upload time.
  // Infer from the extension so the browser renders instead of downloading.
  if (contentType === "application/octet-stream") {
    const ext = objectPath.split(".").pop()?.toLowerCase();
    const MIME: Record<string, string> = {
      pdf:  "application/pdf",
      png:  "image/png",
      jpg:  "image/jpeg",
      jpeg: "image/jpeg",
      gif:  "image/gif",
      webp: "image/webp",
    };
    if (ext && MIME[ext]) contentType = MIME[ext];
  }

  const body = await upstream.arrayBuffer();

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
    },
  });
}
