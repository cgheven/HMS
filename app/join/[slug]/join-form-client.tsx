"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { Home, CheckCircle2, Loader2, Phone, Mail, User, CreditCard, Calendar, MessageSquare, Camera, Upload, X, RefreshCw, BedDouble, Check, ShieldAlert } from "lucide-react";
import { submitApplication } from "@/app/actions/applications";
import { uploadApplicationCnic } from "@/app/actions/public";
import { formatCnic, isValidCnic } from "@/lib/cnic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency, cn } from "@/lib/utils";
import { buildPackageOptions } from "@/lib/room-pricing";
import { SEATER_LABELS } from "@/lib/seater-pricing";
import type { PublicHostelDetail, PublicRoom, PackageTier, FormConfig, StudentCategory } from "@/types";
import { DEFAULT_FORM_CONFIG } from "@/types";
import { STUDENT_CATEGORY_LABELS, STUDENT_CATEGORY_OPTIONS, studentCategoryHasDepartment, studentCategoryHasSpecialization, STUDENT_SPECIALIZATION_PRESETS, INSTITUTE_PRESETS_BY_CATEGORY, studentCategoryHasInstitutePresets } from "@/lib/student-category-labels";

interface Props {
  hostel: PublicHostelDetail;
  preselectedRoomNumber: string | null;
}

const RELATIONSHIP_OPTIONS = [
  "Father", "Mother", "Brother", "Sister", "Spouse",
  "Chachu (Paternal Uncle)", "Mamu (Maternal Uncle)", "Cousin", "Guardian", "Friend",
];

export function JoinFormClient({ hostel, preselectedRoomNumber }: Props) {
  const cfg = { ...DEFAULT_FORM_CONFIG, ...(hostel.form_config as FormConfig | null ?? {}) };
  const show = (key: keyof typeof cfg) => cfg[key]?.enabled !== false;
  const req  = (key: keyof typeof cfg) => cfg[key]?.required === true;

  const availableRooms = hostel.rooms.filter((r) => r.status !== "maintenance" && r.capacity - r.occupied > 0);
  const preselectedRoom = preselectedRoomNumber
    ? availableRooms.find((r) => r.room_number === preselectedRoomNumber) ?? null
    : null;

  // A room is only ever picked here when the applicant arrived via a specific
  // room's "Apply" link (?room=...) on the public browsing page. Someone who
  // opens the bare share URL directly is a walk-in — they fill out the form
  // and the hostel assigns a room in person later, so no room list is shown.
  const showRoomPicker = show("room_preference") && !!preselectedRoom && availableRooms.length > 0;

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    cnic: "",
    type: "student" as "student" | "professional" | "general",
    room_id: preselectedRoom?.id ?? "",
    package_tier: "space_only" as PackageTier,
    move_in_date: "",
    permanent_address: "",
    emergency_contact: "",
    emergency_phone: "",
    emergency_relationship: "",
    notes: "",
    institute_name: "",
    student_category: "" as "" | StudentCategory,
    student_specialization: "",
    organization: "",
    organization_type: "" as "" | "private" | "government",
    department: "",
  });
  const [customSpecialization, setCustomSpecialization] = useState(false);
  const [customInstitute, setCustomInstitute] = useState(false);

  const selectedRoom: PublicRoom | null = form.room_id ? hostel.rooms.find((r) => r.id === form.room_id) ?? null : null;

  // Institute/Organization only make sense once a Type is picked — never
  // shown for General, and each only for its matching type. Department
  // applies to Professional always, and to Student only for categories that
  // have a meaningful "department" (not Test Prep/Professional Course/Skills
  // Training, which get a Specialization dropdown instead).
  const showInstitute = show("institute_name") && form.type === "student";
  const showStudentCategory = show("student_category") && form.type === "student";
  const showSpecialization = showStudentCategory && studentCategoryHasSpecialization(form.student_category);
  const showOrganization = show("organization") && form.type === "professional";
  const showDepartment = show("department") && (
    form.type === "professional" || (form.type === "student" && studentCategoryHasDepartment(form.student_category))
  );

  // Institute Name — rendered right after Student Category for University/College
  // (no Specialization step to sequence after), or right after Specialization for
  // Test Preparation/Professional Course/Skills Training (pick what you're doing
  // before where).
  function renderInstituteField() {
    if (!studentCategoryHasInstitutePresets(form.student_category)) {
      return (
        <Input
          placeholder="Academy or institute name"
          value={form.institute_name}
          onChange={(e) => setForm({ ...form, institute_name: e.target.value })}
          required={req("institute_name")}
        />
      );
    }
    if (customInstitute) {
      return (
        <div className="flex gap-2">
          <Input
            placeholder={form.student_category === "college" ? "College name" : form.student_category === "university" ? "University name" : "Academy or institute name"}
            value={form.institute_name}
            onChange={(e) => setForm({ ...form, institute_name: e.target.value })}
            autoFocus
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 h-9 text-xs"
            onClick={() => { setCustomInstitute(false); setForm({ ...form, institute_name: "" }); }}
          >
            List
          </Button>
        </div>
      );
    }
    return (
      <SearchableSelect
        value={form.institute_name}
        onValueChange={(v) => {
          if (v === "other") {
            setCustomInstitute(true);
            setForm({ ...form, institute_name: "" });
          } else {
            setForm({ ...form, institute_name: v });
          }
        }}
        options={INSTITUTE_PRESETS_BY_CATEGORY[form.student_category]}
        searchPlaceholder={form.student_category === "college" ? "Search colleges..." : form.student_category === "university" ? "Search universities..." : "Search institutes..."}
        otherLabel="Other (specify)"
      />
    );
  }
  const packageOptions = selectedRoom ? buildPackageOptions(selectedRoom, hostel.package_config) : [];
  // A room clicked on the browsing page arrives preselected — show just that
  // one room instead of the full list, with a way to expand and pick another.
  const [showRoomList, setShowRoomList] = useState(!preselectedRoom);
  const [customRelationship, setCustomRelationship] = useState(false);
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
    if (show("cnic") && !form.cnic.trim()) { setError("CNIC is required."); return; }
    if (show("cnic") && form.cnic.trim() && !isValidCnic(form.cnic)) {
      setError("Enter a valid 13-digit CNIC, e.g. 42101-1234567-1.");
      return;
    }
    if (show("type") && !form.type) { setError("Please select a type."); return; }
    if (show("move_in_date") && req("move_in_date") && !form.move_in_date) { setError("Move-in date is required."); return; }
    if (showRoomPicker && req("room_preference") && !form.room_id) {
      setError("Please select a room.");
      return;
    }
    if (show("permanent_address") && req("permanent_address") && !form.permanent_address.trim()) {
      setError("Permanent address is required.");
      return;
    }
    if (show("emergency_contact") && req("emergency_contact") &&
        (!form.emergency_contact.trim() || !form.emergency_phone.trim())) {
      setError("Emergency contact name and phone are required.");
      return;
    }
    if (showInstitute && req("institute_name") && !form.institute_name.trim()) {
      setError("Institute name is required.");
      return;
    }
    if (showStudentCategory && req("student_category") && !form.student_category) {
      setError("Please select a student category.");
      return;
    }
    if (showOrganization && req("organization") && !form.organization.trim()) {
      setError("Organization is required.");
      return;
    }
    if (showDepartment && req("department") && !form.department.trim()) {
      setError("Department / Field is required.");
      return;
    }

    setLoading(true);
    const result = await submitApplication(hostel.id, {
      full_name: form.full_name,
      phone: form.phone,
      email: show("email") ? form.email || undefined : undefined,
      cnic: show("cnic") ? form.cnic || undefined : undefined,
      type: show("type") ? form.type : undefined,
      package_tier: showRoomPicker && selectedRoom ? form.package_tier : "space_only",
      room_id: showRoomPicker && selectedRoom ? selectedRoom.id : undefined,
      room_preference: showRoomPicker && selectedRoom ? selectedRoom.room_number : undefined,
      move_in_date: show("move_in_date") ? form.move_in_date || undefined : undefined,
      permanent_address: show("permanent_address") ? form.permanent_address || undefined : undefined,
      emergency_contact: show("emergency_contact") ? form.emergency_contact || undefined : undefined,
      emergency_phone: show("emergency_contact") ? form.emergency_phone || undefined : undefined,
      emergency_relationship: show("emergency_contact") ? form.emergency_relationship || undefined : undefined,
      notes: show("notes") ? form.notes || undefined : undefined,
      cnic_doc_path: cnicDoc?.path,
      institute_name: showInstitute ? form.institute_name || undefined : undefined,
      student_category: showStudentCategory ? form.student_category || undefined : undefined,
      student_specialization: showSpecialization ? form.student_specialization || undefined : undefined,
      organization: showOrganization ? form.organization || undefined : undefined,
      organization_type: showOrganization ? form.organization_type || undefined : undefined,
      department: showDepartment ? form.department || undefined : undefined,
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
        <div className="max-w-2xl mx-auto px-4 min-h-14 py-2.5 flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20 shrink-0">
            <Home className="w-4 h-4 text-amber" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground leading-snug">{hostel.name}</p>
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

            {/* CNIC — always required whenever shown, same as Type */}
            {show("cnic") && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                  CNIC <span className="text-rose-400">*</span>
                </Label>
                <Input
                  placeholder="XXXXX-XXXXXXX-X"
                  value={form.cnic}
                  onChange={(e) => setForm({ ...form, cnic: formatCnic(e.target.value) })}
                  inputMode="numeric"
                  maxLength={15}
                  required
                />
                <p className="text-xs text-muted-foreground">Format: 42101-1234567-1</p>
              </div>
            )}

            {/* Type — always required whenever shown: it drives Student Category,
                Institute Name, Specialization, and Organization data, so it can
                never meaningfully be "optional". Defaults to Student. */}
            {show("type") && (
              <div className="space-y-1.5">
                <Label>
                  Type <span className="text-rose-400">*</span>
                </Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm({ ...form, type: v as "student" | "professional" | "general" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="student">Student</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Student Category + Institute Name — Student only. Institute Name sits
                next to Student Category for University/College (no Specialization
                step to sequence after), or after Specialization for Test Prep/
                Professional Course/Skills Training — pick what you're doing before
                where. */}
            {(showStudentCategory || showInstitute) && (
              <div className={showSpecialization ? "space-y-1.5" : "grid grid-cols-2 gap-3"}>
                {showStudentCategory && (
                  <div className="space-y-1.5">
                    <Label>
                      Student Category {req("student_category") ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground text-xs">(optional)</span>}
                    </Label>
                    <Select
                      value={form.student_category}
                      onValueChange={(v) => {
                        const next = v as StudentCategory;
                        setCustomSpecialization(false);
                        // Institute name is category-specific (a university name doesn't
                        // belong to an Exam Prep record) — clear it along with
                        // specialization instead of carrying the old category's value over.
                        setCustomInstitute(false);
                        setForm({ ...form, student_category: next, student_specialization: "", institute_name: "" });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {STUDENT_CATEGORY_OPTIONS.map((c) => (
                          <SelectItem key={c} value={c}>{STUDENT_CATEGORY_LABELS[c]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {showInstitute && !showSpecialization && (
                  <div className="space-y-1.5">
                    <Label>
                      Institute Name {req("institute_name") ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground text-xs">(optional)</span>}
                    </Label>
                    {renderInstituteField()}
                  </div>
                )}
              </div>
            )}

            {/* Specialization — Test Prep / Professional Course / Skills Training only */}
            {showStudentCategory && studentCategoryHasSpecialization(form.student_category) && (
              <div className="space-y-1.5">
                <Label>
                  {STUDENT_CATEGORY_LABELS[form.student_category]} <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                </Label>
                {customSpecialization ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type the specific exam, certification, or skill"
                      value={form.student_specialization}
                      onChange={(e) => setForm({ ...form, student_specialization: e.target.value })}
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-9 text-xs"
                      onClick={() => { setCustomSpecialization(false); setForm({ ...form, student_specialization: "" }); }}
                    >
                      Choose from list
                    </Button>
                  </div>
                ) : (
                  <SearchableSelect
                    value={form.student_specialization}
                    onValueChange={(v) => {
                      if (v === "other") {
                        setCustomSpecialization(true);
                        setForm({ ...form, student_specialization: "" });
                      } else {
                        setForm({ ...form, student_specialization: v });
                      }
                    }}
                    options={STUDENT_SPECIALIZATION_PRESETS[form.student_category]}
                    searchPlaceholder="Search..."
                    otherLabel="Other (specify)"
                  />
                )}
              </div>
            )}

            {/* Institute Name, when there's a Specialization step above it */}
            {showInstitute && showSpecialization && (
              <div className="space-y-1.5">
                <Label>
                  Institute Name {req("institute_name") ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground text-xs">(optional)</span>}
                </Label>
                {renderInstituteField()}
              </div>
            )}

            {/* Organization + Organization Type — Professional only */}
            {showOrganization && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>
                    Organization {req("organization") ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground text-xs">(optional)</span>}
                  </Label>
                  <Input
                    placeholder="Company / employer name"
                    value={form.organization}
                    onChange={(e) => setForm({ ...form, organization: e.target.value })}
                    required={req("organization")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Organization Type</Label>
                  <Select
                    value={form.organization_type}
                    onValueChange={(v) => setForm({ ...form, organization_type: v as "private" | "government" })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="government">Government</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Department / Field — Student or Professional */}
            {showDepartment && (
              <div className="space-y-1.5">
                <Label>
                  Department / Field {req("department") ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground text-xs">(optional)</span>}
                </Label>
                <Input
                  placeholder="e.g. Computer Science, Electrical Engineering, Sales"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  required={req("department")}
                />
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
          {showRoomPicker && (
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

          {/* Emergency Contact — configurable */}
          {show("permanent_address") && (
            <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Home className="w-4 h-4 text-muted-foreground" /> Permanent Address
                {!req("permanent_address") && <span className="text-xs font-normal text-muted-foreground">(optional)</span>}
              </h2>
              <div className="space-y-1.5">
                <Label>Home Address {req("permanent_address") && <span className="text-rose-400">*</span>}</Label>
                <textarea
                  rows={3}
                  placeholder="House / street, area, city"
                  value={form.permanent_address}
                  onChange={(e) => setForm({ ...form, permanent_address: e.target.value })}
                  required={req("permanent_address")}
                  className="w-full rounded-lg border border-sidebar-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/50 resize-y"
                />
              </div>
            </div>
          )}

          {show("emergency_contact") && (
            <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-muted-foreground" /> Emergency Contact
                {!req("emergency_contact") && <span className="text-xs font-normal text-muted-foreground">(optional)</span>}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Contact Name {req("emergency_contact") && <span className="text-rose-400">*</span>}</Label>
                  <Input
                    placeholder="Muhammad Ali"
                    value={form.emergency_contact}
                    onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })}
                    required={req("emergency_contact")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact Phone {req("emergency_contact") && <span className="text-rose-400">*</span>}</Label>
                  <Input
                    placeholder="0300 0000000"
                    value={form.emergency_phone}
                    onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })}
                    required={req("emergency_contact")}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Relationship <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                {customRelationship ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. Family Friend, Neighbor..."
                      value={form.emergency_relationship}
                      onChange={(e) => setForm({ ...form, emergency_relationship: e.target.value })}
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-9 text-xs"
                      onClick={() => { setCustomRelationship(false); setForm({ ...form, emergency_relationship: "" }); }}
                    >
                      Choose from list
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={RELATIONSHIP_OPTIONS.includes(form.emergency_relationship) ? form.emergency_relationship : ""}
                    onValueChange={(v) => {
                      if (v === "other") {
                        setCustomRelationship(true);
                        setForm({ ...form, emergency_relationship: "" });
                      } else {
                        setForm({ ...form, emergency_relationship: v });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select relationship" />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATIONSHIP_OPTIONS.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                      <SelectItem value="other">Other (specify)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
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
