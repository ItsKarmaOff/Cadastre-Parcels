/**
 * ┌───────────────────────────────────────────────────────────────────────────
 * │ @author                    Christophe Vandevoir
 * ├───────────────────────────────────────────────────────────────────────────
 * │ @file           cadastre-api.ts
 * │ @path          src/utils/cadastre-api.ts
 * │ @description   Cadastre API utilities
 * │ @version       1.0.0
 * │
 * │ @email         christophe.vandevoir@epitech.eu
 * │ @date          2026-02-16
 * └───────────────────────────────────────────────────────────────────────────
 */

import axios, { AxiosError } from "axios";
import { gunzipSync } from "zlib";
import type {
  FeatureCollection,
  Feature,
  MultiPolygon,
  Polygon,
} from "geojson";

/**
 * Formats an HTTP error into a user-friendly Error with context.
 * Handles timeouts, DNS failures, HTTP status codes, and generic network errors.
 */
function formatHttpError(err: unknown, context: string): Error {
  if (err instanceof AxiosError) {
    if (err.code === "ECONNABORTED") {
      return new Error(`${context}: request timed out`);
    }
    if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
      return new Error(
        `${context}: unable to reach the server (check your Internet connection)`,
      );
    }
    if (err.response) {
      const status = err.response.status;
      if (status === 404) {
        return new Error(`${context}: resource not found (404)`);
      }
      return new Error(`${context}: HTTP error ${status}`);
    }
    return new Error(`${context}: network error (${err.message})`);
  }
  if (err instanceof Error) {
    return new Error(`${context}: ${err.message}`);
  }
  return new Error(`${context}: unknown error`);
}

/** Parsed components of a 14-character French cadastral parcel identifier. */
export interface ParcelId {
  /** INSEE code (department + municipality, e.g. "33063") */
  codeInsee: string;
  /** Absorbed municipality prefix (e.g. "000") */
  comAbs: string;
  /** Cadastral section (e.g. "BW") */
  section: string;
  /** Parcel number (e.g. "0124") */
  numero: string;
  /** Department code (e.g. "33") */
  codeDep: string;
}

/**
 * Parses a 14-character cadastral parcel identifier into its components.
 * Format: [dept 2][commune 3][absorbed 3][section 2][number 4]
 *
 * @param id - The 14-character parcel identifier (e.g. "33063000BW0124")
 * @returns Parsed parcel identifier components
 * @throws If the identifier is not exactly 14 characters
 */
export function parseParcelId(id: string): ParcelId {
  if (id.length !== 14) {
    throw new Error(
      `Invalid parcel identifier: "${id}" (expected: 14 characters, e.g. 33063000BW0012)`,
    );
  }

  const codeDep = id.slice(0, 2);
  const codeCom = id.slice(2, 5);
  const comAbs = id.slice(5, 8);
  const section = id.slice(8, 10);
  const numero = id.slice(10, 14);

  return {
    codeInsee: codeDep + codeCom,
    comAbs,
    section,
    numero,
    codeDep,
  };
}

/** In-memory cache for municipality parcel collections to avoid redundant downloads. */
const parcellesCache = new Map<string, FeatureCollection>();

/**
 * Fetches all parcel geometries for a given municipality from Cadastre Etalab.
 * Results are cached in memory to avoid redundant downloads when processing
 * multiple parcels from the same municipality.
 *
 * @param codeInsee - The 5-character INSEE code of the municipality (e.g. "33063")
 * @returns GeoJSON FeatureCollection containing all parcels of the municipality
 * @throws On network errors or invalid/corrupted response data
 */
async function fetchCommuneParcelles(
  codeInsee: string,
): Promise<FeatureCollection> {
  if (parcellesCache.has(codeInsee)) {
    return parcellesCache.get(codeInsee)!;
  }

  const codeDep = codeInsee.slice(0, 2);
  const url = `https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes/${codeDep}/${codeInsee}/cadastre-${codeInsee}-parcelles.json.gz`;

  let response;
  try {
    response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
  } catch (err) {
    throw formatHttpError(
      err,
      `Downloading parcels for municipality ${codeInsee}`,
    );
  }

  let collection: FeatureCollection;
  try {
    const decompressed = gunzipSync(Buffer.from(response.data));
    collection = JSON.parse(decompressed.toString("utf-8"));
  } catch {
    throw new Error(
      `Unable to decode parcel data for municipality ${codeInsee} (corrupted file or unexpected format)`,
    );
  }

  if (!collection.features || !Array.isArray(collection.features)) {
    throw new Error(
      `Invalid parcel data for municipality ${codeInsee}: unexpected GeoJSON format`,
    );
  }

  parcellesCache.set(codeInsee, collection);
  return collection;
}

/**
 * Fetches the geometry of a single cadastral parcel by its 14-character identifier.
 * Polygon geometries are automatically converted to MultiPolygon for consistency.
 *
 * @param id - The 14-character parcel identifier (e.g. "33063000BW0124")
 * @returns GeoJSON Feature with MultiPolygon geometry and cadastral properties
 * @throws If the parcel is not found or on network errors
 */
export async function fetchParcelGeometry(
  id: string,
): Promise<Feature<MultiPolygon>> {
  const { codeInsee } = parseParcelId(id);

  const collection = await fetchCommuneParcelles(codeInsee);

  const feature = collection.features.find((f) => f.properties?.id === id);

  if (!feature) {
    throw new Error(`Parcel not found: ${id} in municipality ${codeInsee}`);
  }

  const geom = (feature as Feature<Polygon | MultiPolygon>).geometry;
  if (geom.type === "Polygon") {
    (feature as Feature<MultiPolygon>).geometry = {
      type: "MultiPolygon",
      coordinates: [geom.coordinates],
    };
  }

  return feature as Feature<MultiPolygon>;
}

/** Parameters for downloading a cadastral PDF map via WMS. */
export interface CadastralPdfParams {
  /** Bounding box in WGS84 [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
  /** Output width in pixels (default: 1190 = A4 landscape at 150 dpi) */
  width?: number;
  /** Output height in pixels (default: 842 = A4 landscape at 150 dpi) */
  height?: number;
}

/**
 * Downloads a cadastral plan as PDF from the French Geoplatform WMS service.
 * Uses WMS 1.3.0 with EPSG:4326 coordinate reference system.
 *
 * @param params - Download parameters including bounding box and optional dimensions
 * @returns Raw PDF bytes as Uint8Array
 * @throws On invalid bbox, network errors, or if the WMS response is not a valid PDF
 */
export async function downloadCadastralPDF(
  params: CadastralPdfParams,
): Promise<Uint8Array> {
  const [minLon, minLat, maxLon, maxLat] = params.bbox;
  const width = params.width ?? 1190;
  const height = params.height ?? 842;

  if (minLon >= maxLon || minLat >= maxLat) {
    throw new Error(
      `Invalid bbox: [${params.bbox.join(", ")}]. Ensure minLon < maxLon and minLat < maxLat.`,
    );
  }

  // WMS 1.3.0 with EPSG:4326: BBOX = lat_min,lon_min,lat_max,lon_max
  const url = "https://data.geopf.fr/wms-v/ows";
  let response;
  try {
    response = await axios.get(url, {
      params: {
        SERVICE: "WMS",
        VERSION: "1.3.0",
        REQUEST: "GetMap",
        LAYERS: "CADASTRALPARCELS.PCI_VECTEUR",
        CRS: "EPSG:4326",
        BBOX: `${minLat},${minLon},${maxLat},${maxLon}`,
        WIDTH: width,
        HEIGHT: height,
        FORMAT: "application/pdf",
        STYLES: "",
      },
      responseType: "arraybuffer",
      timeout: 30000,
    });
  } catch (err) {
    throw formatHttpError(err, "Downloading cadastral plan via WMS");
  }

  const data = new Uint8Array(response.data);

  // Verify that the response is actually a PDF (starts with %PDF)
  if (data.length < 5 || String.fromCharCode(...data.slice(0, 5)) !== "%PDF-") {
    const text = new TextDecoder().decode(data.slice(0, 500));
    if (text.includes("ServiceException") || text.includes("Error")) {
      throw new Error(
        `The WMS server returned an error instead of a PDF. Check the bbox [${params.bbox.join(", ")}].`,
      );
    }
    throw new Error("The WMS server response is not a valid PDF.");
  }

  return data;
}

/**
 * Fetches all building geometries for a given municipality from Cadastre Etalab.
 *
 * @param codeInsee - The 5-character INSEE code of the municipality (e.g. "33063")
 * @returns GeoJSON FeatureCollection containing all buildings of the municipality
 * @throws On network errors or invalid/corrupted response data
 */
export async function fetchBatiments(
  codeInsee: string,
): Promise<FeatureCollection<MultiPolygon>> {
  const codeDep = codeInsee.slice(0, 2);
  const url = `https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes/${codeDep}/${codeInsee}/cadastre-${codeInsee}-batiments.json.gz`;

  let response;
  try {
    response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
  } catch (err) {
    throw formatHttpError(
      err,
      `Downloading buildings for municipality ${codeInsee}`,
    );
  }

  try {
    const decompressed = gunzipSync(Buffer.from(response.data));
    return JSON.parse(decompressed.toString("utf-8"));
  } catch {
    throw new Error(
      `Unable to decode building data for municipality ${codeInsee} (corrupted file or unexpected format)`,
    );
  }
}
