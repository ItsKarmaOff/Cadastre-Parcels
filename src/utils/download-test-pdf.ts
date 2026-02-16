/**
 * ┌───────────────────────────────────────────────────────────────────────────
 * │ @author                    Christophe Vandevoir
 * ├───────────────────────────────────────────────────────────────────────────
 * │ @file           download-test-pdf.ts
 * │ @path          src/utils/download-test-pdf.ts
 * │ @description   Script to download a cadastral PDF for testing purposes
 * │ @version       1.0.0
 * │
 * │ @email         christophe.vandevoir@epitech.eu
 * │ @date          2026-02-16
 * └───────────────────────────────────────────────────────────────────────────
 */

import { fetchParcelGeometry, downloadCadastralPDF } from "./cadastre-api.js";
import { computeBbox, expandBbox } from "./geo-transform.js";
import { writeFile } from "fs/promises";

/**
 * Test script that downloads a cadastral PDF for a hardcoded parcel.
 * Used for manual testing of the WMS download pipeline.
 */
async function main() {
  const feature = await fetchParcelGeometry("33063000BW0124");
  const bbox = expandBbox(computeBbox(feature.geometry.coordinates), 0.5);
  console.log("bbox:", bbox);
  const pdf = await downloadCadastralPDF({ bbox });
  await writeFile("ressources/plan.pdf", pdf);
  console.log("Done:", pdf.length, "bytes");
}

main();
