import { readFile, writeFile, mkdir, access } from "fs/promises";
import { PDFDocument } from "pdf-lib";
import { fetchParcelGeometry, parseParcelId } from "./utils/cadastre-api.js";
import {
  createGeoToPdfTransform,
  computeBbox,
  expandBbox,
} from "./utils/geo-transform.js";
import { drawMultiPolygon, COLORS } from "./utils/pdf-draw.js";
import { savePdfAsPng } from "./utils/pdf-to-png.js";

/**
 * Level 1: Draws a cadastral parcel overlay on a user-provided PDF.
 * Accepts a PDF file path, a parcel identifier, and an optional bounding box.
 * If no bbox is provided, it is computed automatically from the parcel geometry.
 */
async function main(): Promise<void> {
  const [pdfPath, parcelId, ...bboxArgs] = process.argv.slice(2);

  if (!pdfPath || !parcelId) {
    console.error("Usage: npx tsx src/level1.ts <pdf_path> <parcel_id>");
    process.exit(1);
  }

  // Validate the parcel identifier
  const parsed = parseParcelId(parcelId);
  console.log(
    `Parcel: ${parcelId} (municipality=${parsed.codeInsee}, section=${parsed.section}, number=${parsed.numero})`,
  );

  // Fetch the parcel geometry
  console.log("Fetching geometry from cadastre.gouv.fr...");
  const feature = await fetchParcelGeometry(parcelId);
  const contenance = feature.properties?.contenance;
  console.log(`Parcel found: ${contenance ?? "?"} m²`);

  // Verify that the PDF file exists
  try {
    await access(pdfPath);
  } catch {
    console.error(`File not found: ${pdfPath}`);
    process.exit(1);
  }

  // Load the PDF
  console.log(`Loading PDF: ${pdfPath}`);
  let pdfBytes: Buffer;
  try {
    pdfBytes = await readFile(pdfPath);
  } catch (err) {
    console.error(
      `Unable to read file: ${pdfPath} (${(err as Error).message})`,
    );
    process.exit(1);
  }

  if (pdfBytes.length < 5 || pdfBytes.toString("ascii", 0, 5) !== "%PDF-") {
    console.error(`The file "${pdfPath}" is not a valid PDF.`);
    process.exit(1);
  }

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes);
  } catch (err) {
    console.error(`Unable to load PDF: ${(err as Error).message}`);
    process.exit(1);
  }

  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();
  console.log(`PDF page: ${width} x ${height} points`);

  // Determine the PDF bounding box
  let bbox: [number, number, number, number];

  if (bboxArgs.length > 0) {
    // Bbox provided as argument: minLon,minLat,maxLon,maxLat
    const parts = bboxArgs[0].split(",").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      console.error(
        "Invalid bbox. Expected format: minLon,minLat,maxLon,maxLat",
      );
      process.exit(1);
    }
    bbox = parts as [number, number, number, number];
    console.log(`Bbox (provided): [${bbox.join(", ")}]`);
  } else {
    // Compute bbox from geometry with margin
    const coords = feature.geometry.coordinates;
    bbox = expandBbox(computeBbox(coords), 0.5);
    console.log(
      `Bbox (computed): [${bbox.map((v) => v.toFixed(6)).join(", ")}]`,
    );
    console.log(
      "  Note: bbox is estimated from the parcel. For exact alignment, provide the PDF bbox.",
    );
  }

  const transform = createGeoToPdfTransform(bbox, width, height);

  // Draw the parcel
  console.log("Drawing parcel on PDF...");
  const coords = feature.geometry.coordinates;
  drawMultiPolygon(page, coords, transform, COLORS[0], 0.2, 2);

  // Save
  await mkdir("output", { recursive: true });
  const outputPath = `output/level1_${parcelId}.pdf`;
  const modifiedPdf = await pdfDoc.save();
  await writeFile(outputPath, modifiedPdf);
  console.log(`PDF generated: ${outputPath}`);

  const pngPath = await savePdfAsPng(modifiedPdf, outputPath);
  console.log(`PNG generated: ${pngPath}`);
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
