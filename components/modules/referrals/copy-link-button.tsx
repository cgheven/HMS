"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** One implementation, two consumers: the owner's Marketing page (a tenant's
 *  link) and Super Admin Growth (the branch's Pulse link). */
export function CopyLinkButton({
  link,
  title = "Copy this referral link",
}: {
  link: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      // `link` is empty until the origin effect has run — copying then would
      // put a relative path on the clipboard.
      disabled={!link}
      // Icon only: four controls plus the money have to fit one phone row, and
      // the label is the first thing that can go without losing an action.
      className="gap-1.5 h-7 text-[11px] px-2 shrink-0"
      title={copied ? "Copied" : title}
      onClick={async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}
