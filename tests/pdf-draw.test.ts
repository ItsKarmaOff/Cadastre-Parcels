import { describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  COLORS,
  drawMultiPolygon,
  drawLegend,
  drawSummaryTable,
  type DrawColor,
  type SurfaceData,
} from "../src/utils/pdf-draw.js";
import { createGeoToPdfTransform } from "../src/utils/geo-transform.js";

describe("COLORS", () => {
  it("has at least 8 predefined colors", () => {
    expect(COLORS.length).toBeGreaterThanOrEqual(8);
  });

  it("each color has valid r, g, b values between 0 and 1", () => {
    for (const color of COLORS) {
      expect(color.r).toBeGreaterThanOrEqual(0);
      expect(color.r).toBeLessThanOrEqual(1);
      expect(color.g).toBeGreaterThanOrEqual(0);
      expect(color.g).toBeLessThanOrEqual(1);
      expect(color.b).toBeGreaterThanOrEqual(0);
      expect(color.b).toBeLessThanOrEqual(1);
    }
  });

  it("colors are distinct", () => {
    const colorStrings = COLORS.map((c) => `${c.r},${c.g},${c.b}`);
    const uniqueColors = new Set(colorStrings);
    expect(uniqueColors.size).toBe(COLORS.length);
  });
});

describe("drawMultiPolygon", () => {
  it("draws without error on a valid PDF page", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 500]);

    const transform = createGeoToPdfTransform([0, 0, 10, 10], 500, 500);

    const coordinates = [
      [
        [
          [2, 2],
          [8, 2],
          [8, 8],
          [2, 8],
          [2, 2],
        ],
      ],
    ];

    // Should not throw
    drawMultiPolygon(page, coordinates, transform, COLORS[0], 0.2, 2);

    const pdfBytes = await doc.save();
    expect(pdfBytes.length).toBeGreaterThan(0);
  });

  it("handles multiple polygons", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 500]);

    const transform = createGeoToPdfTransform([0, 0, 10, 10], 500, 500);

    const coordinates = [
      [
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
          [1, 1],
        ],
      ],
      [
        [
          [5, 5],
          [9, 5],
          [9, 9],
          [5, 9],
          [5, 5],
        ],
      ],
    ];

    drawMultiPolygon(page, coordinates, transform, COLORS[1], 0.3, 1);

    const pdfBytes = await doc.save();
    expect(pdfBytes.length).toBeGreaterThan(0);
  });

  it("skips polygons with fewer than 3 points", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 500]);

    const transform = createGeoToPdfTransform([0, 0, 10, 10], 500, 500);

    // Ring with only 2 points (degenerate)
    const coordinates = [
      [
        [
          [1, 1],
          [2, 2],
        ],
      ],
    ];

    // Should not throw
    drawMultiPolygon(page, coordinates, transform, COLORS[0]);

    const pdfBytes = await doc.save();
    expect(pdfBytes.length).toBeGreaterThan(0);
  });

  it("handles empty coordinates array", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 500]);

    const transform = createGeoToPdfTransform([0, 0, 10, 10], 500, 500);

    drawMultiPolygon(page, [], transform, COLORS[0]);

    const pdfBytes = await doc.save();
    expect(pdfBytes.length).toBeGreaterThan(0);
  });
});

describe("drawLegend", () => {
  it("draws a legend without error", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 500]);

    const entries = [
      { label: "Parcel A", color: COLORS[0] },
      { label: "Parcel B", color: COLORS[1] },
    ];

    await drawLegend(page, doc, entries, 10, 490);

    const pdfBytes = await doc.save();
    expect(pdfBytes.length).toBeGreaterThan(0);
  });

  it("handles a single entry", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 500]);

    const entries = [{ label: "Only parcel", color: COLORS[0] }];

    await drawLegend(page, doc, entries, 10, 490);

    const pdfBytes = await doc.save();
    expect(pdfBytes.length).toBeGreaterThan(0);
  });

  it("handles many entries", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 800]);

    const entries = COLORS.map((color, i) => ({
      label: `Parcel ${i + 1}`,
      color,
    }));

    await drawLegend(page, doc, entries, 10, 790);

    const pdfBytes = await doc.save();
    expect(pdfBytes.length).toBeGreaterThan(0);
  });
});

describe("drawSummaryTable", () => {
  it("draws a summary table without error", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([800, 600]);

    const data: SurfaceData[] = [
      {
        parcelId: "33063000BW0124",
        totalArea: 1000,
        builtArea: 250,
        unbuiltArea: 750,
        occupancyRate: 25.0,
        color: COLORS[0],
      },
      {
        parcelId: "33063000BW0125",
        totalArea: 2000,
        builtArea: 800,
        unbuiltArea: 1200,
        occupancyRate: 40.0,
        color: COLORS[1],
      },
    ];

    await drawSummaryTable(page, doc, data, 400, 580);

    const pdfBytes = await doc.save();
    expect(pdfBytes.length).toBeGreaterThan(0);
  });

  it("handles a single row", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([800, 600]);

    const data: SurfaceData[] = [
      {
        parcelId: "75056000AB0001",
        totalArea: 500,
        builtArea: 0,
        unbuiltArea: 500,
        occupancyRate: 0,
        color: COLORS[0],
      },
    ];

    await drawSummaryTable(page, doc, data, 400, 580);

    const pdfBytes = await doc.save();
    expect(pdfBytes.length).toBeGreaterThan(0);
  });

  it("handles zero areas correctly", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([800, 600]);

    const data: SurfaceData[] = [
      {
        parcelId: "33063000BW0001",
        totalArea: 0,
        builtArea: 0,
        unbuiltArea: 0,
        occupancyRate: 0,
        color: COLORS[0],
      },
    ];

    await drawSummaryTable(page, doc, data, 400, 580);

    const pdfBytes = await doc.save();
    expect(pdfBytes.length).toBeGreaterThan(0);
  });
});
