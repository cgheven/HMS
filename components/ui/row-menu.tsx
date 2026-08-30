"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export interface RowMenuItem {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Renders in the destructive colour and sits below a divider. */
  danger?: boolean;
}

const MENU_W = 208; // 13rem — fixed, so the position can be computed before paint
const GAP = 6;
const EDGE = 8; // keep this far from the viewport edges

/**
 * Overflow menu for a table row's secondary actions.
 *
 * Exists because the payments row reached five inline buttons — Remind,
 * Receipt, preview, Collect Rest, Undo — which is a menu wearing a toolbar's
 * clothes: it crowds the row, buries the one action that matters, and forces
 * the action column wider every time anything is added.
 *
 * Rendered through a PORTAL onto document.body rather than inline. Every
 * payments list card is `rounded-2xl … overflow-hidden` (Due Today, Monthly and
 * History in payments-client.tsx), and an absolutely positioned child is clipped
 * by an overflow:hidden ancestor however high its z-index — which cut "Undo
 * Payment" off the last row of a short list. A fixed-position portal has no such
 * ancestor.
 *
 * Placement is computed from the trigger's viewport rect: right-aligned to the
 * trigger, clamped inside the viewport on both axes, and flipped above when
 * there is not enough room below. Those coordinates are a snapshot, so the menu
 * closes on scroll and resize as well as on outside click and Escape.
 */
export function RowMenu({ items, label = "More actions" }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Estimated height so the menu never paints in the wrong place; the layout
    // effect below corrects it against the measured height before the browser
    // paints, so there is no visible jump.
    const estimated = items.length * 38 + 16;
    const below = window.innerHeight - rect.bottom;
    const flip = below < estimated + GAP && rect.top > below;
    setPos({
      top: flip ? Math.max(EDGE, rect.top - estimated - GAP) : rect.bottom + GAP,
      left: Math.min(Math.max(EDGE, rect.right - MENU_W), Math.max(EDGE, window.innerWidth - MENU_W - EDGE)),
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!menu || !rect) return;
    const h = menu.offsetHeight;
    const fitsBelow = rect.bottom + GAP + h <= window.innerHeight - EDGE;
    const top = fitsBelow ? rect.bottom + GAP : Math.max(EDGE, rect.top - h - GAP);
    setPos((p) => (p && Math.abs(top - p.top) > 1 ? { ...p, top } : p));
    // `pos` is deliberately not a dependency: this effect corrects pos, and
    // depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const usable = items.filter(Boolean);
  if (usable.length === 0) return null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) place();
          setOpen((v) => !v);
        }}
        className={`h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md border transition-colors ${
          open
            ? "border-sidebar-border bg-white/[0.06] text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
        }`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W }}
            className="z-[100] rounded-xl border border-sidebar-border bg-card shadow-2xl p-1 animate-fade-in"
          >
            {usable.map((item, i) => {
              const prev = usable[i - 1];
              return (
                <div key={item.label}>
                  {item.danger && prev && !prev.danger && <div className="my-1 h-px bg-sidebar-border" />}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(false);
                      item.onSelect();
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                      item.danger
                        ? "text-muted-foreground hover:text-rose-300 hover:bg-rose-500/10"
                        : "text-foreground hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="shrink-0 w-4 flex items-center justify-center text-muted-foreground">
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
