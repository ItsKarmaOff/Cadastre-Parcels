import { writeFile, mkdir } from "fs/promises";
import { PDFDocument } from "pdf-lib";
import {
  fetchParcelGeometry,
  parseParcelId,
  downloadCadastralPDF,
} from "./utils/cadastre-api.js";
import {
  createGeoToPdfTransform,
  computeBbox,
  expandBbox,
} from "./utils/geo-transform.js";
import { drawMultiPolygon, COLORS } from "./utils/pdf-draw.js";
import { savePdfAsPng } from "./utils/pdf-to-png.js";

/**
 * Level 2: Automatically downloads a cadastral PDF via WMS and draws
 * the specified parcel on it. No input PDF is required.
 */
async function main(): Promise<void> {
  const [parcelId] = process.argv.slice(2);

  if (!parcelId) {
    console.error("Usage: npx tsx src/level2.ts <parcel_id>");
    process.exit(1);
  }

  const parsed = parseParcelId(parcelId);
  console.log(
    `Parcel: ${parcelId} (municipality=${parsed.codeInsee}, section=${parsed.section}, number=${parsed.numero})`,
  );

  // Fetch the parcel geometry
  console.log("Fetching geometry from cadastre.gouv.fr...");
  const feature = await fetchParcelGeometry(parcelId);
  console.log(
    `Parcel found: ${feature.properties?.nom_com ?? "?"} - ${feature.properties?.contenance ?? "?"} m²`,
  );

  // Compute bbox with margin around the parcel
  const coords = feature.geometry.coordinates;
  const bbox = expandBbox(computeBbox(coords), 0.5);

  // Download the cadastral PDF via WMS
  console.log("Downloading cadastral plan PDF via WMS...");
  const pdfBytes = await downloadCadastralPDF({ bbox });
  console.log(`PDF downloaded: ${pdfBytes.length} bytes`);

  // Load and annotate the PDF
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();
  console.log(`PDF page: ${width} x ${height} points`);

  // Transform geographic coordinates to PDF pixels
  const transform = createGeoToPdfTransform(bbox, width, height);

  console.log("Drawing parcel on PDF...");
  drawMultiPolygon(page, coords, transform, COLORS[0], 0.2, 2);

  // Save
  await mkdir("output", { recursive: true });
  const outputPath = `output/level2_${parcelId}.pdf`;
  const modifiedPdf = await pdfDoc.save();
  await writeFile(outputPath, modifiedPdf);
  console.log(`PDF generated: ${outputPath}`);

  const pngPath = await savePdfAsPng(modifiedPdf, outputPath);
  console.log(`PNG generated: ${pngPath}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
