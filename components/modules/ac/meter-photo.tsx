"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, Loader2, Trash2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Attach / view / remove the photograph behind an AC meter reading.
 *
 * Deliberately dumb about WHICH reading it belongs to: the parent supplies an
 * upload and a delete, so the same control serves the per-tenant move-in
 * reading and the per-room monthly reading without either one growing its own
 * near-identical widget.
 *
 * `capture="environment"` matters more than it looks — on a phone it opens the
 * rear camera straight onto the meter instead of the gallery, which is the
 * whole point: the photo is taken standing at the dial, not found later.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Direct public URL for a stored path (migration 159 made the bucket public).
 *
 * Built here rather than fetched: a meter photo carries no personal data, and
 * asking the server to mint a signed URL first put a round trip in front of a
 * picture operators open constantly. A plain href opens instantly, works with
 * middle-click and "open in new tab", and needs no client state at all.
 */
function publicUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/ac-meter-photos/${path}`;
}

interface Props {
  /** Stored path, or null when nothing has been attached yet. */
  path: string | null;
  /** Runs the upload. Omit to render read-only (e.g. insufficient tier). */
  onUpload?: (file: File) => Promise<{ error?: string }>;
  onDelete?: () => Promise<{ error?: string }>;
  /** Blocks upload with this reason instead of failing on the server. */
  disabledReason?: string;
  /**
   * Filename of a photo picked but not yet uploaded.
   *
   * Exists for the Add Tenant dialog: the tenant row does not exist until the
   * form is saved, so there is no id to attach a photo to yet. The parent holds
   * the File and uploads it once the insert returns, and this renders the
   * in-between state honestly — attached, not yet stored, so no View button.
   */
  stagedLabel?: string;
  label?: string;
  className?: string;
}

export function MeterPhoto({ path, onUpload, onDelete, disabledReason, stagedLabel, label = "Meter photo", className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const readOnly = !onUpload;

  function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    // Check here as well as on the server: a 10 MB upload that fails validation
    // after the round trip wastes the operator's mobile data at the meter.
    if (!ALLOWED.has(file.type)) return setError("Use a JPEG, PNG or WebP image.");
    if (file.size > MAX_BYTES) return setError("Photo is over 10 MB.");
    startBusy(async () => {
      const res = await onUpload!(file);
      if (res?.error) setError(res.error);
    });
  }

  function remove() {
    if (!onDelete) return;
    setError(null);
    startBusy(async () => {
      const res = await onDelete();
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {path ? (
          <>
            {/* A real href, not an onClick handler.
                Two reasons. The Tenant dialog wraps its body in
                <fieldset disabled> for read-only mode, which would disable a
                <button> and black out the evidence in exactly the situation it
                exists for — looking a reading up during a dispute; anchors are
                untouched by that. And a plain href opens instantly, supports
                middle-click and "open in new tab", and needs no round trip. */}
            <a
              href={publicUrl(path)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 h-8 pl-1 pr-2.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-colors select-none"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase storage host, not in next.config images */}
              <img
                src={publicUrl(path)}
                alt=""
                className="w-6 h-6 rounded object-cover border border-emerald-500/20"
                loading="lazy"
              />
              View {label.toLowerCase()}
            </a>
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-white/10 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  Replace
                </button>
                {onDelete && (
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-white/10 text-muted-foreground hover:text-rose-400 hover:border-rose-500/25 transition-colors disabled:opacity-50"
                    aria-label={`Remove ${label.toLowerCase()}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </>
        ) : stagedLabel ? (
          <>
            <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-amber/25 bg-amber/10 text-amber text-xs font-medium max-w-[220px]">
              <Camera className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{stagedLabel}</span>
            </span>
            <span className="text-[11px] text-muted-foreground/60">Uploads when you save</span>
            {onDelete && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-white/10 text-muted-foreground hover:text-rose-400 hover:border-rose-500/25 transition-colors disabled:opacity-50"
                aria-label={`Remove ${label.toLowerCase()}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        ) : readOnly ? (
          <span className="text-xs text-muted-foreground/60">No {label.toLowerCase()} on record</span>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy || !!disabledReason}
            title={disabledReason}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-amber/25 bg-amber/10 text-amber text-xs font-medium hover:bg-amber/20 transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            Attach {label.toLowerCase()}
          </button>
        )}
      </div>

      {disabledReason && !path && (
        <p className="text-[11px] text-muted-foreground/60">{disabledReason}</p>
      )}
      {error && (
        <p className="flex items-start gap-1 text-[11px] text-rose-400">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = ""; // let the same file be re-picked after an error
        }}
      />
    </div>
  );
}
