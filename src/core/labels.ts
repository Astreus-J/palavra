import type { ItemState } from "./resolver.js";

/** Short single line: collapses whitespace and cuts at `max` characters. */
export function shorten(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The title of an item: the `task` of the fact that started it, or, for facts written before `task`
 * existed, the start of its sentence.
 */
export function taskOf(item: ItemState): string {
  const root = item.history[0]?.fact ?? item.current;
  return root.task ?? shorten(root.text);
}
