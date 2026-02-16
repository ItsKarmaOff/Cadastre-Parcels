import { PDFPage, rgb, PDFFont, PDFDocument, StandardFonts } from "pdf-lib";
import type { GeoToPdfTransform } from "./geo-transform.js";
import type { Position } from "geojson";

/** RGB color definition for drawing operations. */
export interface DrawColor {
  r: number;
  g: number;
  b: number;
}

/** Predefined color palette for distinguishing multiple parcels. */
export const COLORS: DrawColor[] = [
  { r: 1, g: 0, b: 0 }, // red
  { r: 0, g: 0.4, b: 1 }, // blue
  { r: 0, g: 0.7, b: 0.2 }, // green
  { r: 1, g: 0.5, b: 0 }, // orange
  { r: 0.6, g: 0, b: 0.8 }, // purple
  { r: 0, g: 0.8, b: 0.8 }, // cyan
  { r: 0.8, g: 0.8, b: 0 }, // dark yellow
  { r: 1, g: 0, b: 0.6 }, // pink
];

/**
 * Draws a MultiPolygon geometry onto a PDF page.
 * Each polygon in the MultiPolygon is drawn individually with the same style.
 *
 * @param page - The PDF page to draw on
 * @param coordinates - MultiPolygon coordinates (Position[][][])
 * @param transform - Geographic-to-PDF coordinate transform
 * @param color - Fill and border color
 * @param fillOpacity - Fill opacity (0 = transparent, 1 = opaque)
 * @param borderWidth - Border stroke width in points
 */
export function drawMultiPolygon(
  page: PDFPage,
  coordinates: Position[][][],
  transform: GeoToPdfTransform,
  color: DrawColor,
  fillOpacity: number = 0.2,
  borderWidth: number = 2,
): void {
  for (const polygon of coordinates) {
    drawPolygon(page, polygon, transform, color, fillOpacity, borderWidth);
  }
}

/**
 * Draws a single Polygon (outer ring only) onto a PDF page using an SVG path.
 *
 * @param page - The PDF page to draw on
 * @param rings - Polygon rings (outer + optional holes); only the outer ring is drawn
 * @param transform - Geographic-to-PDF coordinate transform
 * @param color - Fill and border color
 * @param fillOpacity - Fill opacity
 * @param borderWidth - Border stroke width in points
 */
function drawPolygon(
  page: PDFPage,
  rings: Position[][],
  transform: GeoToPdfTransform,
  color: DrawColor,
  fillOpacity: number,
  borderWidth: number,
): void {
  const outerRing = rings[0];
  if (!outerRing || outerRing.length < 3) return;

  const pixels = outerRing.map(([lon, lat]) => transform.toPixel(lon, lat));

  page.drawSvgPath(buildSvgPath(pixels), {
    x: 0,
    y: 0,
    color: rgb(color.r, color.g, color.b),
    opacity: fillOpacity,
    borderColor: rgb(color.r, color.g, color.b),
    borderWidth,
    borderOpacity: 1,
  });
}

/**
 * Builds an SVG path string from an array of pixel coordinates.
 * Y coordinates are negated because PDF and SVG have inverted Y axes.
 *
 * @param pixels - Array of [x, y] pixel coordinates
 * @returns SVG path string (e.g. "M 10 -20 L 30 -40 Z")
 */
function buildSvgPath(pixels: [number, number][]): string {
  if (pixels.length === 0) return "";

  const parts: string[] = [`M ${pixels[0][0]} ${-pixels[0][1]}`];
  for (let i = 1; i < pixels.length; i++) {
    parts.push(`L ${pixels[i][0]} ${-pixels[i][1]}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** Entry for the map legend associating a label with a color. */
export interface LegendEntry {
  label: string;
  color: DrawColor;
}

/**
 * Draws a legend box on the PDF page with colored squares and labels.
 *
 * @param page - The PDF page to draw on
 * @param doc - The PDF document (needed to embed fonts)
 * @param entries - Legend entries with labels and colors
 * @param x - X position of the legend (left edge, in points)
 * @param y - Y position of the legend (top edge, in points)
 */
export async function drawLegend(
  page: PDFPage,
  doc: PDFDocument,
  entries: LegendEntry[],
  x: number,
  y: number,
): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 9;
  const lineHeight = 16;
  const boxSize = 10;
  const padding = 10;

  const titleHeight = 18;
  const totalHeight = titleHeight + entries.length * lineHeight + padding * 2;
  const maxLabelWidth = Math.max(
    ...entries.map((e) => font.widthOfTextAtSize(e.label, fontSize)),
  );
  const totalWidth = padding * 2 + boxSize + 8 + maxLabelWidth;

  // Semi-transparent white background
  page.drawRectangle({
    x,
    y: y - totalHeight,
    width: totalWidth,
    height: totalHeight,
    color: rgb(1, 1, 1),
    opacity: 0.9,
    borderColor: rgb(0.3, 0.3, 0.3),
    borderWidth: 1,
  });

  // Title
  page.drawText("Legend", {
    x: x + padding,
    y: y - padding - 12,
    size: 11,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  // Entries
  entries.forEach((entry, i) => {
    const entryY = y - titleHeight - padding - i * lineHeight;

    page.drawRectangle({
      x: x + padding,
      y: entryY - boxSize + 2,
      width: boxSize,
      height: boxSize,
      color: rgb(entry.color.r, entry.color.g, entry.color.b),
      opacity: 0.6,
      borderColor: rgb(entry.color.r, entry.color.g, entry.color.b),
      borderWidth: 1,
    });

    page.drawText(entry.label, {
      x: x + padding + boxSize + 8,
      y: entryY - boxSize + 4,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  });
}

/** Surface area breakdown data for a single parcel. */
export interface SurfaceData {
  parcelId: string;
  totalArea: number;
  builtArea: number;
  unbuiltArea: number;
  occupancyRate: number;
  color: DrawColor;
}

/**
 * Draws a summary table on the PDF page showing surface area breakdowns.
 * Includes columns for parcel ID, total area, built area, unbuilt area,
 * and occupancy percentage.
 *
 * @param page - The PDF page to draw on
 * @param doc - The PDF document (needed to embed fonts)
 * @param data - Array of surface data entries to display
 * @param x - X position of the table (left edge, in points)
 * @param y - Y position of the table (top edge, in points)
 */
export async function drawSummaryTable(
  page: PDFPage,
  doc: PDFDocument,
  data: SurfaceData[],
  x: number,
  y: number,
): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 8;
  const headerFontSize = 9;
  const lineHeight = 16;
  const padding = 10;
  const colWidths = [110, 65, 65, 65, 50]; // parcel, total, built, unbuilt, %
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + padding * 2;
  const titleHeight = 22;
  const headerHeight = 18;
  const totalHeight =
    titleHeight + headerHeight + data.length * lineHeight + padding * 2;

  // Background
  page.drawRectangle({
    x,
    y: y - totalHeight,
    width: totalWidth,
    height: totalHeight,
    color: rgb(1, 1, 1),
    opacity: 0.95,
    borderColor: rgb(0.2, 0.2, 0.2),
    borderWidth: 1.5,
  });

  let currentY = y - padding - 14;

  // Title
  page.drawText("Surface area summary", {
    x: x + padding,
    y: currentY,
    size: 11,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.5),
  });

  currentY -= titleHeight;

  // Column headers
  const headers = ["Parcel", "Total (m²)", "Built (m²)", "Unbuilt", "% Occ."];
  let colX = x + padding;
  headers.forEach((header, i) => {
    page.drawText(header, {
      x: colX,
      y: currentY,
      size: headerFontSize,
      font: fontBold,
      color: rgb(0.3, 0.3, 0.3),
    });
    colX += colWidths[i];
  });

  // Separator line
  currentY -= 6;
  page.drawLine({
    start: { x: x + padding, y: currentY },
    end: { x: x + totalWidth - padding, y: currentY },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  currentY -= lineHeight - 4;

  // Data rows
  for (const row of data) {
    colX = x + padding;

    // Color swatch
    page.drawRectangle({
      x: colX,
      y: currentY - 2,
      width: 8,
      height: 8,
      color: rgb(row.color.r, row.color.g, row.color.b),
      opacity: 0.7,
    });

    page.drawText(row.parcelId.slice(-6), {
      x: colX + 12,
      y: currentY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    colX += colWidths[0];

    page.drawText(row.totalArea.toFixed(0), {
      x: colX,
      y: currentY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    colX += colWidths[1];

    page.drawText(row.builtArea.toFixed(0), {
      x: colX,
      y: currentY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    colX += colWidths[2];

    page.drawText(row.unbuiltArea.toFixed(0), {
      x: colX,
      y: currentY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    colX += colWidths[3];

    page.drawText(`${row.occupancyRate.toFixed(1)}%`, {
      x: colX,
      y: currentY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    currentY -= lineHeight;
  }
}
