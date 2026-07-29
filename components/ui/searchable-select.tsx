"use client";
import { useState, useRef } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  searchPlaceholder?: string;
  // When set, a pinned option is always shown below the filtered list,
  // calling onValueChange("other") when picked — same contract as the plain
  // <Select> "other" sentinel this component replaces.
  otherLabel?: string;
  className?: string;
}

// A searchable dropdown, styled to match the existing Radix-based <Select>.
// Built because Radix Select doesn't support an embedded search input well
// (it intercepts keystrokes for its own internal typeahead-jump behavior),
// and adding a full Combobox (cmdk) was more than this needed for a couple
// of long preset lists.
//
// Built on Radix Popover rather than a hand-rolled portal+position+escape
// implementation: several call sites live inside a modal Dialog
// (overflow-y-auto), and a plain component doesn't participate in Radix's
// DismissableLayer stack — that caused two real bugs during review (the
// Dialog's own pointer-events lockout made every option unclickable, and
// Escape closed the whole Dialog instead of just the dropdown). Popover.Content
// is built on the same DismissableLayer + Portal + Popper primitives Select
// itself uses, so nesting inside a modal Dialog is handled correctly for free.
export function SearchableSelect({
  value, onValueChange, options, placeholder = "Select", searchPlaceholder = "Search...", otherLabel, className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function select(v: string) {
    onValueChange(v);
    setOpen(false);
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            className
          )}
        >
          <span className={cn("truncate text-left", !value && "text-muted-foreground")}>{value || placeholder}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          style={{ width: "var(--radix-popover-trigger-width)" }}
          className="z-50 rounded-xl border border-sidebar-border bg-card text-foreground shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div
            className="max-h-60 overflow-y-auto overscroll-contain p-1"
            // Radix Dialog locks page scroll while open (react-remove-scroll),
            // which intercepts wheel/touch scroll events on document and blocks
            // any it doesn't recognize as originating inside the Dialog's own
            // content. This Popover renders through its own Portal, so — even
            // though it's visually stacked above the Dialog — it isn't a DOM
            // descendant of DialogContent, and the lock swallowed scroll
            // gestures here before they could move this list. Stopping
            // propagation keeps the event from ever reaching that document
            // listener, so the list scrolls like any normal element.
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">No matches</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => select(o)}
                  className="relative flex w-full cursor-default select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-white/10 focus:bg-white/10 text-left"
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    {value === o && <Check className="h-3.5 w-3.5" />}
                  </span>
                  {o}
                </button>
              ))
            )}
            {otherLabel && (
              <button
                type="button"
                onClick={() => select("other")}
                className="relative flex w-full cursor-default select-none items-center rounded-lg py-1.5 pl-2 pr-2 text-sm outline-none hover:bg-white/10 focus:bg-white/10 text-left border-t border-sidebar-border mt-1 pt-2.5 text-muted-foreground"
              >
                {otherLabel}
              </button>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
