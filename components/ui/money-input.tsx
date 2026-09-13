"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A money entry box that shows the currency symbol INSIDE the field ("£ 5,000")
 * instead of appending an ISO code to the label. The symbol follows the active
 * hostel's country (e.g. "£" / "Rs"), so labels can read plainly ("Security
 * Deposit") and the currency is unambiguous per property.
 */
export function MoneyInput({
  symbol,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { symbol: string }) {
  // "Rs" is two glyphs, "£" one — widen the left inset a touch for the longer one.
  const pad = symbol.length > 1 ? "pl-10" : "pl-7";
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        {symbol}
      </span>
      <Input className={cn(pad, className)} {...props} />
    </div>
  );
}
