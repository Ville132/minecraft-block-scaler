# Minecraft Block Scaler — Implementation Plan

## Context

`/Users/villelindholmjakobsson/Documents/Claude/minecraft_block_scaler` is empty. This is a greenfield
web app that turns a single Minecraft block (e.g. cobblestone) into a scaled-up replica build:

1. Pick a block, pick a size from a list of sizes that **preserve the block's appearance**.
2. Get a material list (which blocks, how many of each).
3. Download the build as a Litematica schematic to use as an in-game overlay.

The user plays **Java Edition 26.3** ("Wilderness Bound", released 2026-09-15).

The driving requirement is visual correctness: the scaled block must still read as that block. That makes
the *scale math* and the *colour matching* the two places where quality is won or lost, so they get
dedicated, independently-tested modules.

### Two corrections worth knowing up front

- **The file extension is `.litematic`, not `.litematica`.** "Litematica" is the mod; `.litematic` is the
  file it reads, from `.minecraft/schematics/`. The download will be named `.litematic` so the mod sees it.
- **Mojang's block textures cannot be bundled in this repo** (not redistributable). The app therefore reads
  textures from a client jar or resource pack that the user supplies. This was a decided requirement, and
  it has a real upside: it matches the user's exact version automatically and supports custom resource packs.

### Decisions already made

| Decision | Choice |
|---|---|
| Appearance method | Colour-matched palette — each texture pixel becomes a block matching that pixel's colour |
| Texture source | User uploads `26.3.jar` or a resource pack `.zip`; unpacked in-browser |
| UI language | English |
| Fill style | Hollow shell by default, solid as an option |

Colour-matched means a giant cobblestone is built from stone, andesite, deepslate, gravel, polished
andesite and friends — at scale it reads as cobblestone. This is the standard giant-block technique and the
reason the material list contains many different blocks.

---

## The scale math (the core of the product)

Every Minecraft block texture is **16×16 pixels**. A replica with edge length `S` blocks shows that 16×16
texture across `S×S` blocks per face. Appearance is preserved only when texture pixels map onto build
blocks on a **uniform** grid:

- `S = 16k` → each pixel becomes a `k×k` square of blocks. **Lossless.** `S ∈ {16, 32, 48, 64, 80, 96, …}`
- `S = 16/d`, `d` divides 16 → each `d×d` pixel group collapses to one block. **Uniform but less detail.**
  `S ∈ {8, 4, 2, 1}`
- Anything else (10, 20, 24, 30 …) → a non-integer pixel-to-block ratio. Some blocks cover 2 pixels and
  their neighbours cover 1, which breaks the texture's spacing and the build looks smeared. **Rejected.**

So the "size options that keep the block looking like itself" are exactly **the multiples of 16 plus the
divisors of 16** — this is what the size picker offers. Non-conforming sizes are reachable only behind a
"Show non-scale-true sizes" toggle carrying an explicit distortion warning.

Block counts (hollow surface = `S³ − (S−2)³`):

| Edge `S` | Fidelity | Blocks per pixel | Hollow | Solid |
|---|---|---|---|---|
| 8 | reduced (2×2 px → 1 block) | — | 296 | 512 |
| 16 | **exact** | 1 | 1 352 | 4 096 |
| 32 | **exact** | 2 | 5 768 | 32 768 |
| 48 | **exact** | 3 | 13 256 | 110 592 |
| 64 | **exact** | 4 | 23 816 | 262 144 |

---

## Verified `.litematic` format facts

Confirmed against the Litematica/Litemapy implementations — these are the details that decide whether the
file loads or corrupts:

- **gzip-compressed NBT**, big-endian, **unnamed root compound**.
- Root: `Version` (Int) = **6**, `SubVersion` (Int) = **1**, `MinecraftDataVersion` (Int) = **5023** for
  Java 26.3, `Metadata` (Compound), `Regions` (Compound).
- `Metadata`: `Name`, `Author`, `Description` (String), `RegionCount`, `TotalVolume`, `TotalBlocks` (Int),
  `EnclosingSize` (Compound of Int `x`/`y`/`z`), `TimeCreated`, `TimeModified` (Long).
- Region: `Position`, `Size` (Compounds of Int), `BlockStatePalette` (List of Compound with `Name` and
  optional `Properties`), `BlockStates` (LongArray), plus `TileEntities`, `Entities`,
  `PendingBlockTicks`, `PendingFluidTicks` (empty Lists).
- **`BlockStatePalette[0]` must be `minecraft:air`.**
- Bits per entry = `max(2, ceil(log2(paletteLength)))`; array length = `ceil(bits × volume / 64)`.
- **Entries are packed tightly and DO straddle 64-bit long boundaries.** This differs from the modern
  (1.16+) chunk format, which pads each long. Getting this wrong is the #1 cause of corrupt litematics.
- Index order is y-major: `index = y·|sizeX·sizeZ| + z·|sizeX| + x`.

Two pitfalls to code against deliberately:

- JS bitwise operators truncate to 32 bits. The bit array **must** use `BigInt`/`BigInt64Array`.
- Empty NBT lists will be written as element-type `10` (TAG_Compound) with length `0`. Flagged for in-game
  confirmation during verification.

---

## Modules

Each function has one job; nothing both reads assets and transforms them.

```
src/
  domain/
    scale.ts        listScaleOptions / classifyScale — the table above, as code
    faces.ts        resolve which texture belongs to which of the 6 cube faces
    shell.ts        build the voxel grid (hollow | solid) + edge-ownership rule
    color.ts        sRGB <-> linear <-> Oklab, linear-light averaging, nearest match
    palette.ts      candidate build blocks + exclusion rules + cost tiers
    materials.ts    voxel counts -> material list with stacks and shulker boxes
  assets/
    archiveReader.ts   unzip jar/resource pack, locate block textures & models
    modelResolver.ts   walk model parent chain, resolve #texture variables
    textureDecoder.ts  PNG -> RGBA pixel grid
  litematic/
    bitArray.ts     LitematicaBitArray pack/unpack (BigInt, straddling)
    nbt.ts          NBT writer + reader (reader exists for round-trip tests)
    writeSchematic.ts  assemble + gzip
  ui/               React views
```

### Colour pipeline (quality-critical)

- Average pixels in **linear light**, not sRGB — averaging gamma-encoded values darkens midtones visibly.
- Match in **Oklab** by Euclidean distance. Naive sRGB distance picks perceptually wrong blocks; this is
  the difference between a convincing replica and a muddy one.
- A palette block's colour = the linear-light average of its own texture, rejecting any texture that is
  animated (`.mcmeta` present / height ≠ width) or has non-opaque pixels.

### Palette selection

Candidates are derived from the user's archive: blocks whose `blockstates` entry is a **single variant with
an empty key** and whose model chain resolves to a **full opaque cube**. On top of that, a committed
exclusion list (with a stated reason per entry) removes blocks that are wrong to build with:

- gravity: sand, gravel, concrete powder, suspicious blocks
- creative/unobtainable: barrier, bedrock, command blocks, spawner, light, jigsaw, infested
- interactive or hazardous: observer, piston, note block, target, TNT, magma, slime, honey
- biome-tinted (colour is not fixed): grass block, leaves

User-facing toggles: *survival-friendly only* (drops netherite/diamond/gold/emerald tiers), *allow gravity
blocks*, *allow biome-tinted blocks*.

### Two explicit scope boundaries for v1

- **Source block must be a single-variant full cube** — cobblestone, stone, deepslate, bricks, planks,
  wool, concrete, terracotta — **or** the standard axis-pillar shape (logs, wood, basalt, quartz/purpur
  pillars: blockstate variants keyed exactly `axis=x`/`axis=y`/`axis=z`), picked as the source block in a
  chosen orientation. ~~Deferred in v1~~ — added in v0.4.0: `assets/modelResolver.ts`'s
  `resolveAxisVariantCubeModel` resolves either `axis=y` ("upright") or `axis=z` ("sideways"; `axis=x`
  would be equally valid, since the player can still rotate the finished build in-game), applying the
  variant's `x`/`y` rotation via `domain/faces.ts`'s `rotateFaceDirection` — Minecraft reuses the *same*
  model for all three axes and reorients it, rather than defining three different ones, so getting this
  rotation right (not just picking a different model file) was the actual work. Any other blockstate shape
  (more than one property, `multipart`, etc.) is still out of scope, which keeps the schematic palette free
  of `Properties` for every block this app places.
- **Edge ownership:** a voxel on an edge is visible from two faces and a corner from three. Rule:
  **Y faces win over Z, Z wins over X** — the cap texture owns the rim. Deterministic and one voxel wide.
  Noted as the natural place to add an option if anisotropic blocks land later.

---

## Build steps

0. Copy this plan to `PLAN.md` in the project folder (plan mode cannot write there yet).
1. **Scaffold** — Vite + React + TypeScript, pnpm, Vitest, `fflate` (gzip + unzip), strict `tsconfig`.
   `package.json` version `0.1.0`, surfaced in the UI footer from a single source via Vite `define`.
2. **`litematic/bitArray.ts` + tests first.** Pack/unpack round-trips across palette sizes
   `{2,3,4,5,8,9,16,17,31,64,65}` plus golden byte vectors. This is the highest-risk code; it is also pure
   and fully testable, so it comes before anything touching the DOM.
3. **`litematic/nbt.ts`** — typed writer and a reader used only by tests.
4. **`domain/scale.ts` + tests** — the size table as executable rules.
5. **`assets/*`** — unzip the archive, decode textures, resolve per-face models. Cache the parsed result in
   IndexedDB so the upload is a one-time step.
6. **`domain/color.ts` + `palette.ts` + tests** — conversions, nearest match, candidate filtering.
7. **`domain/shell.ts` + `materials.ts` + tests** — voxel grid and the material list.
8. **`litematic/writeSchematic.ts`** — assemble region, palette, metadata; gzip; download as
   `<block>_x<S>.litematic`.
9. **UI** — load archive → pick block → pick scale (cards showing edge length, fidelity badge, total
   blocks) → options → preview → material list + download. Material list exports as text and CSV.
10. **Preview** — 2D per-face preview next to the original texture at matched apparent size, so fidelity is
    judgeable before download. A three.js instanced-mesh 3D preview is the last step and the first thing to
    cut if needed.
11. **Deploy to Railway** as a static build behind a minimal Node static server, matching the pattern of the
    other Railway apps.

---

## Verification

**Automated (Vitest, deterministic, no network):**

- `bitArray`: pack→unpack identity at every bit width above; golden long values; explicit coverage of a
  value straddling a long boundary.
- `scale`: `listScaleOptions(128)` equals `[1,2,4,8,16,32,48,64,80,96,112,128]`; `classifyScale(24)` and
  `(10)` are `distorted`; `classifyScale(32)` is `exact` with `blocksPerPixel === 2`.
- `color`: known sRGB→linear→Oklab reference values; nearest-match against a synthetic two-block palette.
- `shell`: hollow at `S=16` yields exactly 1 352 voxels and solid 4 096; every hollow voxel lies on the
  surface.
- `materials`: counts sum to `TotalBlocks`; 1 800 blocks renders as 1 shulker + 1 stack + 8.
- `writeSchematic`: write → read back with the test reader → palette and voxels identical; plus a committed
  golden file for a 2×2×2 structure to catch silent format regressions.
- Optional CI job: have Python `litemapy` open a generated file — an independent implementation reading our
  output is the strongest check available offline.

**Manual (the only way to confirm the format is truly right):**

Place the generated file in `.minecraft/schematics/`, load it in Litematica on Java 26.3, and confirm the
dimensions match, no block shows as unknown, and the overlay reads as the source block from a distance.

---

## Open items

- Mojang's asset CDN was DNS-blocked from this sandbox (confirmed across Bash, the browser pane, and
  WebFetch — all three failed to resolve `*.mojang.com`), so optional auto-download of official assets
  stays out of scope; user-supplied archives are the only texture path.
- ~~Not implemented: IndexedDB caching~~ — added in v0.2.0 (`src/assets/archiveCache.ts`): a successful
  upload is cached and restored automatically on the next visit, with a "Use a different file" control to
  replace it.
- Deployed inside the app hub (`../app-collection`) at `https://appstugan.up.railway.app/block-scaler/`; it was a standalone Railway service before v0.16.0.
