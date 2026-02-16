import { describe, it, expect } from "vitest";
import {
  wgs84ToLambert93,
  createGeoToPdfTransform,
  computeBbox,
  expandBbox,
} from "../src/utils/geo-transform.js";

describe("wgs84ToLambert93", () => {
  it("converts Paris coordinates correctly", () => {
    // Paris: lon=2.3522, lat=48.8566
    const [x, y] = wgs84ToLambert93(2.3522, 48.8566);

    // Lambert 93 coordinates for Paris should be approximately:
    // x ≈ 652_000, y ≈ 6_862_000
    expect(x).toBeGreaterThan(640_000);
    expect(x).toBeLessThan(660_000);
    expect(y).toBeGreaterThan(6_850_000);
    expect(y).toBeLessThan(6_870_000);
  });

  it("converts Bordeaux coordinates correctly", () => {
    // Bordeaux: lon=-0.5792, lat=44.8378
    const [x, y] = wgs84ToLambert93(-0.5792, 44.8378);

    // Lambert 93 for Bordeaux: x ≈ 416_000, y ≈ 6_422_000
    expect(x).toBeGreaterThan(400_000);
    expect(x).toBeLessThan(430_000);
    expect(y).toBeGreaterThan(6_410_000);
    expect(y).toBeLessThan(6_440_000);
  });

  it("returns a tuple of two numbers", () => {
    const result = wgs84ToLambert93(3.0, 46.5);
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe("number");
    expect(typeof result[1]).toBe("number");
  });
});

describe("computeBbox", () => {
  it("computes bounding box for a simple square polygon", () => {
    const coordinates = [
      [
        [
          [1, 2],
          [3, 2],
          [3, 4],
          [1, 4],
          [1, 2],
        ],
      ],
    ];
    const bbox = computeBbox(coordinates);
    expect(bbox).toEqual([1, 2, 3, 4]);
  });

  it("computes bounding box for multiple polygons", () => {
    const coordinates = [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
      [
        [
          [5, 5],
          [10, 5],
          [10, 10],
          [5, 10],
          [5, 5],
        ],
      ],
    ];
    const bbox = computeBbox(coordinates);
    expect(bbox).toEqual([0, 0, 10, 10]);
  });

  it("handles a single point polygon (degenerate case)", () => {
    const coordinates = [
      [
        [
          [5, 5],
          [5, 5],
          [5, 5],
        ],
      ],
    ];
    const bbox = computeBbox(coordinates);
    expect(bbox).toEqual([5, 5, 5, 5]);
  });

  it("handles negative coordinates", () => {
    const coordinates = [
      [
        [
          [-10, -20],
          [-5, -20],
          [-5, -15],
          [-10, -15],
          [-10, -20],
        ],
      ],
    ];
    const bbox = computeBbox(coordinates);
    expect(bbox).toEqual([-10, -20, -5, -15]);
  });
});

describe("expandBbox", () => {
  it("expands bbox by default 10%", () => {
    const bbox: [number, number, number, number] = [0, 0, 10, 10];
    const expanded = expandBbox(bbox);

    // width=10, 10% margin = 1 on each side
    expect(expanded).toEqual([-1, -1, 11, 11]);
  });

  it("expands bbox by a custom margin", () => {
    const bbox: [number, number, number, number] = [0, 0, 10, 20];
    const expanded = expandBbox(bbox, 0.5);

    // lonWidth=10, margin=5; latHeight=20, margin=10
    expect(expanded).toEqual([-5, -10, 15, 30]);
  });

  it("handles zero margin", () => {
    const bbox: [number, number, number, number] = [1, 2, 3, 4];
    const expanded = expandBbox(bbox, 0);
    expect(expanded).toEqual([1, 2, 3, 4]);
  });

  it("handles negative coordinates", () => {
    const bbox: [number, number, number, number] = [-10, -20, -5, -15];
    const expanded = expandBbox(bbox, 0.1);

    // lonWidth=5, dLon=0.5; latHeight=5, dLat=0.5
    expect(expanded[0]).toBeCloseTo(-10.5);
    expect(expanded[1]).toBeCloseTo(-20.5);
    expect(expanded[2]).toBeCloseTo(-4.5);
    expect(expanded[3]).toBeCloseTo(-14.5);
  });
});

describe("createGeoToPdfTransform", () => {
  it("maps min corner to (0, 0)", () => {
    const transform = createGeoToPdfTransform([0, 0, 10, 10], 100, 100);
    const [x, y] = transform.toPixel(0, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it("maps max corner to (pageWidth, pageHeight)", () => {
    const transform = createGeoToPdfTransform([0, 0, 10, 10], 100, 200);
    const [x, y] = transform.toPixel(10, 10);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(200);
  });

  it("maps center to (pageWidth/2, pageHeight/2)", () => {
    const transform = createGeoToPdfTransform([0, 0, 10, 10], 500, 400);
    const [x, y] = transform.toPixel(5, 5);
    expect(x).toBeCloseTo(250);
    expect(y).toBeCloseTo(200);
  });

  it("handles non-square aspect ratios", () => {
    const transform = createGeoToPdfTransform([0, 0, 20, 10], 800, 400);

    const [x1, y1] = transform.toPixel(10, 5);
    expect(x1).toBeCloseTo(400);
    expect(y1).toBeCloseTo(200);

    const [x2, y2] = transform.toPixel(20, 10);
    expect(x2).toBeCloseTo(800);
    expect(y2).toBeCloseTo(400);
  });

  it("provides Lambert 93 bbox", () => {
    const transform = createGeoToPdfTransform(
      [-0.6, 44.8, -0.5, 44.9],
      100,
      100,
    );

    expect(transform.bboxLambert).toHaveLength(4);
    // All values should be valid numbers
    transform.bboxLambert.forEach((v) => {
      expect(typeof v).toBe("number");
      expect(isNaN(v)).toBe(false);
    });
  });
});
