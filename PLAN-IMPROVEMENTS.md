# Block-Selection & Appearance Overhaul (target: v0.10.0)

## Context

A giant log was built in-game from a generated `.litematic` and came out wrong:
*"almost as if some of the pixels had been skipped and jumped over, so that most of
it was one color."*

Investigation found the sampling math is **not** at fault — `pixelRegionForVoxelCoord`
(`src/domain/shell.ts:195`) hits every one of the 16 texture pixels exactly `n` times for
any `edgeBlocks = 16n`. Nothing is skipped. The real causes are elsewhere:

**1. A candidate block is judged only by its *average* color — never by how busy its
texture is.** `representativeColor` (`src/domain/palette.ts:243`) collapses each block to a
single Oklab value, and `findNearestOklab` (`src/domain/color.ts:161`) picks the nearest
one. Two things follow. The candidate cloud occupies a much smaller region of Oklab than
the source's per-pixel colors do, so neighbouring pixels collapse onto the same block —
detail vanishes and reads as "pixels were skipped". And because a block's own mean sits in
the middle of its own pixel cloud, **the source block wins for a large share of its own
pixels**: a test build of `stripped_oak_log` came out as 1352 blocks of exactly one block
type. That is the "most of it was one color".

**2. The palette is structurally small.** `resolveSingleVariantCubeModel`
(`src/assets/modelResolver.ts:276`) accepts only blockstates with a single `""` variant.
That rejects ~50–70 full opaque cubes, including **all 16 glazed terracotta** — the most
saturated cubes in the game, with no equivalent currently in the palette at all.

**3. Three genuine bugs**, found while tracing the pipeline (details in Stage 3).

The intended outcome: a giant log that actually reads as a log — correct orientation, a
palette wide enough to express the bark's range, and block choices that account for what
each block *looks like*, not just its average color.

## Decisions taken with the user

- **The source block stays eligible.** If the log genuinely is the best match, that's fine.
  What matters instead is that the app understands *how a candidate looks up close* — a
  block with "extremely much texture and many different colors" is a poor stand-in for a
  flat color. That requirement drives Stage 1, and it also fixes the collapse in a
  principled way rather than by special-casing the source. (Stripped vs. non-stripped logs
  both staying in the pool is expected and desirable — the flatter one will naturally win
  where colors are close.)
- **Dithering: implemented, but off by default** — an opt-in toggle.
- **Palette expansion: allow all property-bearing full cubes**, machine/face blocks included.

## Stage 0 — Copy this plan into the project

Plan mode cannot write to the project folder. First action after approval: save this file as
`PLAN-IMPROVEMENTS.md` next to the existing `PLAN.md` (which stays as the original design
record), then work through the stages below.

---

## Stage 1 — Texture-busyness–aware matching *(the headline fix)*

Today a block is represented by its mean color `M`. Add its **variance** — how far a typical
pixel of that block sits from `M`, perceptually — and use both.

This needs no tuning constant, because the right cost function falls straight out of the
bias–variance identity. The expected squared perceptual error of using block `B` to stand in
for a target color `T`, if you look at a random pixel of `B`, is:

```
E[ |pixel − T|² ]  =  |mean_B − T|²  +  Var_B
                       ^bias²          ^variance
```

So the match cost is literally `colorDistance² + variance`. A noisy block is penalised by
exactly the amount of error its own noise contributes — no magic number. Current behaviour
is the special case `variance = 0`.

**Files / changes**

- `src/domain/palette.ts`
  - `opaqueTextureAverage` → returns mean *and* the pixel list's squared spread, so the
    per-texture pass isn't repeated. Rename to `opaqueTextureStatistics`, returning
    `{ mean: LinearRgb; } ` plus the Oklab second moment.
  - `representativeColor` → `representativeAppearance`, returning
    `{ color: Oklab; variance: number }`. Variance is pooled over *all* pixels of all
    distinct face textures (equal weight per texture, matching the existing mean
    convention) — so a block whose faces differ wildly is correctly scored as a poor
    single-color stand-in, not just a noisy one.
  - `PaletteBlock` gains `readonly textureVariance: number` (Oklab ΔE² units).
- `src/domain/color.ts`
  - `findNearestOklab` gains an optional cost term. Cleanest shape: a new
    `findBestMatch(target, candidates, { varianceWeight })` where each candidate carries
    `{ color, variance, item }`, scoring `oklabDistanceSquared(color, target) + varianceWeight * variance`.
    Keep `findNearestOklab` as-is for existing callers/tests.
- `src/domain/shell.ts` — `buildVoxelGrid` passes `varianceWeight` through.
- `src/ui/` — expose it. `1.0` is the principled default; `0` reproduces today's pure
  colour match. Suggest three labelled choices rather than a raw slider:
  *"Any block"* (0) · *"Prefer clean textures"* (1.0, default) · *"Strongly prefer clean textures"* (2.5).

**Tests** (`color.test.ts`, `palette.test.ts`) — hand-computed goldens:
a flat block and a noisy block with the *same* mean, where the flat one must win at weight 1
and the noisy one must win at weight 0; variance of a known 2-colour checkerboard computed
by hand; variance `0` for a solid texture.

**Risk**: low. Biases results toward wool/concrete/terracotta and away from stone-family
blocks — which is the point, but it is a visible change in character, hence the weight-0
escape hatch.

---

## Stage 2 — Palette expansion

Roughly doubles the usable colour range, which is what makes Stage 1's better matching have
somewhere to go.

- `src/assets/modelResolver.ts` — add `resolveCanonicalVariantCubeModel(archive, blockId)`
  returning `{ model, properties }`. Parse every `variants` key into property pairs; choose
  deterministically via a preference table (`lit=false`, `snowy=false`, `powered=false`,
  `facing=north`, `half=bottom`, …), tie-broken by lexicographically smallest key. The
  existing full-cube geometry check (`isFullCubeElement`, `:174`) still rejects stairs,
  slabs and doors, so the filter stays sound. Exactly **one** canonical variant per block id
  — that keeps `materials.ts`'s block-id-keyed tally collision-free.
- `src/domain/palette.ts` — `buildPalette` uses the new resolver and must now explicitly
  skip `hasAxisVariants` blocks, or `oak_log` lands in both lists and breaks the
  disjointness test (`palette.test.ts:377`). `PaletteBlock` gains optional
  `properties?: Readonly<Record<string, string>>`.
- `src/litematic/writeSchematic.ts` — the palette currently dedupes on
  `resourceLocation` alone (`:63`) and writes `{ Name }` only (`:94`). Dedupe key becomes a
  canonical `minecraft:furnace[facing=north,lit=false]` string (properties sorted by key),
  and `Properties` is emitted **only when non-empty** so the existing golden-byte test stays
  valid.
- `opaqueTextureAverage` — relax `alpha !== 255` (`:220`) to `alpha < 250`. Rescues resource
  packs with rounding noise; anything genuinely translucent still stays out.

**Tests**: canonical-variant selection is deterministic for a multi-variant fixture; a
two-entry schematic palette where one block carries properties asserts ordering and that the
property-free entry has no `Properties` tag.

**Risk**: medium — widest blast radius of any stage. Do it after Stage 1 so the two are
separable if a build looks off.

---

## Stage 3 — Three correctness bugs

**3a. Side faces are upside-down.** `DecodedTexture` is row-major from the top-left
(`textureDecoder.ts:20`), so `v=0` is the texture's top — but `faceLocalCoordinates`
(`shell.ts:137`) uses `v = y`, and `y=0` is the build's *bottom*. All four side faces render
flipped.

**3b. Opposing faces are mirrored.** East and west both use `u = z`; north and south both use
`u = x`. Working from `u = v × n`: east needs `u = −z`, north needs `u = −x`; west and south
are already right.

Fix both in one change: `faceScreenAxes` returns flip flags alongside axes, and
`flipCoord(c, edge) = flip ? edge − 1 − c : c` is applied in **both** `faceLocalCoordinates`
and `positionOnFace` — they must stay exact inverses or the preview double-flips. Leave the
up/down cap convention alone (no principled "right" orientation; document that).

`shell.test.ts:234` currently *pins the bug* ("Low y → texture's top half") and must be
inverted. Add a new test with a horizontally-striped fixture — no existing fixture can see a
u-flip, which is how 3b survived.

*(3b shipped in v0.17.1, after an in-game report on a mangrove log — as a per-face table of
Minecraft's default UVs in `faces.ts`, which also un-mirrors the bottom cap: leaving up/down
alone was wrong, since one of two caps sharing a frame is always seen mirrored.)*

**3c. Texture resolution is assumed to be 16.** `classifyScale` / `listScaleOptions` already
take a `texturePixelsPerSide` parameter, but `ScaleAndOptionsStep.tsx:47,53,64` always use
the default 16 while `faceSamplesAt` samples at the texture's *real* width. On a 32px resource
pack, edge 48 is labelled "exact" while `floor(v·32/48)` genuinely skips and repeats pixels —
the literal version of the reported symptom, for anyone not on vanilla. Add a synchronous
`readPngWidth(bytes)` to `textureDecoder.ts` (IHDR width, bytes 16–20, big-endian — no canvas
needed), resolve the source block's texture width in `App.tsx`, and thread it through.

Fold in one hardening fix here: replace `Math.ceil(Math.log2(n))` in `bitArray.ts:33` with an
integer bit-length loop, removing a floating-point edge case from the one calculation that
would silently corrupt every schematic.

---

## Stage 4 — Dithering (opt-in)

New `src/domain/dither.ts`. Floyd–Steinberg error diffusion over the **source texture's pixel
grid, per face** — not the voxel grid — so each pixel still maps to a whole `k×k` block region
and scale-trueness is preserved.

This requires restructuring `buildVoxelGrid` from per-voxel pull to **per-face precompute**:
`resolvedColorCache` (`shell.ts:285`) is keyed by pixel region, which is wrong once the choice
becomes position-dependent. Replace it with a per-face decision table computed in scan order,
then index it from the voxel loop. Work stays bounded by `6 × textureSize²`, same as today.

- Accumulate error in **Oklab** (the matching space, so diffused error is perceptually
  uniform, and goldens stay hand-computable). Clamp `L` to `[0,1]` before matching.
- Serpentine scan, standard 7/16·3/16·5/16·1/16 kernel, out-of-bounds weight discarded.
- Fully deterministic — no RNG.
- Two-face edge voxels keep the existing undithered blended path (one-voxel seam; keeps the
  edge-blend test green).
- Reaches `buildVoxelGrid` as `BuildVoxelGridParams.dither?: DitherOptions`; `undefined` =
  off, so every existing shell test passes unchanged. UI toggle defaults **off**.

**Tests** (`dither.test.ts`): hand-computed error propagation on a 4×1 grid with a 3-colour
palette; a uniform target must yield a uniform result (dither must not invent noise where
there is no error); a 50% two-colour target must alternate rather than collapse.

---

## Stage 5 — Preview that predicts the real build

The current preview (`PreviewCanvas.tsx:58`) draws each voxel as its chosen block's **flat
average colour**. That is exactly why this bug reached the game: a wall of one noisy block
previews as a clean, plausible solid colour. It also can't show the user what Stage 1 is
reasoning about.

`buildReplica` additionally decodes the textures of the distinct blocks in the material list
(tens of ids, decoder already caches) and returns `usedBlockTextures`. `PreviewCanvas` gains a
third canvas rendering each voxel as a `k×k` nearest-sampled patch of its chosen block's real
texture (`k = 4`, canvas capped ~512px, sampling the voxel grid beyond that).

Also surface each block's busyness in the picker — a small "flat / textured" indicator driven
by `textureVariance` — so the Stage 1 behaviour is legible rather than mysterious.

Pure UI, zero domain risk, highest explanatory value. Last.

---

## Explicitly not doing

- **Per-face candidate colours** (matching against a fill block's individual faces) — you
  can't control which face points outward for most blocks, so the whole-block average is the
  honest representation.
- **Ordered/Bayer dithering** — worse than Floyd–Steinberg for small, unevenly-spaced palettes.
- **A k-d tree for nearest-neighbour** — ~200 candidates × ≤1536 cells. The linear scan is free.
- **One palette entry per blockstate variant** — explodes the material list for near-zero
  colour gain over one canonical variant.
- **Hard-excluding the source block** — the user explicitly wants it eligible; Stage 1 handles
  the collapse on the merits instead.

---

## Critical files

| File | Stages |
|---|---|
| `src/domain/palette.ts` | 1, 2 |
| `src/domain/color.ts` | 1 |
| `src/domain/shell.ts` | 1, 3a/3b, 4 |
| `src/assets/modelResolver.ts` | 2 |
| `src/litematic/writeSchematic.ts` | 2 |
| `src/domain/dither.ts` *(new)* | 4 |
| `src/assets/textureDecoder.ts` | 2, 3c, 5 |
| `src/ui/App.tsx`, `BlockPickerStep.tsx`, `ScaleAndOptionsStep.tsx`, `PreviewCanvas.tsx` | 1, 3c, 4, 5 |

## Verification

**Per stage** — `pnpm typecheck && pnpm test`. 221 tests pass today; Stages 1–4 each add
deterministic unit tests with hand-computed goldens, in the style already used across
`color.test.ts` / `shell.test.ts`. Stage 3a inverts an existing assertion that currently pins
a bug — update it rather than working around it.

**End to end, in the browser** — run `pnpm dev`, load a real `26.3.jar`, and for each of
Stages 1, 2 and 4 build the *same* oak log at 32³ and compare the material list:

- Stage 1 should break the single-block-type collapse — expect a materially longer list.
- Stage 2 should introduce colours (glazed terracotta family) that were previously unreachable.
- Stage 4 (toggled on) should raise the distinct-block count again and smooth gradients.

Stage 3a/3b are verified against the **cap** face preview: an oak log's end grain is
concentric, so a vertical flip and a mirror are both visible there; a flat bark-only fixture
cannot show either, which is how both survived this long.

**The real test is in-game** — the earlier `.litematic` work was format-verified only against
this project's own reader, a closed loop. Load the regenerated log schematic in Litematica on
Java 26.3 and confirm: dimensions match, no block renders as "unknown" (this specifically
exercises the Stage 2 `Properties` writing, which is new), and the build reads as a log from a
distance. Stage 5's texture-accurate preview should by then be predicting that result closely
— if preview and game disagree, the preview is the thing to trust less.
