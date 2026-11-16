export interface Mentionable {
  id: string;
  name: string;
}

/** Longest text after "@" still treated as a name being typed (names can contain spaces). */
const MAX_QUERY = 30;

/**
 * If the caret is just after "@something" (an "@" at the start or after whitespace, with no line
 * break since), return where the "@" is and what has been typed after it.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null; // e.g. an email address
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY || /[\n@]/.test(query)) return null;
  return { start: at, query };
}

/** Members whose name matches the query (start of a word first), excluding yourself; at most 5. */
export function suggestMembers(members: Mentionable[], query: string, selfId?: string): Mentionable[] {
  const q = query.trim().toLowerCase();
  const others = members.filter((m) => m.id !== selfId);
  const starts = others.filter((m) => m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || m.name.toLowerCase().startsWith(q));
  const contains = others.filter((m) => !starts.includes(m) && m.name.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, 5);
}

/** Replace "@query" (from `start` to the caret) with "@Name " and return the new text and caret. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

/** The ids of picked people whose "@Name" is still in the text (one may have been deleted since). */
export function mentionIdsIn(text: string, picked: Mentionable[]): string[] {
  return [...new Set(picked.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id))];
}
