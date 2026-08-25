"use client";

import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, Trash2, Pencil, X, Check } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  parseLeadList, DROP_LABELS, type ParseResult, type DropReason,
} from "@/lib/lead-list-import";
import {
  importLeadList, existingLeadDigits, deleteLeadList, renameLeadList,
} from "@/app/actions/lead-lists";
import type { LeadList } from "@/types";

interface Props {
  open: boolean;
  lists: LeadList[];
  onClose: () => void;
  /** Called after anything that changed the data, so the page can refetch both
   *  the list index and the campaign audience in one pass. */
  onChanged: () => void;
}

const DROP_ORDER: DropReason[] = ["no_phone", "landline", "closed", "duplicate", "no_name"];

export function LeadListImportDialog({ open, lists, onClose, onChanged }: Props) {
  const [name, setName] = useState("");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setName(""); setRawRows([]); setPreview(null); setFileName("");
    setRenaming(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  /**
   * Parsed in the browser so the admin sees what will land before anything is
   * written. The server re-runs the identical parser on commit — this preview
   * is a courtesy, never the authority.
   *
   * xlsx is ~400kB and this dialog is the only thing on the page that needs it,
   * so it is pulled in on the first file rather than in the page bundle.
   */
  async function handleFile(file: File) {
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("That file has no sheets in it");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      if (rows.length === 0) throw new Error("That sheet is empty");

      // Asked for before parsing, so "already on a list" is judged against the
      // whole database rather than only against this file.
      const { digits } = await existingLeadDigits();
      setRawRows(rows);
      setPreview(parseLeadList(rows, new Set(digits)));
      setFileName(file.name);
      if (!name.trim()) setName(file.name.replace(/\.(xlsx|xls|csv)$/i, "").replace(/[_-]+/g, " ").trim());
    } catch (err) {
      toast({
        title: "Could not read that file",
        description: err instanceof Error ? err.message : "Expected a .xlsx, .xls or .csv",
        variant: "destructive",
      });
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleImport() {
    if (!preview || preview.contacts.length === 0) return;
    setImporting(true);
    const res = await importLeadList({ name, rows: rawRows });
    setImporting(false);
    if (res.error) {
      toast({ title: "Import failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: `${res.imported} hostels imported`,
      description: `${res.skipped} rows skipped. They are on the Marketing page only — nothing was added to Leads.`,
    });
    reset();
    onChanged();
  }

  async function handleDeleteList(list: LeadList) {
    const res = await deleteLeadList(list.id);
    if (res.error) {
      toast({ title: "Could not delete", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `"${list.name}" deleted`, description: `${list.contact_count} contacts removed.` });
    onChanged();
  }

  async function handleRename(id: string) {
    const res = await renameLeadList(id, renameValue);
    setRenaming(null);
    if (res.error) {
      toast({ title: "Could not rename", description: res.error, variant: "destructive" });
      return;
    }
    onChanged();
  }

  const dropTotal = preview
    ? DROP_ORDER.reduce((a, r) => a + preview.dropped[r], 0)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Marketing lists</DialogTitle>
          <DialogDescription>
            An imported list is a campaign audience only. It never appears on the Leads
            board, is never assigned to a rep, and never enters the follow-up cron — but it
            shares the same do-not-contact list, 24-hour cooldown and send-once ledger, so
            a hostel that is in both a list and the CRM still only ever gets one message.
          </DialogDescription>
        </DialogHeader>

        {lists.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Your lists</Label>
            {lists.map((l) => (
              <div key={l.id} className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                {renaming === l.id ? (
                  <>
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleRename(l.id); }}
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => void handleRename(l.id)}>
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setRenaming(null)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{l.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {l.contact_count} hostels
                        {l.messaged_count > 0 && ` · ${l.messaged_count} messaged`}
                      </p>
                    </div>
                    <Button
                      size="sm" variant="ghost" className="h-8 w-8 p-0"
                      onClick={() => { setRenaming(l.id); setRenameValue(l.name); }}
                      title="Rename"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className="h-8 w-8 p-0 text-rose-400 hover:text-rose-300 disabled:opacity-30"
                      disabled={l.messaged_count > 0}
                      onClick={() => void handleDeleteList(l)}
                      title={
                        l.messaged_count > 0
                          ? `${l.messaged_count} on this list have been messaged — deleting it would lose the record that stops them being messaged again`
                          : `Delete "${l.name}" and its ${l.contact_count} contacts`
                      }
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 pt-1">
          <Label className="text-xs text-muted-foreground">Import a new list</Label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
          />
          <Button
            variant="outline"
            className="w-full gap-2 h-16 border-dashed"
            onClick={() => fileRef.current?.click()}
            disabled={parsing || importing}
          >
            <Upload className="w-4 h-4" />
            {parsing ? "Reading..." : fileName || "Choose a .xlsx or .csv file"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Columns are matched by name in any order: hostel / business name, phone / mobile,
            city, email. Anything else in the sheet is ignored.
          </p>

          {preview && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <p className="text-sm">
                <span className="text-2xl font-semibold text-emerald-400">{preview.contacts.length}</span>
                <span className="text-muted-foreground"> hostels will be imported</span>
                {dropTotal > 0 && (
                  <span className="text-muted-foreground"> · {dropTotal} skipped</span>
                )}
              </p>
              {/* Named, not just counted. "151 skipped" is a number to worry
                  about; "132 with no phone, 19 landlines" is a decision already
                  made. */}
              <div className="space-y-1">
                {DROP_ORDER.filter((r) => preview.dropped[r] > 0).map((r) => (
                  <div key={r} className="text-[11px] text-muted-foreground">
                    <span className="tabular-nums font-medium text-foreground/70">{preview.dropped[r]}</span>
                    {" "}{DROP_LABELS[r]}
                    {preview.samples[r] && (
                      <span className="opacity-60"> — e.g. {preview.samples[r]!.slice(0, 2).join("; ")}</span>
                    )}
                  </div>
                ))}
              </div>
              {preview.contacts.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] text-muted-foreground mb-1">First few, exactly as they will be saved:</p>
                  {preview.contacts.slice(0, 3).map((c) => (
                    <p key={c.digits} className="text-[11px] truncate">
                      <span className="font-medium">{c.business_name}</span>
                      <span className="text-muted-foreground"> · {c.phone}{c.city ? ` · ${c.city}` : ""}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {preview && preview.contacts.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="list-name" className="text-xs text-muted-foreground">List name</Label>
              <Input
                id="list-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Punjab hostels"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Close</Button>
          <Button
            className={cn("gap-2", !preview && "hidden")}
            disabled={importing || !preview || preview.contacts.length === 0 || name.trim().length < 2}
            onClick={() => void handleImport()}
          >
            {importing ? "Importing..." : `Import ${preview?.contacts.length ?? 0}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
