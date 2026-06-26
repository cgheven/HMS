import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove } from "@/lib/auth";

const ALLOWED_BUCKETS = new Set(["application-docs", "tenant-documents"]);

export async function GET(req: NextRequest) {
  try {
    await requireOwnerOrAbove();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
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
