/**
 * Formats a material list for export. Pure string formatting, kept
 * separate from the DOM-triggering download code in `download.ts` so
 * it stays unit-testable.
 */

import type { MaterialListEntry } from "../domain/materials.ts";

function quantityLabel(entry: MaterialListEntry): string {
  const { shulkerBoxes, stacks, singles } = entry.breakdown;
  const parts: string[] = [];
  if (shulkerBoxes > 0) parts.push(`${shulkerBoxes} shulker box${shulkerBoxes === 1 ? "" : "es"}`);
  if (stacks > 0) parts.push(`${stacks} stack${stacks === 1 ? "" : "s"}`);
  if (singles > 0 || parts.length === 0) parts.push(`${singles} loose`);
  return parts.join(" + ");
}

/** A plain-text shopping list, one line per block, most-needed first. */
export function materialListToText(list: readonly MaterialListEntry[]): string {
  const lines = list.map(
    (entry) => `${entry.resourceLocation}: ${entry.count} (${quantityLabel(entry)})`,
  );
  return lines.join("\n");
}

function escapeCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A CSV with one row per block — importable into a spreadsheet. */
export function materialListToCsv(list: readonly MaterialListEntry[]): string {
  const header = "Block,Count,Shulker Boxes,Stacks,Singles";
  const rows = list.map((entry) =>
    [
      escapeCsvField(entry.resourceLocation),
      entry.count,
      entry.breakdown.shulkerBoxes,
      entry.breakdown.stacks,
      entry.breakdown.singles,
    ].join(","),
  );
  return [header, ...rows].join("\n");
}
