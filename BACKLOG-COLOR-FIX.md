# Fix: the replica uses completely wrong colors

> Status: **implemented in v0.14.0.** What was built, and where it deviated from this
> plan, is recorded in "Implementation notes" at the end of this document.

## Context

A giant `acacia_log` (bright orange top) renders in **white/pale** blocks. A
`mangrove_log` (dark brown) renders with **white** in it. Beehive likewise. The ring
*pattern* survives; the *hue* is destroyed — the colour goes in the wrong direction
entirely.

This is a regression introduced in v0.11.0 as "contrast preservation" (BACKLOG.md 2.1).
It has been live and wrong since then, through v0.12.0 and v0.13.0.

---

## Diagnosis — reproduced numerically, not guessed

### Root cause 1: the contrast stretch destroys absolute colour *(this is the whole bug)*

`contrast.ts`'s `stretchLightness` remaps each face's own Oklab `L` range onto the
**entire palette's** `L` range, leaving `a`/`b` untouched, with no clamp:

```ts
const t = (color.L - sourceRange.min) / sourceSpan;
return { ...color, L: targetRange.min + t * (targetRange.max - targetRange.min) };
```

Target range is `lightnessRangeOf(paletteCandidates…)` — the whole palette, any hue
(`shell.ts:498`). Measured on real Oklab values:

| source pixel | raw L | stretched L | match WITH stretch | match WITHOUT |
|---|---|---|---|---|
| acacia `rgb(190,110,65)` | 0.618 | **0.934** | `quartz_block` | `stripped_acacia_log` |
| acacia `rgb(140,76,42)` | 0.487 | **0.145** | `black_concrete` | `orange_terracotta` |
| mangrove `rgb(118,66,57)` | 0.440 | **0.934** | `quartz_block` | `mangrove_planks` |
| mangrove `rgb(102,58,51)` | 0.400 | 0.677 | `oak_planks` | `mangrove_planks` |

Without the stretch the matcher picks **exactly the blocks you expected**: acacia_planks,
stripped_acacia_log, orange_terracotta, mangrove_planks. Match distances are also
3–10× better (0.005–0.050 vs 0.055–0.110).

**Why hue cannot win.** `oklabDistanceSquared` weights L:a:b equally 1:1:1. Oklab `L`
spans ~[0,1], but real block chroma spread is under ~0.15. A manufactured ΔL of up to
~0.78 therefore **exceeds the palette's entire achievable chroma spread** — the argmin
is decided by `L` alone, and the palette's `L` extremes are near-neutral by
construction. Hue becomes arithmetically irrelevant.

### Root cause 2: the variance term outranks colour *(real, but minor — do not oversell)*

`findBestMatch` scores `dist² + varianceWeight·variance + 0.001·cost`. For a good match
`dist²` ≈ 0.00003; `variance` is 0.001–0.05 — an order of magnitude larger. So among
close colours the variance term decides entirely.

**Correction to the first read:** with the stretch removed, variance could *not* change
the hue family in simulation — acacia resolved to the same orange blocks at weight 0
and weight 1. This is a **"wrong member of the right family"** defect, not a cause of
white blocks. Fix it on principle; its regression test belongs in `color.test.ts` with
synthetic values, not in `shell.test.ts`. Don't let it dilute the test that matters.

`acquisitionCost` contributes ≤0.002 and is **not** a factor.

### Root cause 3: the test gap that let this ship

Every existing fixture is either a **pure primary** (RED/GREEN/BLUE, where the palette
is built from the *same* primaries so source range == palette range → the stretch is an
identity) or **pure grayscale** (where a≈b≈0, so there is no hue to destroy). Not one
test uses a saturated, narrow-range texture against a palette holding both same-hue and
neutral blocks.

Worse: the broken behaviour is **pinned by a passing test** — `shell.test.ts:499-539`
asserts a grey 100-vs-130 source produces `white_concrete` and `black_concrete`, calling
it "pushed all the way to the two ends of what's available." That test asserts the exact
failure mode as correct and must be rewritten, not supplemented.

---

## Decisions (already made — do not re-litigate)

1. **Contrast stretch OFF by default.** Absolute colour fidelity is the default. Contrast
   enhancement survives as an opt-in that amplifies around the face's **own mean**, so
   the absolute colour never moves.
2. **Colour always wins over texture-busyness.** Variance may only separate candidates
   already near-equal in colour.

---

## The fix

### Step 1 — `color.ts`: colour-first matching *(land first, independently)*

Replace the weighted sum with a lexicographic rule:

1. keep candidates with `oklabDistance ≤ bestDistance + colorTolerance`
2. among those: lowest `variance`
3. ties: lowest `acquisitionCost ?? 0`
4. ties: first-listed

Validated — at tolerance 0 / 0.02 / 0.05 acacia resolves to
`acacia_planks` / `stripped_acacia_log` / `orange_terracotta` and mangrove to
`mangrove_planks` at every value. White/quartz/poplar never win at any tolerance.

```ts
export interface MatchOptions { readonly colorTolerance: number; }
export function createMatcher<T>(candidates: readonly ScoredCandidate<T>[], options: MatchOptions): (target: Oklab) => T
export function findBestMatch<T>(target: Oklab, candidates: readonly ScoredCandidate<T>[], options: MatchOptions): T
```

*(Name it `colorTolerance`, not `varianceTolerance` — it is a tolerance on **colour**,
spent to buy flatness.)*

**Two implementation landmines:**

- **Float boundary at tolerance 0.** `Math.sqrt(x) ** 2` can land one ulp below `x`, so
  the argmin can fail its own threshold and leave the band empty — and `findNearestOklab`
  calls through with tolerance 0. Guard both ways:
  `tolerance <= 0 ? bestD2 : (Math.sqrt(bestD2) + tolerance) ** 2`, **and** seed the
  second pass with the argmin so it is a member by construction.
- **Two passes double the hot loop** (~39M → 79M distance computations at 128³ against an
  HD pack). `createMatcher` binds the pool once and owns a `Float64Array` scratch buffer,
  so each call is one distance pass plus a cheap numeric scan. Note
  `noUncheckedIndexedAccess` applies to typed arrays here — `buffer[i]!`.

Delete `costWeight` / `DEFAULT_COST_WEIGHT` (exported, so `noUnusedLocals` won't flag it).
Lexicographic ordering makes its doc comment's own claim — "only ever meant to break a
near-tie" — literally true instead of approximately true, and removes a magic number.

**`dither.ts:107-116` must share this helper, not mirror it.** `shell.ts:390-394`
documents an invariant that the two modes "never disagree about what colour they were
aiming for"; two copies of an intricate band rule will drift and break it silently.
Collapse `DitherCandidate` → `ScoredCandidate`, `DitherOptions` → `MatchOptions`, and
`BuildVoxelGridParams.dither` → `dither?: boolean` (a second place to set tolerance is a
trap). Side benefit: dithering starts honouring `acquisitionCost`, which `shell.ts:399`
already passes and `dither.ts` silently dropped.

### Step 2 — `contrast.ts` + `shell.ts`: the actual fix

```ts
export function amplifyLightness(color: Oklab, faceMeanLightness: number, gain: number): Oklab
// L' = clamp01(faceMeanLightness + (color.L - faceMeanLightness) * gain)
```

- `gain === 1` → return `color` by identity. The default path is provably free and
  provably a no-op.
- `a`/`b` untouched (that part of the old design was always right).
- **No palette parameter of any kind.** Clamp to `[0,1]`, *not* to the palette range.

> **This is the key structural decision.** Both clamps produce byte-identical results
> across every validation fixture at gains 1.0–3.0, so the palette clamp buys nothing —
> but removing the palette from `contrast.ts` entirely makes full-range normalisation
> **inexpressible without changing a signature.** That is a stronger guarantee than any
> test. `[0,1]` is also already the precedent at `dither.ts:105`.

Add `assertContrastGain` (throws below 1 — a gain <1 would *compress* toward the mean,
a different feature). Call it once in `buildVoxelGrid`'s validation block, never
per-pixel.

In `shell.ts`:
- `sourceLightnessRangeByFace: Map<…, LightnessRange>` → `faceMeanLightnessByFace: Map<…, number>`.
  Nothing needs min/max and mean together, and carrying a *range* into the matching path
  is precisely the input that caused the bug.
- **Delete `paletteLightnessRange` (`shell.ts:498`) outright — that one line is the bug.**
- New streaming `meanPixelLightness(texture)` (running sum, no array), **memoized by
  `DecodedTexture` object identity** — `buildReplica.ts:225-239` hands all six faces the
  same object for a `cube_all` block, so today's code scans it six times.
- When gain is 1, skip the scan entirely (`faceMeanLightness = undefined`). This is a net
  **win** over today: `allPixelOklabColors` currently runs unconditionally on all six
  faces and materialises up to 262k short-lived objects per face — the same memory
  pressure commit `f313f9a` removed from `palette.ts` and left behind here.
- Both call sites: undithered `shell.ts:580-585`, and `buildDitheredFaceGrid`
  (drop both range params, take `contrast: {meanL, gain} | undefined`).
- Rewrite the doc comments at `shell.ts:440-448` and `491-497` — they currently argue
  *for* the bug ("always on, not an option, since it exists to fix a bug").

**Do not build gamut clipping.** The stretched colour is only ever consumed by a distance
comparison against in-gamut candidates; nothing renders it. Nearest-match is well-defined
for an out-of-gamut target. It would be cost with no behaviour change.

### Step 3 — UI

`VARIANCE_WEIGHT_CHOICES` → tolerance values with honest, calibrated copy:

| tolerance | label | hint |
|---|---|---|
| `0` | Closest colour, always | Always the single nearest-coloured block, however busy its texture. |
| `0.02` | Prefer clean textures *(default)* | Accepts up to 0.02 Oklab off — about one just-noticeable difference — for a flatter texture. |
| `0.05` | Strongly prefer clean textures | Accepts a visibly different block (up to 0.05) for a flatter texture. |

New contrast control next to dithering (both answer "how do we translate colour"), as a
3-way radio to avoid a disabled-input dance: **True colour (1, default)** / **Boost
contrast (1.5)** / **Strong contrast (2.0)**. Stop at 2.0 — at gain 3.0 acacia's dark
pixel crosses out of the orange family. Render only the selected option's hint, matching
the 4.5 pattern already in that file.

> **⚠ Migration hazard — this one is severe.** Options persist via `usePersistedState`.
> A stored `varianceWeight` of `1` reinterpreted as a *tolerance* of 1.0 exceeds the
> maximum possible sRGB distance → every candidate lands in the band → every voxel
> becomes **the flattest block in the whole palette**: a uniformly pale flat replica,
> *visually indistinguishable from the bug being fixed*, silently, for every returning
> user. **Fix by changing the storage key** to `colorTolerance` — an absent key returns
> the fallback through `readPersisted`'s existing `raw === null` branch. Zero migration
> code. `contrastGain` is a brand-new key, no hazard. Also `RangeError` on a negative or
> non-finite tolerance in the domain.

### Step 4 — the misleading message, and dead code

`isPaletteLimited: sourceSpan > paletteSpan` reports **false** precisely in the
narrow-saturated case where damage was worst (acacia: 0.095 > 0.785 = false), and its
`ResultPanel.tsx` copy describes the mechanism being deleted.

Repoint the same measurement at a question that is actually true and useful: a *small*
span means the block has little internal pattern — exactly when someone wants the new
contrast control. `isPaletteLimited` → `isLowContrast` (threshold ~0.12: fires for
acacia 0.095 and mangrove 0.088, not for cobblestone-class 0.2–0.3). **Note the direction
inverts** — the current doc comment carefully justifies reporting the *widest* face; under
the new question it must be the *narrowest*. Drop the `paletteColors` parameter entirely,
completing the guarantee that `contrast.ts` never sees the palette. Delete
`allPixelOklabColors`.

---

## Test strategy *(the part that actually prevents recurrence)*

**Rewrite `shell.test.ts:499-539`** — its assertion *is* the failure mode. It becomes
two tests: (1) by default the 100-vs-130 grey source resolves to the nearest real grey,
with `white_concrete`/`black_concrete` asserted **absent from the whole build**; (2) an
explicit `contrastGain` separates them *without* reaching the extremes. Same fixture,
inverted assertion, so the diff reads as the deliberate decision it is.

**Retune `shell.test.ts:226-260`** — it *flips* under the new matcher: `closeButFlat` at
`(235,20,20)` is 0.0386 from pure RED, outside a 0.02 band, so the noisy exact match
would win. Change it to `(250,8,8)` (d = 0.0095) and record the distance in a comment.

**New regression tests** — add a palette fixture holding both same-hue and neutral blocks
(`acacia_planks`, `stripped_acacia_log`, `orange_terracotta`, `mangrove_planks`,
`dark_oak_planks`, `quartz_block`, `black_concrete`; `paletteBlock()` needs an optional
variance param):

1. Saturated narrow-range **orange** face → every face voxel ∈ orange family, and
   `quartz_block`/`black_concrete` appear **nowhere in the build**.
2. Same for **mangrove** dark brown.
3. **⚠ The guard test — palette invariance.** Build identical source textures twice: once
   against the 5 wood/terracotta blocks, once against those 5 **plus** `quartz_block` and
   `black_concrete`. Assert the `(x,y,z) → blockId` map is **identical**.
   > *Adding a block to the palette must not change which block a voxel that didn't pick
   > it resolves to.*
   This is the cleanest statement of "matching is absolute, not palette-relative", and is
   exactly what the stretch violated. **Any** reintroduction fails it immediately,
   including forms nobody has thought of yet.
4. `contrastGain: 1` ≡ param omitted (true no-op).
5. Flat face unchanged under `contrastGain: 2`.

**Write tests 1–2 against the pre-fix code first** and confirm they report
`quartz_block`/`black_concrete`. A fixture that fails for the wrong reason is worse than
no fixture.

**`contrast.test.ts`** (13 tests): delete 4, 5, 8 (they test the bug); rewrite 6, 7, 9,
12 (12's direction inverts); keep 1–3, 13. Add: mean preservation for a symmetric pair at
gains {1, 1.5, 2, 5} — *a full-range remap cannot satisfy this*; clamping at L>1; gain
validation.

**`color.test.ts`** — the existing `noisyNear`/`flatFar` pair is already the right fixture
for root cause 2; **flip its expectation** (that single assertion is the regression test).
Add a `flatNear` third candidate to pin the three-way band semantics at tolerance 0 /
0.02 / 0.09.

**`dither.test.ts`** — mechanical renames; use tolerance `0.2` not `0.1` at line 65-71
(the candidate sits at exactly d = 0.1, a float coin-flip). The three hand-traced
Floyd-Steinberg tests survive untouched.

---

## Verification

`pnpm typecheck && pnpm test`, then in a browser with a **real jar**:

1. `acacia_log`, 16³, hollow, defaults → **must be orange**: acacia_planks /
   stripped_acacia_log / orange_terracotta, with **no** quartz, white_concrete or poplar.
2. `mangrove_log` → dark browns, no white.
3. `cobblestone` → should look **the same as before this change** (its span was always
   wide enough that the old stretch was near-identity). A visible change here means
   something is wrong.
4. Contrast radio 1 → 1.5 → 2.0 on acacia: ring separation increases, hue family does not
   change.
5. Dithering on → orange-family mix, never pale. Confirms the shared matcher reached the
   dither path.
6. **Migration check:** set `localStorage["minecraft-block-scaler:varianceWeight"] = "2.5"`
   in devtools, reload, build → must use the new default. This is the one check that
   proves the key rename worked.
7. Both new controls persist across reload.

Then bump the version (currently 0.13.0) and deploy.

---

## Known limitations, deliberately out of scope

- **A multi-texture block's palette colour is one flat average across its faces.**
  `acacia_log` as a *candidate* averages grey-brown bark with its orange top, so neither
  face's real colour is ever a palette point. Worth a future item; not this fix.
- **`consolidateVoxels` picks survivors purely by usage count**, with no colour-coverage
  criterion — a minority hue is dropped regardless of visual importance. It amplifies an
  existing bias but cannot create one; with matching fixed, it keeps correct colours
  correct.
- The tolerance band is **discontinuous in the target colour** (a candidate at the band
  edge can flip between near-identical voxels). Bounded by `tolerance` by construction —
  document it, as it is the predictable source of any future "why do these two neighbours
  differ" report.

---

## Implementation notes (v0.14.0)

Built as planned — absolute colour matching, colour-first `createMatcher`, opt-in
mean-preserving `contrastGain`, `colorTolerance` under a new storage key,
`isLowContrast` replacing `isPaletteLimited`. Where building it taught something the
plan did not know:

- **Dithering needed a leash.** Error diffusion only converges for a target the palette
  can reach; for one outside it (a more saturated orange than any orange block) the
  error piles up cell after cell until a distant block — quartz — counts as nearest.
  `ditherGrid` now pulls each cell's working target back to within the best-match
  distance of the pixel's **true** colour (`dither.ts`, no tuned constant). It must be the
  *true* colour, not the contrast-boosted target: a boosted target is farther from every
  block, so sizing the leash from it rewarded the boost with a longer leash. A relative
  leash anchored on the boosted target could not be made safe at gain 2 for any useful
  factor (measured on orange, mangrove and oak fixtures). Consequence, by design:
  dithering stays near each pixel's own colour and does little where one block already
  matches well.
- **The matcher needed a variance resolution.** A perfectly flat texture's measured
  variance is `0` for one block and ~`1e-33` for the next (its mean is a sum divided by a
  pixel count and can land an ulp off). The old weighted sum never noticed; the
  lexicographic rule compared it exactly, so float noise chose between equally flat
  blocks and ignored which was nearer (a dark orange resolved to `red_terracotta` instead
  of the nearer `orange_terracotta`). Found only in the browser run. `color.ts` now
  compares variances at `VARIANCE_RESOLUTION` (1e-6).
- **Verification item 3 was wrong.** The plan expected cobblestone to look unchanged
  ("its span was always wide enough that the old stretch was near-identity"). It was not:
  the old stretch amplified even grey cobblestone onto the palette's whole range, so the
  v0.13.0 replica of a cobblestone contained white and black concrete. The new replica is
  greys only.

### Verification

`pnpm typecheck` clean; all tests green, including the palette-invariance guard and the
dithered-path regressions. Browser run against a 59-block synthetic pack (real-ish
colours, per-pixel texture noise, ring-patterned log tops): v0.13.0 reproduces the
reported bug on it — the `acacia_log` top comes out as 256 `quartz_block` plus
`black_terracotta`/`white_terracotta`, `mangrove_log` as 217 `quartz_block` plus
`white_terracotta` — and the new build gives only orange-family blocks for acacia and
dark browns for mangrove, greys for cobblestone. Contrast 1 → 1.5 → 2 separates the rings
without leaving the orange/red family; dithering on never brings in white or black; a
stale `varianceWeight=2.5` in `localStorage` is ignored; both new controls persist across
a reload.

**Not done (needs the real client jar):** the same check against real `acacia_log`,
`mangrove_log` and `beehive` textures.
