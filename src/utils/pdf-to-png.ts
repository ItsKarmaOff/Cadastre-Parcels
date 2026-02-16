/**
 * ┌───────────────────────────────────────────────────────────────────────────
 * │ @author                    Christophe Vandevoir
 * ├───────────────────────────────────────────────────────────────────────────
 * │ @file           pdf-to-png.ts
 * │ @path          src/utils/pdf-to-png.ts
 * │ @description   PDF to PNG conversion utilities
 * │ @version       1.0.0
 * │
 * │ @email         christophe.vandevoir@epitech.eu
 * │ @date          2026-02-16
 * └───────────────────────────────────────────────────────────────────────────
 */

import { pdf } from "pdf-to-img";
import { writeFile } from "fs/promises";

/**
 * Converts the first page of a PDF to a PNG file.
 *
 * @param pdfBytes - Raw PDF bytes (from pdf-lib's pdfDoc.save())
 * @param pdfOutputPath - The PDF output path; ".pdf" is replaced with ".png"
 * @param scale - Resolution multiplier (default 2)
 * @returns The PNG file path
 */
export async function savePdfAsPng(
  pdfBytes: Uint8Array,
  pdfOutputPath: string,
  scale = 2,
): Promise<string> {
  const pngPath = pdfOutputPath.replace(/\.pdf$/i, ".png");

  const doc = await pdf(Buffer.from(pdfBytes), { scale });
  const page = await doc.getPage(1);

  await writeFile(pngPath, page);
  return pngPath;
}
