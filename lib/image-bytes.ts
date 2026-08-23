/**
 * Trust the bytes, not the headers.
 *
 * file.type and file.size are both client-supplied and trivially forged, so
 * anything accepted as an image is checked against its magic bytes first.
 * Shared by the AC meter photo uploads and the WhatsApp campaign header image,
 * because two copies of a security check are two chances for one of them to
 * quietly fall behind the other.
 *
 * PDF is deliberately absent — validateDocMagicBytes in app/actions/tenants.ts
 * covers documents. These call sites accept pictures only, and widening this
 * would widen them with it.
 */
export function isRealImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true; // WebP
  return false;
}
