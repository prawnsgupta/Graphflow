import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ReportData } from "./report-service";

const PAGE = { width: 842, height: 595 }; // A4 landscape
const MARGIN = 36;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.4, 0.45, 0.55);
const ACCENT = rgb(0.39, 0.49, 1);
const RULE = rgb(0.86, 0.88, 0.92);

/** Standard PDF fonts only support WinAnsi; strip anything else. */
const clean = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, "-");

function fit(text: string, font: PDFFont, size: number, width: number) {
  let t = clean(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

export async function reportToPdf(r: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(r.title);
  doc.setProducer("GraphFlow");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const usable = PAGE.width - MARGIN * 2;
  const colWidth = usable / Math.max(1, r.columns.length);
  const fontSize = r.columns.length > 10 ? 7 : 8;
  let page: PDFPage;
  let y = 0;

  const header = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
    page.drawText("GraphFlow", { x: MARGIN, y, size: 10, font: bold, color: ACCENT });
    y -= 20;
    page.drawText(clean(r.title), { x: MARGIN, y, size: 16, font: bold, color: INK });
    y -= 16;
    page.drawText(fit(r.subtitle, font, 9, usable), { x: MARGIN, y, size: 9, font, color: MUTED });
    y -= 22;
    r.columns.forEach((c, i) => page.drawText(fit(c, bold, fontSize, colWidth - 4), { x: MARGIN + i * colWidth, y, size: fontSize, font: bold, color: INK }));
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 0.7, color: RULE });
    y -= 12;
  };

  header();
  if (r.rows.length === 0) {
    page!.drawText("No records for this period and scope.", { x: MARGIN, y, size: 9, font, color: MUTED });
    y -= 14;
  }
  for (const row of r.rows) {
    if (y < MARGIN + 60) header();
    row.forEach((cell, i) =>
      page!.drawText(fit(String(cell), font, fontSize, colWidth - 4), { x: MARGIN + i * colWidth, y, size: fontSize, font, color: INK }),
    );
    y -= 12;
  }

  if (y < MARGIN + 30 + (r.summary.length + r.notes.length) * 12) header();
  y -= 8;
  page!.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 0.7, color: RULE });
  y -= 14;
  for (const [k, v] of r.summary) {
    page!.drawText(clean(`${k}: ${v}`), { x: MARGIN, y, size: 9, font: bold, color: INK });
    y -= 12;
  }
  y -= 4;
  for (const n of r.notes) {
    page!.drawText(fit(n, font, 7.5, usable), { x: MARGIN, y, size: 7.5, font, color: MUTED });
    y -= 10;
  }
  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(clean(`Page ${i + 1} of ${pages.length} · Period ${r.period.from} to ${r.period.to} (${r.timezone})`), {
      x: MARGIN,
      y: 18,
      size: 7,
      font,
      color: MUTED,
    }),
  );
  return doc.save();
}
