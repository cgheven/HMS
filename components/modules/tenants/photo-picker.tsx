"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Camera, Upload, RefreshCw, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { optimizeImage } from "@/lib/image";
import { uploadTenantPhoto } from "@/app/actions/tenants";
import { toast } from "@/hooks/use-toast";

interface Props {
  value: string | null;
  onChange: (url: string) => void;
  hostelId: string;
  initials?: string;
}

export function PhotoPicker({ value, onChange, hostelId, initials = "?" }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Start / restart camera stream
  const startCamera = useCallback(async (mode: "user" | "environment") => {
    setCameraError(null);
    // Stop any existing stream
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
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Permission") || message.includes("NotAllowed") || message.includes("denied")) {
        setCameraError("Camera access denied. Please allow camera permissions and try again.");
      } else if (message.includes("NotReadable") || message.includes("in use")) {
        setCameraError("Camera is in use by another application.");
      } else {
        setCameraError("Could not access camera: " + message);
      }
    }
  }, [stream]);

  // Attach stream to video element whenever stream changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Open camera dialog
  async function openCamera() {
    setCameraOpen(true);
    await startCamera(facingMode);
  }

  // Close camera and clean up
  function closeCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setCameraOpen(false);
    setCameraError(null);
  }

  // Flip camera
  async function flipCamera() {
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    await startCamera(next);
  }

  // Capture from video
  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (!blob) { toast({ title: "Capture failed", variant: "destructive" }); return; }
      closeCamera();
      await processAndUpload(blob);
    }, "image/webp", 0.9);
  }

  // File input change
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await processAndUpload(file);
  }

  // Optimize + upload
  async function processAndUpload(raw: Blob) {
    setUploading(true);
    try {
      const optimized = await optimizeImage(raw);
      const fd = new FormData();
      fd.append("file", new File([optimized], "photo.webp", { type: "image/webp" }));
      const result = await uploadTenantPhoto(hostelId, fd);
      if (result.error) {
        toast({ title: "Upload failed", description: result.error, variant: "destructive" });
      } else if (result.url) {
        onChange(result.url);
        toast({ title: "Photo uploaded" });
      }
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      {/* Avatar preview */}
      <div className="relative w-20 h-20 rounded-full shrink-0 overflow-hidden border-2 border-amber/30 bg-amber/10 flex items-center justify-center">
        {uploading ? (
          <Loader2 className="w-6 h-6 animate-spin text-amber" />
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="Tenant photo" className="w-full h-full object-cover" />
        ) : (
          <span className="text-2xl font-bold text-amber select-none">{initials.slice(0, 2).toUpperCase()}</span>
        )}
      </div>

      {/* Buttons */}
      <div className="flex flex-col gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 text-xs"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="w-3.5 h-3.5" />
          Upload Photo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 text-xs"
          onClick={openCamera}
          disabled={uploading}
        >
          <Camera className="w-3.5 h-3.5" />
          Take Photo
        </Button>
      </div>

      {/* Camera Dialog */}
      <Dialog open={cameraOpen} onOpenChange={(o) => { if (!o) closeCamera(); }}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-sm">Take Photo</DialogTitle>
          </DialogHeader>

          <div className="relative bg-black aspect-square w-full overflow-hidden">
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
              onClick={capture}
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
