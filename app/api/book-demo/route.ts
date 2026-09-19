import { NextResponse, type NextRequest } from "next/server";
import { processBookDemo, type BookDemoInput } from "@/lib/book-demo";

// Public "Book a Demo" endpoint for the yourpulse.io marketing site.
//
// POST application/json → { success: true } | { error: string }. Same secure core
// as the in-app form (honeypot, per-IP + per-phone rate limit, disposable-email
// block, validation, service-role write). Meant to be called CLIENT-SIDE from the
// visitor's browser so the real visitor IP drives the rate limit + honeypot.
// Added to PUBLIC_WEBHOOKS in middleware.ts so the auth gate doesn't 302 it.

export const runtime = "nodejs";

// Origins allowed to POST here. Override with BOOK_DEMO_ALLOWED_ORIGINS
// (comma-separated) if the marketing domain differs.
const DEFAULT_ORIGINS = [
  "https://yourpulse.io",
  "https://www.yourpulse.io",
  "http://localhost:3000",
  "http://localhost:3001",
];
const ALLOWED_ORIGINS = new Set(
  (process.env.BOOK_DEMO_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_ORIGINS)
);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req.headers.get("origin"));
  let body: BookDemoInput;
  try {
    body = (await req.json()) as BookDemoInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: cors });
  }
  const result = await processBookDemo(body ?? {});
  return NextResponse.json(result, { status: result.error ? 400 : 200, headers: cors });
}
