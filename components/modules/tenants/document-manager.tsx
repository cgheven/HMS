"use client";

import { useRef, useState } from "react";
import {
  FileText, FileImage, Upload, Trash2, Download,
  Loader2, Plus, ShieldCheck, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  uploadTenantDocument,
  deleteTenantDocument,
  getDocumentSignedUrl,
} from "@/app/actions/tenants";
import type { TenantDocument, DocumentType } from "@/types";
import { DOCUMENT_TYPE_LABELS } from "@/types";

interface Props {
  tenantId: string;
  tenantName: string;
  documents: TenantDocument[];
  onChange: (docs: TenantDocument[]) => void;
}

const DOC_TYPE_OPTIONS = Object.entries(DOCUMENT_TYPE_LABELS) as [DocumentType, string][];

function docIcon(type: DocumentType) {
  if (type === "cnic" || type === "passport") return <FileImage className="w-4 h-4 text-blue-400 shrink-0" />;
  if (type === "police_verification") return <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />;
  return <FileText className="w-4 h-4 text-amber/80 shrink-0" />;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
}

export function DocumentManager({ tenantId, tenantName, documents, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [docType, setDocType] = useState<DocumentType>("cnic");
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum size is 10 MB. Please compress the file and try again.", variant: "destructive" });
      return;
    }

    setUploading(true);

    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadTenantDocument(tenantId, docType, fd);
    setUploading(false);

    if (result.error) {
      toast({ title: "Upload failed", description: result.error, variant: "destructive" });
    } else if (result.document) {
      onChange([...documents, result.document]);
      setAdding(false);
      toast({ title: "Document uploaded", description: `${DOCUMENT_TYPE_LABELS[docType]} added for ${tenantName}.` });
    }
  }

  async function handleDownload(doc: TenantDocument) {
    setDownloadingId(doc.id);
    // F3: fetch a server-generated signed URL with Content-Disposition: attachment
    // Raw storage URL is never stored in the browser — project ref stays server-side
    const result = await getDocumentSignedUrl(tenantId, doc.id);
    setDownloadingId(null);

    if (result.error) {
      toast({ title: "Cannot open document", description: result.error, variant: "destructive" });
    } else if (result.url) {
      const a = document.createElement("a");
      a.href = result.url;
      a.rel = "noopener noreferrer";
      a.click();
    }
  }

  async function handleDelete(docId: string) {
    setDeletingId(docId);
    const result = await deleteTenantDocument(tenantId, docId);
    setDeletingId(null);

    if (result.error) {
      toast({ title: "Delete failed", description: result.error, variant: "destructive" });
    } else {
      onChange(documents.filter((d) => d.id !== docId));
      toast({ title: "Document removed" });
    }
  }

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Verification Documents</span>
          {documents.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-amber/10 border border-amber/20 text-amber text-[10px] font-bold">
              {documents.length}
            </span>
          )}
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs text-amber hover:text-amber/80 transition-colors font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Add Document
          </button>
        )}
      </div>

      {/* Upload form */}
      {adding && (
        <div className="rounded-xl border border-sidebar-border bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Document</p>
            <button type="button" onClick={() => setAdding(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Document Type</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as DocumentType)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPE_OPTIONS.map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={handleFile}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2 h-9 text-sm border-dashed"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
              : <><Upload className="w-3.5 h-3.5" /> Choose File (PDF, JPG, PNG · max 10 MB)</>
            }
          </Button>
        </div>
      )}

      {/* Document list */}
      {documents.length === 0 && !adding ? (
        <div className="rounded-xl border border-dashed border-sidebar-border py-6 flex flex-col items-center gap-2 text-center">
          <ShieldCheck className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No documents yet</p>
          <p className="text-xs text-muted-foreground/60">Upload CNIC, police verification, or lease agreement</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-sidebar-border bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
            >
              {docIcon(doc.type)}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{doc.name}</p>
                <p className="text-xs text-muted-foreground">
                  {DOCUMENT_TYPE_LABELS[doc.type]} · {formatDate(doc.uploaded_at)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* F3: download via signed URL — no raw Supabase URL ever reaches the client */}
                <button
                  type="button"
                  onClick={() => handleDownload(doc)}
                  disabled={downloadingId === doc.id}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
                  title="Download"
                >
                  {downloadingId === doc.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Download className="w-3.5 h-3.5" />
                  }
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(doc.id)}
                  disabled={deletingId === doc.id}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  title="Delete"
                >
                  {deletingId === doc.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2 className="w-3.5 h-3.5" />
                  }
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
