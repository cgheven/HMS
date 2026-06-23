/**
 * Image optimization utilities for tenant photos.
 * Center-crops to a square, resizes to 400x400, encodes as WebP at 0.8 quality.
 * Target output: ~20-40 KB.
 */

const TARGET_SIZE = 400;
const WEBP_QUALITY = 0.8;

/**
 * Optimizes a Blob (any image format) into a 400x400 WebP Blob.
 * Uses createImageBitmap() with a canvas fallback for broader browser compat.
 */
export async function optimizeImage(blob: Blob): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  let source: ImageBitmap | HTMLImageElement;

  if (typeof createImageBitmap !== "undefined") {
    source = await createImageBitmap(blob);
    const { width, height } = source;
    const side = Math.min(width, height);
    const sx = Math.floor((width - side) / 2);
    const sy = Math.floor((height - side) / 2);
    ctx.drawImage(source, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE);
    source.close();
  } else {
    // Fallback: HTMLImageElement
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
      img.src = url;
    });
    const { width, height } = source as HTMLImageElement;
    const side = Math.min(width, height);
    const sx = Math.floor((width - side) / 2);
    const sy = Math.floor((height - side) / 2);
    ctx.drawImage(source as HTMLImageElement, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error("Canvas toBlob returned null"));
      },
      "image/webp",
      WEBP_QUALITY
    );
  });
}
