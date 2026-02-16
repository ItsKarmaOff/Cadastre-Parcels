import { writeFile, mkdir } from "fs/promises";
import { PDFDocument } from "pdf-lib";
import type { Feature, MultiPolygon, Position } from "geojson";
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
import { drawMultiPolygon, drawLegend, COLORS } from "./utils/pdf-draw.js";
import { savePdfAsPng } from "./utils/pdf-to-png.js";

/**
 * Level 3: Draws multiple adjacent parcels on a single cadastral PDF,
 * each with a distinct color, and adds a legend.
 */
async function main(): Promise<void> {
  const parcelIds = process.argv.slice(2);

  if (parcelIds.length < 2) {
    console.error("Usage: npx tsx src/level3.ts <id1> <id2> [id3...]");
    process.exit(1);
  }

  // Fetch all geometries in parallel
  console.log(`Fetching ${parcelIds.length} parcels...`);
  const features: Feature<MultiPolygon>[] = await Promise.all(
    parcelIds.map(async (id) => {
      parseParcelId(id); // validation
      const feature = await fetchParcelGeometry(id);
      console.log(
        `  ${id}: ${feature.properties?.nom_com ?? "?"} - ${feature.properties?.contenance ?? "?"} m²`,
      );
      return feature;
    }),
  );

  // Compute the encompassing bbox
  const allCoords: Position[][][] = features.flatMap(
    (f) => f.geometry.coordinates,
  );
  const globalBbox = expandBbox(computeBbox(allCoords), 0.15);

  // Download the cadastral PDF via WMS for the encompassing area
  console.log("Downloading cadastral plan via WMS...");
  const pdfBytes = await downloadCadastralPDF({
    bbox: globalBbox,
    width: 1684,
    height: 1190,
  });
  console.log(`PDF downloaded: ${pdfBytes.length} bytes`);

  // Load the PDF
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();
  console.log(`PDF page: ${width} x ${height} points`);

  // Create the coordinate transform
  const transform = createGeoToPdfTransform(globalBbox, width, height);

  // Draw each parcel with a distinct color
  console.log("Drawing parcels...");
  const legendEntries = features.map((feature, i) => {
    const color = COLORS[i % COLORS.length];
    drawMultiPolygon(
      page,
      feature.geometry.coordinates,
      transform,
      color,
      0.2,
      2,
    );
    return {
      label: parcelIds[i],
      color,
    };
  });

  // Add the legend
  console.log("Adding legend...");
  await drawLegend(page, pdfDoc, legendEntries, 15, height - 15);

  // Save
  await mkdir("output", { recursive: true });
  const outputPath = `output/level3_${parcelIds.length}parcelles.pdf`;
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
