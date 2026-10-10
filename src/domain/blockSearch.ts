/**
 * Matching a typed query against a block, for the block picker's search box.
 *
 * WHY this is more than `blockId.includes(query)`, which is what it replaced:
 * two separate failures, both of which made a block that IS available look
 * like one the app cannot build.
 *
 * 1. Minecraft's names are not the names people use. The nether's logs are
 *    called `warped_stem` and `crimson_hyphae` — there is no `*_log` in that
 *    family at all — so someone looking for a "warped log" found nothing,
 *    concluded it was unsupported, and reported it as a bug.
 * 2. Any query containing a space matched nothing whatsoever, because no
 *    block id contains one. "oak plank" and "red concrete" both came back
 *    empty.
 *
 * Matching every word separately against a set of terms fixes both. The id
 * itself is always one of the terms, so every query that matched before still
 * matches — this only ever widens the result set.
 */

import { isWoodFamilyBlock } from "./palette.ts";

/**
 * Every word a block should be findable by: the parts of its id, the whole
 * id, and the names players use that Mojang does not.
 *
 * Synonyms are a short, explicit list rather than a fuzzy-matching library.
 * A fuzzy matcher would also turn `stone` into `redstone` and `sand` into
 * `sandstone`, which makes a 700-block picker harder to use, not easier.
 */
export function searchTermsFor(blockId: string): ReadonlySet<string> {
  const terms = new Set(blockId.split("_"));
  // The full id, so a single-word query behaves exactly as the old substring
  // match did — this function can only ever add matches, never remove one.
  terms.add(blockId);

  if (isWoodFamilyBlock(blockId)) {
    terms.add("wood");
    // `isWoodFamilyBlock` is what keeps `mushroom_stem` out of this: it ends
    // in `_stem` but is fungus flesh, not a log by any name.
    if (terms.has("stem") || terms.has("hyphae")) terms.add("log");
  }
  // Every block whose id carries one of these is a nether block, and nothing
  // else is named after them.
  if (terms.has("crimson") || terms.has("warped")) terms.add("nether");
  if (terms.has("planks")) terms.add("plank");
  if (terms.has("terracotta")) terms.add("clay");

  return terms;
}

/**
 * Whether a block whose terms are `terms` should be shown for `query`.
 *
 * Every word of the query must match somewhere, so extra words narrow the
 * results rather than throwing them away: "warped log" finds the warped
 * stems and not the oak ones. A word matches as a substring, not a prefix,
 * so "cotta" still finds the terracottas the way it used to.
 *
 * Inputs: `terms` from {@link searchTermsFor}; `query`, raw from the input.
 * Output: whether to show the block. An empty or whitespace-only query shows
 * everything.
 */
export function matchesSearch(terms: ReadonlySet<string>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  return words.every((word) => {
    for (const term of terms) if (term.includes(word)) return true;
    return false;
  });
}
