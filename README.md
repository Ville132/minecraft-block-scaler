# Minecraft Block Scaler

Turn one Minecraft block into a giant, scale-true replica — with the exact material
list needed to build it, and a `.litematic` download to use as a build overlay.

Built for Java Edition **26.3** ("Wilderness Bound"). See [PLAN.md](PLAN.md) for the
full design: the scale math, the verified `.litematic` format details, and the
module breakdown.

## Why you supply your own textures

Mojang's block textures aren't redistributable, so this app never bundles them.
Instead, you upload your own `26.3.jar` client file (or any resource pack `.zip`) and
everything is read and processed locally in your browser — nothing is uploaded
anywhere.

## Running locally

```bash
pnpm install
pnpm dev
```

Then open the printed `localhost` URL, upload your client jar, pick a block, pick a
size, and build.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the Vite dev server |
| `pnpm build` | Typechecks and builds the production bundle (app + server) |
| `pnpm start` | Runs the production static server (after `pnpm build`) |
| `pnpm test` | Runs the test suite once |
| `pnpm test:watch` | Runs tests in watch mode |
| `pnpm typecheck` | Typechecks the app and the server with no emit |

## How it works, briefly

1. **Scale math** (`src/domain/scale.ts`) — only sizes that keep a 16×16 texture's
   pixel grid uniform (multiples or divisors of 16) are offered as "scale-true".
2. **Asset reading** (`src/assets/`) — unzips the uploaded archive, resolves a
   block's model down to its six face textures, and decodes those textures.
3. **Color matching** (`src/domain/color.ts`, `palette.ts`) — pixels are averaged in
   linear light and matched to candidate blocks by nearest Oklab distance, which is
   what makes the replica actually look like the source block up close.
4. **Voxel grid** (`src/domain/shell.ts`) — builds the hollow or solid voxel grid,
   resolving which face "owns" each boundary voxel's appearance.
5. **Materials** (`src/domain/materials.ts`) — tallies the voxel grid into a shopping
   list broken into shulker boxes / stacks / loose items.
6. **Schematic writer** (`src/litematic/`) — a from-scratch NBT writer and
   Litematica-compatible bit-packed block-state array, gzipped into a `.litematic`
   file.

## Testing

Every pure/domain module has unit tests (`pnpm test`); the two exceptions are
`assets/textureDecoder.ts` and `ui/download.ts`, which are thin wrappers around
browser-only APIs (canvas decoding, anchor-click downloads) with no logic of their
own to test — see their header comments.
