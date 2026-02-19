/**
 * ┌───────────────────────────────────────────────────────────────────────────
 * │ @author                    Christophe Vandevoir
 * ├───────────────────────────────────────────────────────────────────────────
 * │ @file           geo-transform.ts
 * │ @path          src/utils/geo-transform.ts
 * │ @description   Geographic coordinate transformations and utilities
 * │ @version       1.0.0
 * │
 * │ @email         christophe.vandevoir@epitech.eu
 * │ @date          2026-02-16
 * └───────────────────────────────────────────────────────────────────────────
 */

import proj4 from "proj4";
import type { BBox, Position } from "geojson";

// Lambert 93 projection definition (EPSG:2154)
const LAMBERT93 =
  "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

proj4.defs("EPSG:2154", LAMBERT93);

/**
 * Converts WGS84 geographic coordinates to Lambert 93 projected coordinates.
 *
 * @param lon - Longitude in degrees (WGS84)
 * @param lat - Latitude in degrees (WGS84)
 * @returns [x, y] coordinates in meters (Lambert 93 / EPSG:2154)
 */
export function wgs84ToLambert93(lon: number, lat: number): [number, number] {
  return proj4("EPSG:4326", "EPSG:2154", [lon, lat]) as [number, number];
}

/** Transform object for converting geographic coordinates to PDF page coordinates. */
export interface GeoToPdfTransform {
  /** Converts [lon, lat] WGS84 to [x, y] PDF page coordinates in points */
  toPixel: (lon: number, lat: number) => [number, number];
  /** Bounding box in Lambert 93 coordinates [minX, minY, maxX, maxY] */
  bboxLambert: [number, number, number, number];
}

/**
 * Creates a transform function that maps WGS84 geographic coordinates
 * to PDF page coordinates (in points). Uses a simple linear interpolation
 * within the given bounding box.
 *
 * @param geoBbox - Geographic bounding box [minLon, minLat, maxLon, maxLat] in WGS84
 * @param pageWidth - PDF page width in points
 * @param pageHeight - PDF page height in points
 * @returns Transform object with toPixel function and Lambert 93 bbox
 */
export function createGeoToPdfTransform(
  geoBbox: BBox,
  pageWidth: number,
  pageHeight: number,
): GeoToPdfTransform {
  const [minLon, minLat, maxLon, maxLat] = geoBbox;

  const geoWidth = maxLon - minLon;
  const geoHeight = maxLat - minLat;

  return {
    toPixel: (lon: number, lat: number): [number, number] => {
      const px = ((lon - minLon) / geoWidth) * pageWidth;
      const py = ((lat - minLat) / geoHeight) * pageHeight;
      return [px, py];
    },
    bboxLambert: wgs84ToLambert93(minLon, minLat).concat(
      wgs84ToLambert93(maxLon, maxLat),
    ) as [number, number, number, number],
  };
}

/**
 * Computes the bounding box of a set of MultiPolygon coordinates.
 *
 * @param coordinates - MultiPolygon coordinate array (Position[][][])
 * @returns Bounding box as [minLon, minLat, maxLon, maxLat]
 */
export function computeBbox(
  coordinates: Position[][][],
): [number, number, number, number] {
  const allPoints = coordinates.flat(2);
  const lons = allPoints.map((p) => p[0]);
  const lats = allPoints.map((p) => p[1]);

  return [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ];
}

/**
 * Expands a bounding box by a given percentage margin on all sides.
 *
 * @param bbox - Original bounding box [minLon, minLat, maxLon, maxLat]
 * @param marginPercent - Margin as a fraction (e.g. 0.1 = 10% expansion on each side)
 * @returns Expanded bounding box
 */
export function expandBbox(
  bbox: [number, number, number, number],
  marginPercent: number = 0.1,
): [number, number, number, number] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const dLon = (maxLon - minLon) * marginPercent;
  const dLat = (maxLat - minLat) * marginPercent;

  return [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat];
}
