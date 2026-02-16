#!/usr/bin/env bun
/**
 * ┌───────────────────────────────────────────────────────────────────────────
 * │ @author                    Christophe Vandevoir
 * ├───────────────────────────────────────────────────────────────────────────
 * │ @file           level4.ts
 * │ @path          src/level4.ts
 * │ @description   Level 4: Draw parcels with built/unbuilt area breakdown
 * │ @version       1.0.0
 * │
 * │ @email         christophe.vandevoir@epitech.eu
 * │ @date          2026-02-16
 * └───────────────────────────────────────────────────────────────────────────
 */

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

// ---------------------------------------------------------------------------
// Interactive mode: commune search → section → parcel selection
// ---------------------------------------------------------------------------

interface Commune {
  nom: string;
  code: string;
  codeDepartement: string;
  population: number;
}

interface CadastreParcel {
  properties: {
    id: string;
    section: string;
    numero: string;
    contenance: number;
  };
}

/**
 * Prompts the user to search for a commune, pick a section, and select parcels.
 * Returns the list of selected parcel identifiers.
 */
async function interactiveSelectParcels(): Promise<string[]> {
  const { select, input, checkbox, confirm } =
    await import("@inquirer/prompts");
  const axios = (await import("axios")).default;

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║       Cadastre & Parcelles - Interactive     ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Step 1: Search for a commune
  const communeQuery = await input({
    message: "Search for a commune (name or postal code):",
    validate: (v: string) =>
      v.trim().length >= 2 || "Enter at least 2 characters",
  });

  console.log("Searching...");
  const { data: communes } = await axios.get<Commune[]>(
    "https://geo.api.gouv.fr/communes",
    {
      params: {
        nom: communeQuery.trim(),
        fields: "nom,code,codeDepartement,population",
        boost: "population",
        limit: 10,
      },
      timeout: 10000,
    },
  );

  if (communes.length === 0) {
    console.error(`No commune found for "${communeQuery.trim()}".`);
    process.exit(1);
  }

  const codeCommune = await select({
    message: "Select a commune:",
    choices: communes.map((c) => ({
      name: `${c.nom} (${c.codeDepartement}${c.code.slice(2)}) - ${c.population ?? "?"} hab.`,
      value: c.code,
    })),
  });

  const selectedCommune = communes.find((c) => c.code === codeCommune)!;
  console.log(`\nSelected: ${selectedCommune.nom} (${codeCommune})`);

  // Step 2: Fetch all parcels for the commune
  console.log("Fetching parcels...");
  const { data: parcelCollection } = await axios.get<{
    features: CadastreParcel[];
  }>(
    `https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${codeCommune}/geojson/parcelles`,
    { timeout: 60000 },
  );
  const allParcels = parcelCollection.features;
  console.log(`${allParcels.length} parcels found.`);

  if (allParcels.length === 0) {
    console.error("No parcels found for this commune.");
    process.exit(1);
  }

  // Step 3: Select a section
  const sectionSet = new Set<string>();
  for (const p of allParcels) sectionSet.add(p.properties.section);
  const sections = [...sectionSet].sort();

  const selectedSection = await select({
    message: `Select a cadastral section (${sections.length} available):`,
    choices: sections.map((s) => {
      const count = allParcels.filter((p) => p.properties.section === s).length;
      return { name: `Section ${s} (${count} parcels)`, value: s };
    }),
  });

  // Step 4: Select parcels within the section
  const sectionParcels = allParcels
    .filter((p) => p.properties.section === selectedSection)
    .sort(
      (a, b) => parseInt(a.properties.numero) - parseInt(b.properties.numero),
    );

  const selectedParcelIds = await checkbox({
    message: `Select parcels in section ${selectedSection} (space to toggle, enter to confirm):`,
    choices: sectionParcels.map((p) => ({
      name: `${p.properties.id} - ${p.properties.contenance} m²`,
      value: p.properties.id,
    })),
    required: true,
    validate: (selected: readonly { value: string }[]) => {
      if (selected.length === 0) return "Select at least one parcel.";
      return true;
    },
  });

  console.log(`\nSelected ${selectedParcelIds.length} parcel(s):`);
  for (const id of selectedParcelIds) console.log(`  - ${id}`);

  const proceed = await confirm({
    message: "Generate the cadastral PDF with area analysis?",
    default: true,
  });

  if (!proceed) {
    console.log("Aborted.");
    process.exit(0);
  }

  return selectedParcelIds;
}

// ---------------------------------------------------------------------------
// Core level 4 logic
// ---------------------------------------------------------------------------

/**
 * Generates a cadastral PDF with built/unbuilt area breakdown for the given parcels.
 */
async function generateLevel4(parcelIds: string[]): Promise<void> {
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Level 4: Draws parcels on a cadastral PDF with built/unbuilt area breakdown.
 * Includes a legend and a summary table showing surface area statistics.
 *
 * Usage:
 *   npx tsx src/level4.ts <id1> [id2...]        # Direct mode
 *   npx tsx src/level4.ts --interactive          # Interactive mode
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isInteractive = args.includes("--interactive");

  if (isInteractive) {
    const parcelIds = await interactiveSelectParcels();
    await generateLevel4(parcelIds);
  } else {
    const parcelIds = args.filter((a) => !a.startsWith("--"));

    if (parcelIds.length < 1) {
      console.error(
        "Usage: npx tsx src/level4.ts <id1> [id2...]\n       npx tsx src/level4.ts --interactive",
      );
      process.exit(1);
    }

    await generateLevel4(parcelIds);
  }
}

main().catch((error) => {
  if (error instanceof Error && error.message.includes("User force closed")) {
    console.log("\nAborted.");
    process.exit(0);
  }
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
