import { describe, it, expect, vi, beforeEach } from "vitest";
import { gzipSync } from "zlib";

// Mock axios before importing modules that use it
vi.mock("axios", () => {
  return {
    default: {
      get: vi.fn(),
    },
    AxiosError: class AxiosError extends Error {
      code?: string;
      response?: { status: number };
      constructor(
        message: string,
        code?: string,
        _config?: unknown,
        _request?: unknown,
        response?: { status: number },
      ) {
        super(message);
        this.code = code;
        this.response = response;
        this.name = "AxiosError";
      }
    },
  };
});

import axios from "axios";
const mockedAxios = vi.mocked(axios);

// Reset modules between tests to clear the parcellesCache
beforeEach(() => {
  vi.clearAllMocks();
});

// Use a unique counter to avoid hitting the in-memory parcellesCache
let communeCounter = 10;
function uniqueCommune(): string {
  return `${++communeCounter}`.padStart(5, "0");
}

function makeParcelId(commune: string, section = "BW", num = "0124"): string {
  const dep = commune.slice(0, 2);
  const com = commune.slice(2, 5);
  return `${dep}${com}000${section}${num}`;
}

import {
  parseParcelId,
  fetchParcelGeometry,
  downloadCadastralPDF,
  fetchBatiments,
} from "../src/utils/cadastre-api.js";

describe("parseParcelId", () => {
  it("parses a valid 14-character parcel identifier", () => {
    const result = parseParcelId("33063000BW0124");
    expect(result).toEqual({
      codeInsee: "33063",
      comAbs: "000",
      section: "BW",
      numero: "0124",
      codeDep: "33",
    });
  });

  it("parses another valid parcel identifier", () => {
    const result = parseParcelId("75056000AB0001");
    expect(result).toEqual({
      codeInsee: "75056",
      comAbs: "000",
      section: "AB",
      numero: "0001",
      codeDep: "75",
    });
  });

  it("parses parcel with non-zero absorbed municipality", () => {
    const result = parseParcelId("13055012CD0042");
    expect(result).toEqual({
      codeInsee: "13055",
      comAbs: "012",
      section: "CD",
      numero: "0042",
      codeDep: "13",
    });
  });

  it("throws on empty string", () => {
    expect(() => parseParcelId("")).toThrow("Invalid parcel identifier");
  });

  it("throws on too-short identifier", () => {
    expect(() => parseParcelId("33063000BW")).toThrow(
      "Invalid parcel identifier",
    );
  });

  it("throws on too-long identifier", () => {
    expect(() => parseParcelId("33063000BW01241")).toThrow(
      "Invalid parcel identifier",
    );
  });

  it("includes the invalid id in error message", () => {
    expect(() => parseParcelId("abc")).toThrow('"abc"');
  });
});

describe("fetchParcelGeometry", () => {
  function makeGzippedCollection(features: object[]) {
    const json = JSON.stringify({ type: "FeatureCollection", features });
    return gzipSync(Buffer.from(json));
  }

  it("fetches and returns a parcel geometry as MultiPolygon", async () => {
    const commune = uniqueCommune();
    const parcelId = makeParcelId(commune);

    const feature = {
      type: "Feature",
      properties: { id: parcelId, contenance: 500 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-0.57, 44.84],
            [-0.56, 44.84],
            [-0.56, 44.85],
            [-0.57, 44.85],
            [-0.57, 44.84],
          ],
        ],
      },
    };

    mockedAxios.get.mockResolvedValueOnce({
      data: makeGzippedCollection([feature]),
    });

    const result = await fetchParcelGeometry(parcelId);

    expect(result.geometry.type).toBe("MultiPolygon");
    expect(result.properties?.id).toBe(parcelId);
    expect(result.properties?.contenance).toBe(500);
    // Polygon should have been converted to MultiPolygon
    expect(result.geometry.coordinates).toHaveLength(1);
  });

  it("returns MultiPolygon geometry as-is", async () => {
    const commune = uniqueCommune();
    const parcelId = makeParcelId(commune);

    const feature = {
      type: "Feature",
      properties: { id: parcelId },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [-0.57, 44.84],
              [-0.56, 44.84],
              [-0.56, 44.85],
              [-0.57, 44.85],
              [-0.57, 44.84],
            ],
          ],
        ],
      },
    };

    mockedAxios.get.mockResolvedValueOnce({
      data: makeGzippedCollection([feature]),
    });

    const result = await fetchParcelGeometry(parcelId);
    expect(result.geometry.type).toBe("MultiPolygon");
  });

  it("throws when parcel is not found in collection", async () => {
    const commune = uniqueCommune();
    const parcelId = makeParcelId(commune);

    const otherFeature = {
      type: "Feature",
      properties: { id: makeParcelId(commune, "BW", "9999") },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    };

    mockedAxios.get.mockResolvedValueOnce({
      data: makeGzippedCollection([otherFeature]),
    });

    await expect(fetchParcelGeometry(parcelId)).rejects.toThrow(
      "Parcel not found",
    );
  });

  it("throws on invalid parcel identifier", async () => {
    await expect(fetchParcelGeometry("invalid")).rejects.toThrow(
      "Invalid parcel identifier",
    );
  });

  it("throws on corrupted gzip data", async () => {
    const commune = uniqueCommune();
    const parcelId = makeParcelId(commune);

    mockedAxios.get.mockResolvedValueOnce({
      data: Buffer.from("not gzip data"),
    });

    await expect(fetchParcelGeometry(parcelId)).rejects.toThrow(
      "Unable to decode",
    );
  });

  it("throws on invalid GeoJSON structure", async () => {
    const commune = uniqueCommune();
    const parcelId = makeParcelId(commune);

    const invalidJson = JSON.stringify({ type: "FeatureCollection" });
    mockedAxios.get.mockResolvedValueOnce({
      data: gzipSync(Buffer.from(invalidJson)),
    });

    await expect(fetchParcelGeometry(parcelId)).rejects.toThrow(
      "Invalid parcel data",
    );
  });
});

describe("downloadCadastralPDF", () => {
  it("downloads and returns PDF bytes", async () => {
    const fakePdf = Buffer.from("%PDF-1.4 fake pdf content");
    mockedAxios.get.mockResolvedValueOnce({ data: fakePdf });

    const result = await downloadCadastralPDF({
      bbox: [-0.6, 44.8, -0.5, 44.9],
    });

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(fakePdf.length);

    // Verify WMS parameters were sent
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://data.geopf.fr/wms-v/ows",
      expect.objectContaining({
        params: expect.objectContaining({
          SERVICE: "WMS",
          VERSION: "1.3.0",
          REQUEST: "GetMap",
          LAYERS: "CADASTRALPARCELS.PCI_VECTEUR",
          CRS: "EPSG:4326",
          FORMAT: "application/pdf",
        }),
      }),
    );
  });

  it("uses default width and height", async () => {
    const fakePdf = Buffer.from("%PDF-1.4 content");
    mockedAxios.get.mockResolvedValueOnce({ data: fakePdf });

    await downloadCadastralPDF({ bbox: [-0.6, 44.8, -0.5, 44.9] });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({
          WIDTH: 1190,
          HEIGHT: 842,
        }),
      }),
    );
  });

  it("uses custom width and height", async () => {
    const fakePdf = Buffer.from("%PDF-1.4 content");
    mockedAxios.get.mockResolvedValueOnce({ data: fakePdf });

    await downloadCadastralPDF({
      bbox: [-0.6, 44.8, -0.5, 44.9],
      width: 1684,
      height: 1190,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({
          WIDTH: 1684,
          HEIGHT: 1190,
        }),
      }),
    );
  });

  it("throws on invalid bbox (minLon >= maxLon)", async () => {
    await expect(
      downloadCadastralPDF({ bbox: [1, 0, 0, 1] }),
    ).rejects.toThrow("Invalid bbox");
  });

  it("throws on invalid bbox (minLat >= maxLat)", async () => {
    await expect(
      downloadCadastralPDF({ bbox: [0, 1, 1, 0] }),
    ).rejects.toThrow("Invalid bbox");
  });

  it("throws when response is not a valid PDF", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: Buffer.from("not a pdf at all here"),
    });

    await expect(
      downloadCadastralPDF({ bbox: [-0.6, 44.8, -0.5, 44.9] }),
    ).rejects.toThrow("not a valid PDF");
  });

  it("throws on WMS ServiceException", async () => {
    const errorXml =
      '<?xml version="1.0"?><ServiceException>Error occurred</ServiceException>';
    mockedAxios.get.mockResolvedValueOnce({
      data: Buffer.from(errorXml),
    });

    await expect(
      downloadCadastralPDF({ bbox: [-0.6, 44.8, -0.5, 44.9] }),
    ).rejects.toThrow("WMS server returned an error");
  });
});

describe("fetchBatiments", () => {
  it("fetches and returns building geometries", async () => {
    const commune = uniqueCommune();
    const collection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 0],
                ],
              ],
            ],
          },
        },
      ],
    };

    mockedAxios.get.mockResolvedValueOnce({
      data: gzipSync(Buffer.from(JSON.stringify(collection))),
    });

    const result = await fetchBatiments(commune);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
  });

  it("throws on corrupted data", async () => {
    const commune = uniqueCommune();
    mockedAxios.get.mockResolvedValueOnce({
      data: Buffer.from("not gzip"),
    });

    await expect(fetchBatiments(commune)).rejects.toThrow(
      "Unable to decode building data",
    );
  });
});
