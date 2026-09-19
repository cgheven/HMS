"use server";

// In-app (same-origin) submit for the /book-demo form. The public HTTP API for
// the external marketing site lives at app/api/book-demo/route.ts — both share
// the secure core in lib/book-demo.ts.

import { processBookDemo, type BookDemoInput, type BookDemoResult } from "@/lib/book-demo";

export async function submitBookDemo(input: BookDemoInput): Promise<BookDemoResult> {
  return processBookDemo(input);
}
