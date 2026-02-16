# Cadastre & Parcels

Automatic extraction and visualization of cadastral parcels from cadastre.gouv.fr.

## Requirements

- **Node.js** >= 18
- **Bun** >= 1.0

## Installation

```bash
bun install
```

## Usage

### Level 1 — Draw a parcel on a provided PDF

```bash
bun run level1 <pdf_path> <parcel_id>
```

Example:
```bash
bun run level1 input/plan.pdf 33063000BW0124
```

### Level 2 — Automatically download the PDF

```bash
bun run level2 <parcel_id>
```

Example:
```bash
bun run level2 33063000BW0124
```

### Level 3 — Multiple adjacent parcels

```bash
bun run level3 <id1> <id2> [id3...]
```

Example:
```bash
bun run level3 33063000BW0124 33063000BW0247 33063000BW0320
```

### Level 4 — Built / unbuilt area breakdown

```bash
bun run level4 <id1> [id2...]
```

Example:
```bash
bun run level4 33063000AI0002 33063000AI0019
```

### Interactive mode

An interactive CLI guides you through commune search, section selection, and parcel picking, then runs the level 4 analysis:

```bash
bun run interactive
```

The workflow is:
1. Search for a commune by name (uses [geo.api.gouv.fr](https://geo.api.gouv.fr/))
2. Select a commune from the results
3. Pick a cadastral section
4. Select one or more parcels (checkbox)
5. Generate the annotated PDF with built/unbuilt area breakdown

### Global CLI (optional)

You can register the project as a global command:

```bash
bun link
cadastre-parcelles --interactive
cadastre-parcelles 33063000AI0002 33063000AI0019
```

### Output

Generated PDFs and PNGs are saved in the `output/` directory.

## Tests

Unit tests are written with [Vitest](https://vitest.dev/).

```bash
bun run test              # run all tests once
bun run test:watch        # run in watch mode
```

Tests cover:
- **geo-transform** — coordinate conversion, bounding box computation and expansion, geo-to-PDF transform
- **cadastre-api** — parcel ID parsing, parcel/building fetching (mocked HTTP), PDF download validation
- **pdf-draw** — color palette, polygon drawing, legend and summary table rendering

## Formatting

This project uses [Prettier](https://prettier.io/) for code formatting.

```bash
bun run format          # format all TypeScript files
bun run format:check    # check formatting without modifying files
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
- **pdf-to-img** — PDF to PNG conversion
- **axios** — HTTP calls to cadastre APIs
- **proj4** — coordinate conversion (WGS84 ↔ Lambert 93)
- **@turf/turf** — geometric operations (bbox, intersection, area computation)
- **@inquirer/prompts** — interactive CLI prompts

## APIs used

- [Cadastre Etalab](https://cadastre.data.gouv.fr/) — parcel and building geometries (GeoJSON)
- [WMS Geoplatform](https://data.geopf.fr/wms-v/ows) — vector cadastral PDF plans
- [geo.api.gouv.fr](https://geo.api.gouv.fr/) — commune search (interactive mode)
