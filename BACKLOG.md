# Improvement Backlog — Minecraft Block Scaler (post-v0.10.0)

## Context

v0.10.0 shipped the block-selection overhaul (texture-busyness matching, palette
expansion, the upside-down side faces, opt-in dithering, a real-texture preview).
This document is the next layer down: a full audit of the app — domain logic, UX,
file format, performance, infrastructure — turned into a prioritised backlog.

Roughly 60 concrete findings came out of that audit. This document keeps the ones
worth acting on, and explicitly records the ones that are **not** worth acting on
and why — because for a project of this size, deciding what to skip is most of the
value.

## Progress

Checked off as each item ships, with a one-line pointer to where. Unchecked items
are either not started or explicitly deferred (see each item's own text, or
"Deliberately not doing" below) — this list doesn't distinguish the two; read the
item itself for which.

- [x] 1.1 Palette cap — `domain/consolidate.ts`
- [x] 1.2 Cheap interior core — `shell.ts`'s `"solid-cheap-core"` fill style
- [x] 1.3 Material list (per-layer breakdown, grand totals, properties, distinct
      filenames, copy-to-clipboard) — raw-material decomposition and real
      cross-block shulker packing still deliberately not done, see the item itself
- [x] 1.4 Exclusion-list fixes — `domain/palette.ts`
- [x] 1.5 Cost-aware tie-breaking — `acquisitionCost` in `color.ts`/`palette.ts`
- [x] 2.1 Contrast preservation — `domain/contrast.ts`, the original bug report.
      **Superseded in v0.14.0:** the full-range stretch was the cause of the
      wrong-colour bug (orange logs rendered in white blocks) and was removed;
      contrast enhancement is now an opt-in around each face's own mean. See
      `BACKLOG-COLOR-FIX.md`.
- [x] Colour fidelity (v0.14.0) — absolute colour matching, colour-first matcher
      with a `colorTolerance`, opt-in `contrastGain`, dithering leash —
      `BACKLOG-COLOR-FIX.md`
- [x] 2.2 Jensen gap fix — `palette.ts`'s `representativeAppearance`
- [ ] 2.3 Down-scaled variance rule
- [x] 2.4 Emissive blocks — `palette.ts`'s `applyEmissiveBoost`
- [x] 2.5 Side-face preview fix (a fill block's wrong face showed on every side) — `buildReplica.ts`'s `resolveRepresentativeFaceTextures`; the edgeBlocks 1/2 degenerate-geometry half of this item is still open
- [ ] 3.1 Real Litematica fixture — needs you, not me
- [x] 3.2 README false claim fix
- [ ] 3.3 In-game orientation verification — needs you, not me
- [ ] 4.1 Preview-only fast path — investigated, deliberately not building the
      full version; see note below the checklist
- [x] 4.2 Stop destroying the result on every tweak — `App.tsx`'s `resultIsStale`
- [x] 4.3 Install instructions — `ResultPanel.tsx`
- [x] 4.4 Broken guards (warning threshold, Int32 overflow cap) — `ScaleAndOptionsStep.tsx`
- [x] 4.5 Smaller UX repairs (empty states, search feedback, localStorage persistence, confirm guard, selected-block context, variance-weight/dithering tooltip-to-visible-text) — the per-block-tile texture-variance tooltip was deliberately left as a tooltip (converting it would repeat a technical paragraph across every tile in the grid)
- [x] Tier 5: `unzipSync` filter — `archiveReader.ts`
- [x] Tier 5: palette memory fix — `palette.ts`'s `screenedTextureMean`/
      `meanSquaredDistanceFrom` stream per-pixel Oklab instead of materializing
      a LinearRgb[] and an Oklab[] per texture (the 2.2 Jensen-gap fix had added
      a second full array pass on top of the original one)
- [x] Tier 5: model/blockstate JSON caching — `modelResolver.ts`'s
      `memoizedByArchive`, scoped per archive instance via `WeakMap`
- [x] Tier 5: IndexedDB hardening — `archiveCache.ts` now has an `onblocked`
      handler and validates a read's shape instead of casting it blind;
      `blockStatePaletteEntryFor` memoization and the no-user-signal-on-
      quota-exceeded gap were investigated and left as is (see commit)
- [x] Tier 5: gzip server responses — `server.ts`, verified live (293KB to
      95KB on the JS bundle, byte-identical after decompression)
- [ ] Tier 5: vitest `.tsx` config (needs real RTL/jsdom test-writing to pay
      off, not just a config flip — not attempted this pass)

**On 4.1** — benchmarked `buildVoxelGrid` directly (40-candidate palette, 16px
source texture) before deciding whether to build it:

| edgeBlocks | hollow | solid-full |
|---|---|---|
| 16 | 12.7ms | 5.0ms |
| 32 | 5.5ms | 15.8ms |
| 64 | 21.6ms | 84.0ms |
| 128 | 37.1ms | **547.0ms** |

At this app's actual usage range (16-32, hollow by default) a build is already
imperceptible — there is no slowness for the fast path to fix. The one case where
it would matter, 128³ solid-full, is both a deliberately-opted-into combination
(the fill-style picker itself warns "much more material") and already caught by
the ≥1,000,000-voxel warning added in 4.4 before the user commits to it. Building
the fast path for real would mean decoupling the preview from the Build button
entirely — async texture-loading state in `App.tsx`, a UI reflow, new interaction
with 4.2's just-shipped staleness model — real scope and risk for a case this
plan's own "Deliberately not doing" section already resolves differently ("Web
worker / progress bar / cancellation... justified only above ~100k voxels... fix
the misconfigured warning and move on" — which is exactly what 4.4 did). Not
building it; revisit only if large solid builds become an actual reported pain
point.

### Three facts that drove the prioritisation

Priority here is not generic. It follows from three things about how this app is
actually used:

1. **The schematic format already works in-game.** A generated `.litematic` has
   loaded in Litematica successfully. That drops "the output might be fundamentally
   broken" from the top of the list to a cheap insurance job — but it does *not*
   clear the subtler orientation questions (below), which wouldn't be noticed
   casually.
2. **Blocks get placed by hand, one at a time.** This is the single biggest
   prioritisation input. Every distinct block type in the material list is a
   separate thing to go find, carry, and keep straight. A palette of 60 materials,
   half of them used two or three times, is the difference between a project that
   gets finished and one that gets abandoned. It also makes dithering actively
   counterproductive.
3. **Real builds are 16³–32³.** 32³ hollow is 5,768 blocks; 32³ solid is 32,768.
   That is nowhere near any performance ceiling, which removes a whole cluster of
   "the tab will freeze" findings from contention. What it *doesn't* remove is
   material cost: at 32³ solid, 27,000 of those blocks are interior blocks nobody
   will ever see — and right now every one of them is a hand-gathered,
   colour-matched block.

**The theme:** at these sizes the bottleneck is never the computer, it's the human
holding the blocks. Nearly everything below optimises for that.

## Step 0 — Copy this into the project

Plan mode cannot write to the project folder. First action after approval: save
this as `BACKLOG.md` alongside `PLAN.md` and `PLAN-IMPROVEMENTS.md`.

---

# Tier 1 — Buildability

*The things that decide whether a started build gets finished. Highest value given
hand-placement.*

### 1.1 Cap the palette / consolidate rare materials — **the top item** (M)

Nothing currently limits how many distinct block types a build uses. One 16×16
texture can resolve to 50–80 of them, many appearing only two or three times.
Every one is a separate gathering trip for a negligible visual gain.

Add a "maximum distinct materials" control (default somewhere around 8–16) applied
after the voxel grid resolves: take the N most-used blocks, then re-match every
voxel assigned to a dropped block to its nearest *surviving* neighbour. Re-matching
against the survivors (rather than just picking the top N up front) keeps the
colour error honest.

Show the user the trade: "32 materials → 12 materials, average colour error +3%."
That framing is the feature.

Files: `src/domain/materials.ts` (or a new `src/domain/consolidate.ts`),
`src/domain/shell.ts`, `src/ui/ScaleAndOptionsStep.tsx`.

### 1.2 Fill the interior with one cheap block (S)

`buildVoxelGrid` colour-matches every voxel of a solid build, including the
~27,000 interior blocks of a 32³ that are permanently invisible. Those are chosen
for a colour nobody can see, and then hand-gathered.

Add a fill-style option: **Hollow / Solid (cheap core) / Solid (fully matched)**,
where the cheap core uses a single configurable block (stone, cobble, dirt). This
is a correctness improvement, a large material-cost reduction, and it shrinks the
material list, all at once.

`isShellVoxel` already identifies exactly the right set — the interior branch just
needs to skip matching entirely.

Files: `src/domain/shell.ts`, `src/ui/ScaleAndOptionsStep.tsx`.

### 1.3 Material list for someone actually building it (M, splittable)

The current list is a flat total sorted by count. A hand-builder needs more:

- **Per-Y-layer breakdown** — "layer 17: 190 andesite, 66 tuff". You build a
  sculpture one layer at a time; the voxel data already carries `y` and nothing
  uses it. This is the single most useful addition in the whole document.
- **Grand totals** — total blocks, total shulker boxes, inventory loads
  (36 slots = 2,304 blocks), and a +5–10% spares margin.
- **Obtainability notes per block** — Nether/End-only, needs silk touch, needs
  smelting. This decides whether a build is feasible before it starts.
- **Raw-material decomposition** — 9,000 polished deepslate means 9,000 deepslate
  plus 2,250 crafting operations. `src/assets/recipes.ts` already parses shaped and
  shapeless recipes and the JSON carries `result.count`.
- **Shulker packing that is actually a plan** — currently just
  `floor(count / 1728)` per block; it never totals the boxes to craft or packs
  leftovers from several blocks together.
- **Copy to clipboard**, and distinct export filenames (currently every build
  downloads `material-list.txt`, so three configs collide as
  `material-list(2).txt` with no way to tell them apart).
- `MaterialListEntry` drops `properties`, so a list containing glazed terracotta
  never tells you which way to face it.

Files: `src/domain/materials.ts`, `src/ui/ResultPanel.tsx`,
`src/ui/materialListExport.ts`.

### 1.4 Exclusion-list fixes — blocks that ruin a finished build (XS–S)

Concrete, verified gaps in `src/domain/palette.ts`:

- **Coral blocks** (`tube_`/`brain_`/`bubble_`/`fire_`/`horn_coral_block`) are
  opaque, highly saturated full cubes — exactly what the matcher reaches for — and
  they turn grey within seconds out of water. Hours of placement, ruined overnight.
- **All 16 `*_concrete_powder`** are missing from `GRAVITY_BLOCK_IDS`, which lists
  only five entries. Matte, saturated, opaque — they *will* be picked, then fall.
- **Unwaxed copper** oxidises patchily over time. The `waxed_*` variants are
  pixel-identical and stable; prefer them, drop the unwaxed ones.
- **Unobtainable or hazardous full cubes** passing as `"common"`:
  `budding_amethyst` (never drops, grows clusters out of every face),
  `reinforced_deepslate`, `powder_snow`, `respawn_anchor`, `sculk_catalyst`.
- **Movement-altering blocks** that the same reasoning as slime/honey should
  already have caught: `packed_ice`, `blue_ice`, `soul_sand`, `mud`.
- **Flammability has no representation at all.** Wool is the palette's main source
  of saturated matte colour. Worth a toggle, not a doctrine.
- `isWoodFamilyBlock("mushroom_stem")` returns `true` — a false positive that leaks
  into the wood-only filter. The regex matches the `_stem` suffix.
- The biome-tint list is both over- and under-correct: leaf textures all have
  transparent pixels so they're already rejected by the alpha check (those ten
  entries are dead weight), while cherry/azalea/pale-oak leaves aren't
  biome-tinted at all and are being excluded for the wrong reason.

### 1.5 Cost-aware tie-breaking (S)

`costTier` is computed for every block and used only as a hard filter — it never
influences matching. When two candidates are within a hair of each other, the
cheap, stable, non-flammable one should win. Replace the binary tier with a small
numeric acquisition-cost score used both as filter and as a tie-break term in
`findBestMatch`.

Also worth revisiting what "precious" means at this scale: iron genuinely is
prohibitive (9 ingots per block), emerald is arguably the most farmable thing on
the list via trading halls, while copper, amethyst and the whole
prismarine/sea-lantern family are marked common and are not farmable at all.

---

# Tier 2 — Fidelity

*Whether the giant block actually reads as the block.*

### 2.1 Preserve the source's contrast (M) — the original complaint, still open

The reported bug was "most of it was one color". v0.10.0 addressed one cause
(busy candidate blocks winning on average colour). The other cause is untouched:
per-pixel nearest-match **compresses local contrast** wherever the candidate
cloud is sparse. The variance term penalises busy *candidates*; it does nothing
about lost *source* contrast.

At 16³ — where one texture pixel is exactly one block — there is no averaging to
hide behind, so this is the dominant fidelity issue at the sizes actually built.

Approach: match on local *differences* rather than absolute colours, or apply a
per-texture Oklab histogram stretch before matching. Nobody can judge a giant
log's absolute hue against anything; everybody recognises the bark pattern.

**The honest escape hatch:** the enabled palette's lightness range may simply not
span the source texture's. If so this isn't fully fixable, and the right product
answer is to *say so* — "this texture's contrast exceeds what your enabled blocks
can reach; enabling X would help" — rather than silently flattening. That message
is a better feature than any matching heuristic.

### 2.2 Fix the Jensen gap in `representativeAppearance` (S)

`color` is `Oklab(mean(linear))` while `variance` is the mean squared Oklab
distance from that point — which is not the Oklab centroid. Because `cbrt` is
concave, `color.L` systematically understates perceived lightness for
high-contrast textures (cobblestone, deepslate, gravel), and `variance` silently
absorbs the leftover bias². The doc comment claims `varianceWeight = 1` is the
"literal unscaled expected-error sum"; strictly, it currently isn't.

File: `src/domain/palette.ts`.

### 2.3 Down-scaled sizes want the opposite variance rule (S)

At a "reduced" size each target is the mean of a pixel region, so a *busy*
candidate is desirable — it carries local texture that matches. The model
currently penalises variance unconditionally. Score
`|var_candidate − var_sourceRegion|` instead of `var_candidate`.

### 2.4 Emissive blocks read brighter than their texture (S)

Glowstone, sea lanterns, shroomlight, froglights render at their own light level
regardless of face shading, so wherever the matcher places them the colour is
wrong. Add an emissive lightness offset when scoring, or a toggle.

### 2.5 The small geometry edges (S)

- `governingFaces` gives Y every tie, so each side face loses its top and bottom
  row to the cap texture. At `edgeBlocks=2` *every* voxel is cap-governed and the
  four side faces never sample their own texture at all. At 4, only the central
  2×2 of each face is pure side texture. These are offered sizes.
- `edgeBlocks=1` samples the `down` face only, where the honest answer is the
  whole-block average that `palette.ts` already computes for every candidate.
- Side faces preview using the **top** texture: `resolveRepresentativeTexture`
  always takes `faceTextureIds.up`, so a log previews its end-grain on every side
  in the "real textures" canvas — exactly the fidelity that view promises.

---

# Tier 3 — Trust

*Locking in what already works, cheaply.*

### 3.1 Commit a real Litematica-produced fixture (S) — do this first, it's 20 minutes

The format works in-game, but the only regression test compares the writer against
a fixture **the writer itself produced**, read back by its **own** reader. Any
systematic error is invisible to it, and `Version` / `SubVersion` /
`MinecraftDataVersion` were taken from a planning document, not read out of a real
file.

Fix the whole class in one move: save any schematic from Litematica in-game,
commit it as a second fixture, and assert (a) this project's reader parses it and
(b) its three version constants match ours. That converts a manual ritual into a
permanent test.

Reassuring context from the audit: the genuinely dangerous structural facts —
boundary-spanning bit packing, `max(2, bitlen)` bits, y-major indexing,
unnamed root compound, `palette[0] = minecraft:air` — are all correct. And the two
unverified constants are nearly inert here (`SubVersion` only discriminates
entity encodings, and we write none; `MinecraftDataVersion` only drives DataFixers,
and our palette is resource-location strings).

### 3.2 Fix the false claim in the README (XS)

`README.md:53` states the schematic writer was *"Cross-checked against the
independent Python `litemapy` library during development."* This never happened —
there is no Python, no requirements file, and no CI anywhere in the repo. It is a
one-line delete, and it should go out with 3.1 rather than sit there.

### 3.3 Verify orientation in-game, once (S — needs you, not me)

Two things were unverified in a real client, and neither would be noticed
casually. One is now settled:

- ~~**Horizontal mirroring** between opposite faces~~ — settled in v0.17.1. It
  was reported in-game on a mangrove log (two of four sides looked different):
  north, east and the bottom were mirrored. `faces.ts` now lays textures out with
  Minecraft's default per-face UVs, and a test asserts no face is mirrored.
  Rotated variants (sideways logs) now also turn their textures as the game does.
- **The v0.10.0 Properties writing** for multi-variant blocks (glazed terracotta
  facing, furnaces) has never been placed in-game.

One build with a deliberately asymmetric source block (a lettered or numbered
texture from a resource pack is ideal) settles both at once, plus confirms the
vertical-flip fix that shipped in v0.10.0.

---

# Tier 4 — The build/evaluate loop

### 4.1 A preview-only fast path (M) — the structural unlock

The nearest-match work is bounded by `6 × textureSize²` ≈ 1,536 lookups, *not* by
voxel count — the per-voxel cache already guarantees that. So a preview that
resolves only the six faces costs the same whether the build is 16³ or 128³.

Build that, and changing any option re-previews instantly. That gives A/B
comparison, "try dithering and see", and live option tweaking without ever
touching the expensive full-grid path — which then only runs on export.

### 4.2 Stop destroying the result on every tweak (S)

`App.tsx` calls `setResult(null)` from eight separate handlers. Flip any option to
see the difference and the result vanishes; you then scroll back up to step 4 to
rebuild and back down to look. For a tool whose whole value is "is this choice
better?", that's the central workflow wound. Needs a rebuild control near the
result, and ideally a kept previous result to compare against.

### 4.3 Tell the user what to do with the file (XS) — disproportionate value

The upload step has copy-paste OS paths and a Win+R trick. The download step says
nothing about Litematica being a mod, where `.minecraft/schematics` is, or how to
load an overlay. A schematic you can't install is worth the same as a broken one.
This is ~30 minutes of copy and it belongs with Tier 3.

### 4.4 Fix the two broken guards (XS)

`MAX_VOXELS_BEFORE_WARNING = 4_000_000` is *above* 128³ solid (2,097,152), so it
can never fire for any preset — and it's gated behind `customSizeIsValid`, so the
preset cards never evaluate it anyway. Lower it, apply it to the cards, and make
it fill-style aware. Also clamp the custom-size input: around S≈1291,
`nbt.int(volume)` overflows Int32 and writes a negative `TotalVolume`.

### 4.5 Smaller UX repairs (XS each)

- Step 2 shows a red error — *"No buildable blocks were found… try relaxing one of
  the toggles"* — before any archive is uploaded. Should be an
  "upload a jar above" empty state.
- An empty search result renders a blank box with no "0 of 412 match".
- A failed build leaves the previous result panel sitting below the new red error
  (`setResult` isn't cleared in the `catch`).
- "Use a different file" wipes archive, cache and selection instantly with no
  confirmation.
- Steps 3–5 never show which block you picked; scroll down and the context is gone.
- Critical explanations (texture variance, the three variance-weight options, the
  entire dithering description) live only in `title=` tooltips — invisible on
  touch, unreachable by keyboard.
- Persist the options (fill style, variance weight, toggles) in `localStorage`;
  the jar already persists, everything else resets on reload.

---

# Tier 5 — Cheap technical wins

- **`unzipSync` filter (XS, best value-per-effort in the repo).** The whole jar is
  eagerly inflated — ~25 MB, ~20k entries, overwhelmingly `.class` files never
  read. fflate already supports
  `unzipSync(bytes, { filter: f => f.name.startsWith("assets/minecraft/") || f.name.startsWith("data/minecraft/recipe/") })`.
  Roughly an order of magnitude less memory and time, no new dependency.
- **Memoise the palette across option toggles (M).** `buildPalette` re-decodes
  every texture whenever any option changes, but those flags only *filter* —
  `BlockAppearance` is option-independent. This also makes HD resource packs
  viable, which currently risk OOM: `opaqueTextureStatistics` materialises an
  object per pixel (a 512px pack is ~262k objects per texture). Welford
  accumulation over the typed array fixes both.
- **Memoise `blockStatePaletteEntryFor` (XS).** It runs twice per voxel and, for
  property-bearing blocks, does `Object.entries` + `sort` + `join` +
  `Object.fromEntries` *per voxel*.
- **Cache parsed model/blockstate JSON (S).** `readVariantsMap` re-parses per call;
  `block/cube_all` and `block/block` are re-parsed for every single candidate.
- **Harden the IndexedDB cache (S).** Unbounded, no quota handling (a
  `QuotaExceededError` is swallowed while the UI still promises "remembered for
  next time"), no `onblocked` handler (a second tab mid-upgrade hangs the promise
  forever), and the stored value is cast without validation.
- **Gzip the server responses (S).** 280 KB of JS served raw; ~85 KB gzipped.
  `server.ts` sets no `Content-Encoding` and Railway won't add one.
- **Let vitest see `.tsx` (S).** `include: ["src/**/*.test.ts"]` with
  `environment: "node"` means every component and — more importantly —
  `buildReplica.ts`, the only real integration seam, has zero coverage.

---

# Deliberately not doing

Recording these so they don't get re-litigated:

- **Web worker / progress bar / cancellation.** Justified only above ~100k voxels;
  32³ solid is 32,768. Fix the misconfigured warning (4.4) and move on.
- **BigInt optimisation in the bit packer.** Real, but it optimises making
  invisible interior blocks faster — item 1.2 deletes the work instead.
- **Investing further in dithering.** Error diffusion assumes a viewer who
  integrates adjacent samples and a printer that doesn't care how scattered the
  output is. Here the printer is a person placing blocks by hand, where speckle
  multiplies both the material count (fighting 1.1) and the per-block decision
  load. It also only behaves correctly at 1:1 (16³); at 32³ each dithered decision
  already covers a 2×2 block patch, and at 128³ an 8×8 one — blotches, not
  dithering. **Recommendation:** leave it off by default, document it as a 16³
  curiosity, and spend the effort on 2.1 — contrast was what dithering was
  standing in for all along.
- **CI, linting, formatters.** `pnpm typecheck` plus 254 tests, no collaborators.
  Keep the vitest `.tsx` gap (Tier 5) for the coverage, skip the ceremony.
- **Accessibility and responsive work.** Real findings — keyboard users can tab
  into "disabled" steps, there's essentially no ARIA, one CSS breakpoint — but the
  audience is one person on a desktop. Revisit only if this gets shared.
- **Security headers / path-traversal hardening in `server.ts`.** Static files, no
  secrets, no auth. The 404-returns-200 is the intended SPA fallback.
- **Permalinks / shareable configs.** No second user. Local persistence (4.5) has
  the value without the work.
- **3D preview.** The 2D per-face previews plus a real-texture view already answer
  "will this look right"; a 3D viewer is a large dependency for a small gain.

---

# Suggested order

1. **One afternoon, mostly copy and config:** 3.1 real fixture · 3.2 README ·
   4.3 install instructions · 4.4 broken guards · Tier 5 `unzipSync` filter.
2. **Buildability:** 1.2 cheap interior core · 1.4 exclusion fixes · 1.1 palette cap.
3. **Material list:** 1.3, starting with the per-layer breakdown.
4. **Fidelity:** 2.1 contrast · 2.2 Jensen gap · 1.5 cost-aware tie-breaking.
5. **Loop:** 4.1 preview-only path · 4.2 rebuild/compare · 4.5 UX repairs.
6. **Anything in Tier 5 that's still annoying.**

# Verification

**Per change:** `pnpm typecheck && pnpm test`. 254 tests pass today.

**Named test gaps worth closing alongside the work above:**
- `ditherGrid` — the 3/16 and 1/16 diagonal weights and the serpentine row reversal
  have **zero** coverage; every existing case is 4×1, 1×2, 1×1, or all-zero-error.
  A transposed or mis-mirrored kernel passes the whole suite today.
- `buildVoxelGrid` at `edgeBlocks` 1 and 2 (the all-caps degenerate behaviour in
  2.5), at a "reduced" size, with a single-block palette, and with
  `solid` + `dither` together.
- `positionOnFace` is never asserted to return the voxel that actually sampled
  texture cell (u,v) — only "right plane" and "on the shell". The entire preview
  rests on that inverse.
- `classifyScale` / `listScaleOptions` with a non-16 `texturePixelsPerSide`,
  despite `resolveSourceTexturePixelsPerSide` now feeding real HD values in.
- `buildMaterialList` with two voxels sharing a `blockId` but differing
  `properties`.

**End to end:** `pnpm dev`, load a real `26.3.jar`, build the same 32³ log before
and after each change and compare the material list — distinct-block count is the
headline number for Tier 1, and it should drop sharply.

**In-game (only you can do this):** one build from an asymmetric source texture
settles what is left of 3.3 — the v0.10.0 Properties writing — and re-confirms
the face orientation fixes, in a single session.
