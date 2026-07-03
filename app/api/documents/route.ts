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
