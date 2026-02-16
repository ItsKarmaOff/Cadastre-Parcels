import { writeFile, mkdir } from "fs/promises";
import { PDFDocument } from "pdf-lib";
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Position, Polygon } from "geojson";
import {
  fetchParcelGeometry,
  parseParcelId,
  downloadCadastralPDF,
  fetchBatiments,
} from "./utils/cadastre-api.js";
import {
  createGeoToPdfTransform,
  computeBbox,
  expandBbox,
} from "./utils/geo-transform.js";
import {
  drawMultiPolygon,
  drawLegend,
  drawSummaryTable,
  COLORS,
  type SurfaceData,
} from "./utils/pdf-draw.js";
import { savePdfAsPng } from "./utils/pdf-to-png.js";

/**
 * Computes the built area of a parcel by intersecting it with building geometries.
 *
 * @param parcelFeature - The parcel geometry to analyze
 * @param buildings - Array of building geometries to intersect with
 * @returns Total built area in m² and the intersecting building geometries
 */
function computeBuiltArea(
  parcelFeature: Feature<MultiPolygon>,
  buildings: Feature<MultiPolygon>[],
): {
  builtArea: number;
  buildingIntersections: Feature<Polygon | MultiPolygon>[];
} {
  let builtArea = 0;
  const buildingIntersections: Feature<Polygon | MultiPolygon>[] = [];

  for (const building of buildings) {
    try {
      const intersection = turf.intersect(
        turf.featureCollection([
          parcelFeature as Feature<Polygon | MultiPolygon>,
          building as Feature<Polygon | MultiPolygon>,
        ]),
      );
      if (intersection) {
        const area = turf.area(intersection);
        builtArea += area;
        buildingIntersections.push(
          intersection as Feature<Polygon | MultiPolygon>,
        );
      }
    } catch {
      // Skip invalid geometry errors
    }
  }

  return { builtArea, buildingIntersections };
}

/**
 * Level 4: Draws parcels on a cadastral PDF with built/unbuilt area breakdown.
 * Includes a legend and a summary table showing surface area statistics.
 */
async function main(): Promise<void> {
  const parcelIds = process.argv.slice(2);

  if (parcelIds.length < 1) {
    console.error("Usage: npx tsx src/level4.ts <id1> [id2...]");
    process.exit(1);
  }

  // Fetch all geometries in parallel
  console.log(`Fetching ${parcelIds.length} parcel(s)...`);
  const features: Feature<MultiPolygon>[] = await Promise.all(
    parcelIds.map(async (id) => {
      parseParcelId(id);
      const feature = await fetchParcelGeometry(id);
      console.log(
        `  ${id}: ${feature.properties?.nom_com ?? "?"} - ${feature.properties?.contenance ?? "?"} m²`,
      );
      return feature;
    }),
  );

  // Fetch buildings for the municipality
  const firstParsed = parseParcelId(parcelIds[0]);
  console.log(
    `Downloading buildings for municipality ${firstParsed.codeInsee}...`,
  );
  const buildingsCollection = await fetchBatiments(firstParsed.codeInsee);
  console.log(`${buildingsCollection.features.length} buildings loaded`);

  // Compute the encompassing bbox
  const allCoords: Position[][][] = features.flatMap(
    (f) => f.geometry.coordinates,
  );
  const globalBbox = expandBbox(computeBbox(allCoords), 0.15);

  // Download the cadastral PDF via WMS
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

  const transform = createGeoToPdfTransform(globalBbox, width, height);

  // Draw each parcel and compute surface areas
  console.log("Drawing parcels and computing surface areas...");
  const surfaceData: SurfaceData[] = [];
  const legendEntries: { label: string; color: (typeof COLORS)[0] }[] = [];

  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const color = COLORS[i % COLORS.length];
    const parcelId = parcelIds[i];

    // Draw the parcel
    drawMultiPolygon(
      page,
      feature.geometry.coordinates,
      transform,
      color,
      0.15,
      2,
    );

    // Compute built areas
    const { builtArea, buildingIntersections } = computeBuiltArea(
      feature,
      buildingsCollection.features as Feature<MultiPolygon>[],
    );

    // Draw intersecting buildings with a darker style
    for (const buildingIntersect of buildingIntersections) {
      const buildingCoords =
        buildingIntersect.geometry.type === "MultiPolygon"
          ? buildingIntersect.geometry.coordinates
          : [buildingIntersect.geometry.coordinates];
      drawMultiPolygon(page, buildingCoords, transform, color, 0.5, 1);
    }

    const totalArea = feature.properties?.contenance ?? turf.area(feature);
    const unbuiltArea = Math.max(0, totalArea - builtArea);
    const occupancyRate = totalArea > 0 ? (builtArea / totalArea) * 100 : 0;

    surfaceData.push({
      parcelId,
      totalArea,
      builtArea,
      unbuiltArea,
      occupancyRate,
      color,
    });

    legendEntries.push({ label: parcelId, color });

    console.log(
      `  ${parcelId}: total=${totalArea.toFixed(0)}m², built=${builtArea.toFixed(0)}m², occupancy=${occupancyRate.toFixed(1)}%`,
    );
  }

  // Add the legend
  await drawLegend(page, pdfDoc, legendEntries, 15, height - 15);

  // Add the summary table (bottom-right corner)
  const tableWidth = 370;
  await drawSummaryTable(
    page,
    pdfDoc,
    surfaceData,
    width - tableWidth - 15,
    height - 15,
  );

  // Save
  await mkdir("output", { recursive: true });
  const outputPath = `output/level4_${parcelIds.length}parcelles.pdf`;
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
