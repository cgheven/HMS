// Printable A4 flyer: hostel name, heading/subheading, a large QR code, and
// the raw URL as a fallback for anyone who can't scan. Client-side only —
// mirrors the existing dynamic-import jsPDF pattern used for tenant/report exports.
export async function downloadQrFlyerPdf(opts: {
  heading: string;
  subheading: string;
  hostelName?: string | null;
  qrDataUrl: string;
  url: string;
  filename: string;
}) {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;

  doc.setDrawColor(245, 158, 11);
  doc.setLineWidth(1);
  doc.rect(10, 10, pageWidth - 20, pageHeight - 20);

  let y = 38;
  if (opts.hostelName) {
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(110, 110, 110);
    doc.text(opts.hostelName, centerX, y, { align: "center" });
    y += 16;
  }

  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20, 20, 20);
  doc.text(opts.heading, centerX, y, { align: "center" });
  y += 13;

  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  doc.text(opts.subheading, centerX, y, { align: "center", maxWidth: pageWidth - 50 });
  y += 22;

  const qrSize = 110;
  doc.addImage(opts.qrDataUrl, "PNG", centerX - qrSize / 2, y, qrSize, qrSize);
  y += qrSize + 16;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(130, 130, 130);
  doc.text("Or visit:", centerX, y, { align: "center" });
  y += 7;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(60, 60, 60);
  doc.text(opts.url, centerX, y, { align: "center", maxWidth: pageWidth - 40 });

  doc.save(opts.filename);
}
