/**
 * Reads a block's own crafting recipe (if any) to tell whether making
 * ONE requires a scarce ingredient — the gap a block's name alone
 * doesn't reveal: a jukebox is named for what it does, not that it
 * costs a diamond to craft, so `costTierOf` in `domain/palette.ts`
 * (which only looks at a block's own id) can't catch it.
 *
 * Recipes live under `data/minecraft/recipe/`, a separate tree from
 * the `assets/minecraft/...` paths `archiveReader.ts`'s other helpers
 * use — it's server-side game data, not client-side rendering data,
 * but the same jar/resource-pack archive carries both.
 *
 * Only the two most common recipe shapes (shaped and shapeless
 * crafting-table recipes) are understood. Everything else — a
 * different recipe type, no recipe file at all, a malformed one, an
 * ingredient expressed only as a tag — is treated the same as "could
 * not assess," which resolves to `false` (not scarce). That is a
 * deliberate fail-open: most blocks are mined or smelted and have no
 * recipe file at all, which is the expected, common case, not a sign
 * of anything scarce; a best-effort survival-friendliness check should
 * never exclude a block it genuinely cannot assess.
 */

import { stripNamespace, type MinecraftArchive } from "./archiveReader.ts";

const RECIPES_DIR = "data/minecraft/recipe/";

function recipePath(blockId: string): string {
  return `${RECIPES_DIR}${blockId}.json`;
}

/**
 * Item ids a block's own name never hints at, but whose presence
 * anywhere in its recipe makes mass-producing that block the opposite
 * of survival-friendly. Mirrors `domain/palette.ts`'s
 * `PRECIOUS_MATERIAL_BLOCK_IDS` in ingredient-item form (the raw and
 * nugget forms too, since those are the same underlying scarcity), plus
 * a few ingredients that only ever show up in a recipe, never as a
 * block someone would scale up directly.
 */
const SCARCE_INGREDIENT_ITEM_IDS: ReadonlySet<string> = new Set([
  "netherite_ingot",
  "netherite_scrap",
  "diamond",
  "gold_ingot",
  "gold_nugget",
  "raw_gold",
  "emerald",
  "iron_ingot",
  "iron_nugget",
  "raw_iron",
  "lapis_lazuli",
  "nether_star",
  "ancient_debris",
  "nautilus_shell",
  "totem_of_undying",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every item id one ingredient entry could resolve to — handles both
 * the plain `{ "item": "..." }` shape and a list of alternatives
 * (`[{ "item": "..." }, ...]`). A tag reference (`{ "tag": "..." }`) is
 * skipped rather than resolved: that needs the archive's tag files
 * too, and no ingredient this module treats as scarce is ever
 * expressed only as a tag in a block's own direct crafting recipe.
 */
function itemIdsIn(ingredient: unknown): string[] {
  if (Array.isArray(ingredient)) return ingredient.flatMap(itemIdsIn);
  if (isPlainObject(ingredient) && typeof ingredient.item === "string") {
    return [stripNamespace(ingredient.item)];
  }
  return [];
}

/**
 * Whether crafting one `blockId` needs a scarce ingredient, per its
 * own `data/minecraft/recipe/<blockId>.json` — the standard location
 * for a block's direct crafting recipe.
 *
 * Failure modes: none thrown. Every way this can't be assessed
 * (missing file, unsupported recipe type, malformed JSON) returns
 * `false` — see this module's header comment for why that is the
 * correct default, not a swallowed error.
 */
export function requiresScarceIngredient(archive: MinecraftArchive, blockId: string): boolean {
  const bytes = archive.getFile(recipePath(blockId));
  if (bytes === undefined) return false;

  let recipeJson: unknown;
  try {
    recipeJson = JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return false;
  }
  if (!isPlainObject(recipeJson)) return false;

  const recipeType = recipeJson.type;
  const ingredientItemIds: string[] = [];

  if (recipeType === "minecraft:crafting_shaped" && isPlainObject(recipeJson.key)) {
    for (const value of Object.values(recipeJson.key)) ingredientItemIds.push(...itemIdsIn(value));
  } else if (recipeType === "minecraft:crafting_shapeless" && Array.isArray(recipeJson.ingredients)) {
    for (const value of recipeJson.ingredients) ingredientItemIds.push(...itemIdsIn(value));
  } else {
    return false; // an unsupported recipe type — not assessed
  }

  return ingredientItemIds.some((itemId) => SCARCE_INGREDIENT_ITEM_IDS.has(itemId));
}
