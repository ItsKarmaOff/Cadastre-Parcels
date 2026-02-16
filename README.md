# Cadastre & Parcels

Automatic extraction and visualization of cadastral parcels from cadastre.gouv.fr.

## Requirements

- **Node.js** >= 18
- **npm** >= 9

## Installation

```bash
npm install
```

## Usage

### Level 1 — Draw a parcel on a provided PDF

```bash
npx tsx src/level1.ts <pdf_path> <parcel_id>
```

Example:
```bash
npx tsx src/level1.ts input/plan.pdf 33063000BW0124
```

### Level 2 — Automatically download the PDF

```bash
npx tsx src/level2.ts <parcel_id>
```

Example:
```bash
npx tsx src/level2.ts 33063000BW0124
```

### Level 3 — Multiple adjacent parcels

```bash
npx tsx src/level3.ts <id1> <id2> [id3...]
```

Example:
```bash
npx tsx src/level3.ts 33063000BW0124 33063000BW0247 33063000BW0320
```

### Level 4 — Built / unbuilt area breakdown

```bash
npx tsx src/level4.ts <id1> [id2...]
```

Example:
```bash
npx tsx src/level4.ts 33063000AI0002 33063000AI0019
```

Generated PDFs are saved in the `output/` directory.

## Tests

Unit tests are written with [Vitest](https://vitest.dev/).

```bash
npm test              # run all tests once
npm run test:watch    # run in watch mode
```

Tests cover:
- **geo-transform** — coordinate conversion, bounding box computation and expansion, geo-to-PDF transform
- **cadastre-api** — parcel ID parsing, parcel/building fetching (mocked HTTP), PDF download validation
- **pdf-draw** — color palette, polygon drawing, legend and summary table rendering

## Formatting

This project uses [Prettier](https://prettier.io/) for code formatting.

```bash
npm run format          # format all TypeScript files
npm run format:check    # check formatting without modifying files
```

## Parcel identifier format

A parcel identifier is 14 characters long: `33063000BW0124`

| Segment | Meaning | Example |
|---------|---------|---------|
| `33` | Department code | Gironde |
| `063` | Municipality code | Bordeaux |
| `000` | Prefix (absorbed municipality) | Standard |
| `BW` | Cadastral section | Section BW |
| `0124` | Parcel number | Parcel 124 |

## Tech stack

- **TypeScript** + tsx — language and runtime
- **pdf-lib** — PDF manipulation and generation
- **axios** — HTTP calls to cadastre APIs
- **proj4** — coordinate conversion (WGS84 ↔ Lambert 93)
- **@turf/turf** — geometric operations (bbox, intersection, area computation)

## APIs used

- [Cadastre Etalab](https://cadastre.data.gouv.fr/) — parcel and building geometries (GeoJSON)
- [WMS Geoplatform](https://data.geopf.fr/wms-v/ows) — vector cadastral PDF plans
