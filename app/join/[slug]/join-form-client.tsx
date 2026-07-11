"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { Home, CheckCircle2, Loader2, Phone, Mail, User, CreditCard, Calendar, MessageSquare, Camera, Upload, X, RefreshCw, BedDouble, Check } from "lucide-react";
import { submitApplication } from "@/app/actions/applications";
import { uploadApplicationCnic } from "@/app/actions/public";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency, cn } from "@/lib/utils";
import { buildPackageOptions } from "@/lib/room-pricing";
import { SEATER_LABELS } from "@/lib/seater-pricing";
import type { PublicHostelDetail, PublicRoom, PackageTier, FormConfig } from "@/types";
import { DEFAULT_FORM_CONFIG } from "@/types";

interface Props {
  hostel: PublicHostelDetail;
  preselectedRoomNumber: string | null;
}

export function JoinFormClient({ hostel, preselectedRoomNumber }: Props) {
  const cfg = { ...DEFAULT_FORM_CONFIG, ...(hostel.form_config as FormConfig | null ?? {}) };
  const show = (key: keyof typeof cfg) => cfg[key]?.enabled !== false;
  const req  = (key: keyof typeof cfg) => cfg[key]?.required === true;

  const availableRooms = hostel.rooms.filter((r) => r.status !== "maintenance" && r.capacity - r.occupied > 0);
  const preselectedRoom = preselectedRoomNumber
    ? availableRooms.find((r) => r.room_number === preselectedRoomNumber) ?? null
    : null;

  // Fallback package tiers — used only when room selection is disabled for
  // this hostel (show("room_preference") === false), matching the old
  // behavior exactly so those hostels see zero change.
  const fallbackTierKeys = (() => {
    const prices = hostel.package_config?.package_prices ?? {};
    const keys = Object.keys(prices).filter((k) => k !== "_custom") as PackageTier[];
    return keys.length > 0 ? keys : (["space_only", "space_food", "space_3meals", "space_food_ac", "space_meals_cooler"] as PackageTier[]);
  })();

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    cnic: "",
    room_id: preselectedRoom?.id ?? "",
    package_tier: (preselectedRoom ? "space_only" : (fallbackTierKeys[0] ?? "space_only")) as PackageTier,
    move_in_date: "",
    notes: "",
  });

  const selectedRoom: PublicRoom | null = form.room_id ? hostel.rooms.find((r) => r.id === form.room_id) ?? null : null;
  const packageOptions = selectedRoom ? buildPackageOptions(selectedRoom, hostel.package_config) : [];
  // A room clicked on the browsing page arrives preselected — show just that
  // one room instead of the full list, with a way to expand and pick another.
  const [showRoomList, setShowRoomList] = useState(!preselectedRoom);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CNIC document upload state
  const cnicFileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cnicDoc, setCnicDoc] = useState<{ path: string; previewUrl: string } | null>(null);
  const [cnicUploading, setCnicUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Attach camera stream to video element whenever stream changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Start / restart camera stream
  const startCnicCamera = useCallback(async (mode: "user" | "environment") => {
    setCameraError(null);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera not supported in this browser.");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 } },
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Permission") || msg.includes("NotAllowed") || msg.includes("denied")) {
        setCameraError("Camera access denied. Please allow camera permissions and try again.");
      } else if (msg.includes("NotReadable") || msg.includes("in use")) {
        setCameraError("Camera is in use by another application.");
      } else {
        setCameraError("Could not access camera: " + msg);
      }
    }
  }, [stream]);

  async function processCnicFile(file: File) {
    setCnicUploading(true);
    const previewUrl = URL.createObjectURL(file);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadApplicationCnic(hostel.id, fd);
      if (result.error) {
        URL.revokeObjectURL(previewUrl);
        setError(result.error);
      } else if (result.path) {
        setCnicDoc({ path: result.path, previewUrl });
      }
    } catch (err: unknown) {
      URL.revokeObjectURL(previewUrl);
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setCnicUploading(false);
    }
  }

  function handleCnicFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    void processCnicFile(file);
  }

  async function openCnicCamera() {
    setCameraOpen(true);
    await startCnicCamera(facingMode);
  }

  async function flipCamera() {
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    await startCnicCamera(next);
  }

  async function captureFromCamera() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      closeCamera();
      await processCnicFile(new File([blob], "cnic.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  }

  function closeCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setCameraOpen(false);
    setCameraError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.full_name.trim()) { setError("Full name is required."); return; }
    if (!form.phone.trim()) { setError("WhatsApp number is required."); return; }
    if (show("email") && req("email") && !form.email.trim()) { setError("Email is required."); return; }
    if (show("cnic") && req("cnic") && !form.cnic.trim()) { setError("CNIC is required."); return; }
    if (show("move_in_date") && req("move_in_date") && !form.move_in_date) { setError("Move-in date is required."); return; }
    if (show("room_preference") && req("room_preference") && availableRooms.length > 0 && !form.room_id) {
      setError("Please select a room.");
      return;
    }

    setLoading(true);
    const result = await submitApplication(hostel.id, {
      full_name: form.full_name,
      phone: form.phone,
      email: show("email") ? form.email || undefined : undefined,
      cnic: show("cnic") ? form.cnic || undefined : undefined,
      package_tier: show("room_preference") && selectedRoom
        ? form.package_tier
        : (show("package_tier") ? form.package_tier : "space_only"),
      room_id: show("room_preference") && selectedRoom ? selectedRoom.id : undefined,
      room_preference: show("room_preference") && selectedRoom ? selectedRoom.room_number : undefined,
      move_in_date: show("move_in_date") ? form.move_in_date || undefined : undefined,
      notes: show("notes") ? form.notes || undefined : undefined,
      cnic_doc_path: cnicDoc?.path,
    });
    setLoading(false);

    if (result.success) {
      setSubmitted(true);
    } else {
      setError(result.error ?? "Something went wrong. Please try again.");
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-5 animate-fade-in">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-serif font-normal tracking-tight text-foreground">
              Application Submitted!
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Your application has been submitted! The team at{" "}
              <span className="font-semibold text-foreground">{hostel.name}</span> will contact you
              on WhatsApp soon.
            </p>
          </div>
          <div className="rounded-xl border border-sidebar-border bg-card p-4 text-left space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What happens next?</p>
            {[
              "The hostel owner reviews your application",
              "They will reach out to you on WhatsApp",
              "You visit and confirm the room",
              "Move-in and settle in!",
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber/10 border border-amber/20 text-amber text-xs font-bold shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-sidebar-border bg-sidebar/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20">
            <Home className="w-4 h-4 text-amber" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-none">{hostel.name}</p>
            {(hostel.city || hostel.area) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {[hostel.area, hostel.city].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground">
            Apply for a Room
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            Fill out the form below and the hostel team will contact you on WhatsApp.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Personal Info */}
          <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" /> Personal Information
            </h2>

            {/* Full Name — always visible */}
            <div className="space-y-1.5">
              <Label>Full Name <span className="text-rose-400">*</span></Label>
              <Input
                placeholder="Ahmed Khan"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </div>

            {/* Phone — always visible; Email — configurable */}
            <div className={`grid gap-4 ${show("email") ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                  WhatsApp Number <span className="text-rose-400">*</span>
                </Label>
                <Input
                  placeholder="0300 0000000"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  required
                />
                <p className="text-xs text-muted-foreground">Pakistan format: 03XX XXXXXXX</p>
              </div>

              {show("email") && (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                    Email {req("email") ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground text-xs">(optional)</span>}
                  </Label>
                  <Input
                    type="email"
                    placeholder="ahmed@email.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required={req("email")}
                  />
                </div>
              )}
            </div>

            {/* CNIC — configurable */}
            {show("cnic") && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                  CNIC {req("cnic") ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground text-xs">(optional)</span>}
                </Label>
                <Input
                  placeholder="XXXXX-XXXXXXX-X"
                  value={form.cnic}
                  onChange={(e) => setForm({ ...form, cnic: e.target.value })}
                  required={req("cnic")}
                />
                <p className="text-xs text-muted-foreground">Format: 42101-1234567-1</p>
              </div>
            )}

            {/* CNIC Document Upload */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                CNIC Document <span className="text-muted-foreground text-xs font-normal">(optional)</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Upload a photo or scan of your CNIC for identity verification.{" "}
                <span className="text-muted-foreground">(optional)</span>
              </p>
              <input
                ref={cnicFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleCnicFileInput}
              />
              {cnicUploading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Uploading...
                </div>
              ) : cnicDoc ? (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cnicDoc.previewUrl}
                    alt="CNIC preview"
                    className="w-24 h-16 object-cover rounded border border-sidebar-border"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 text-rose-400 hover:bg-rose-500/10"
                    onClick={() => {
                      URL.revokeObjectURL(cnicDoc.previewUrl);
                      setCnicDoc(null);
                    }}
                  >
                    <X className="w-3 h-3" />
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs"
                    onClick={() => cnicFileRef.current?.click()}
                    disabled={cnicUploading}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload CNIC
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs"
                    onClick={openCnicCamera}
                    disabled={cnicUploading}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Take Photo
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Room selection — a real room list with live pricing, replacing the
              old generic "Room Type Preference" category dropdown. The exact
              room picked here flows straight through to approval later, so
              staff doesn't have to re-figure it out. */}
          {show("room_preference") && availableRooms.length > 0 && (
            <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <BedDouble className="w-4 h-4 text-muted-foreground" /> Select Your Room {req("room_preference") && <span className="text-rose-400">*</span>}
                </h2>
                {!showRoomList && selectedRoom && (
                  <button
                    type="button"
                    onClick={() => setShowRoomList(true)}
                    className="text-xs font-medium text-amber hover:underline shrink-0"
                  >
                    Change room
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {(showRoomList || !selectedRoom ? availableRooms : [selectedRoom]).map((room) => {
                  const checked = form.room_id === room.id;
                  const price = buildPackageOptions(room, hostel.package_config)[0]?.price ?? room.monthly_rent;
                  const seaterLabel = SEATER_LABELS[String(room.capacity)] ?? `${room.capacity} Seater`;
                  const free = room.capacity - room.occupied;
                  return (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => {
                        setForm({ ...form, room_id: room.id, package_tier: "space_only" });
                        setShowRoomList(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                        checked ? "border-amber/40 bg-amber/[0.06]" : "border-sidebar-border hover:border-muted-foreground/30"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn(
                          "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                          checked ? "border-amber bg-amber" : "border-sidebar-border"
                        )}>
                          {checked && <Check className="w-2.5 h-2.5 text-background" strokeWidth={3} />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">Room {room.room_number}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {seaterLabel}{room.has_ac ? " · AC" : ""} · {free} {free === 1 ? "bed" : "beds"} free
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-amber shrink-0">{formatCurrency(price)}/mo</span>
                    </button>
                  );
                })}
              </div>

              {selectedRoom && packageOptions.length > 1 && (
                <div className="space-y-1.5 pt-1">
                  <Label>Package Preference</Label>
                  <Select
                    value={form.package_tier}
                    onValueChange={(v) => setForm({ ...form, package_tier: v as PackageTier })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {packageOptions.filter((o) => !o.disabled).map((o) => (
                        <SelectItem key={o.tier} value={o.tier}>
                          {o.label} <span className="text-muted-foreground">— {formatCurrency(o.price)}/mo</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Fallback — only used when this hostel has room selection disabled */}
          {!show("room_preference") && show("package_tier") && (
            <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Home className="w-4 h-4 text-muted-foreground" /> Room Preferences
              </h2>
              <div className="space-y-1.5">
                <Label>Package Preference {req("package_tier") && <span className="text-rose-400">*</span>}</Label>
                <Select
                  value={form.package_tier}
                  onValueChange={(v) => setForm({ ...form, package_tier: v as PackageTier })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fallbackTierKeys.map((tier) => (
                      <SelectItem key={tier} value={tier}>{tier.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {show("move_in_date") && (
            <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                  Preferred Move-in Date {req("move_in_date") ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground text-xs">(optional)</span>}
                </Label>
                <Input
                  type="date"
                  value={form.move_in_date}
                  onChange={(e) => setForm({ ...form, move_in_date: e.target.value })}
                  required={req("move_in_date")}
                />
              </div>
            </div>
          )}

          {/* Notes — configurable */}
          {show("notes") && (
            <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" /> Message / Questions
                {!req("notes") && <span className="text-xs font-normal text-muted-foreground">(optional)</span>}
              </h2>
              <textarea
                rows={4}
                placeholder="Any questions for the hostel? Special requirements?"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                required={req("notes")}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>
          )}


          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-amber text-background hover:bg-amber/90 font-semibold h-11 text-base gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Submitting Application…
              </>
            ) : (
              "Submit Application"
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            By submitting, you agree that the hostel team may contact you via WhatsApp.
          </p>
        </form>
      </div>

      {/* CNIC Camera Dialog */}
      <Dialog open={cameraOpen} onOpenChange={(o) => { if (!o) closeCamera(); }}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-sm">Take CNIC Photo</DialogTitle>
          </DialogHeader>

          <div className="relative bg-black aspect-video w-full overflow-hidden">
            {cameraError ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground px-6 text-center">
                {cameraError}
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            )}
            {/* Hidden canvas for capture */}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="flex items-center justify-between px-4 py-3 gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={closeCamera}
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={flipCamera}
              disabled={!!cameraError}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Flip
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 h-8 text-xs bg-amber text-background hover:bg-amber/90 font-semibold"
              onClick={captureFromCamera}
              disabled={!!cameraError || !stream}
            >
              <Camera className="w-3.5 h-3.5" />
              Capture
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
