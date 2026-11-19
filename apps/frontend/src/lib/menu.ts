/**
 * Keyboard and display helpers for menus (components/AccountMenu.tsx), following the WAI-ARIA menu
 * button pattern: arrows move between items and wrap around, Home and End jump to the ends.
 */

/** Which item a key moves focus to, or null if the key does not move it. */
export function menuFocusTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Up to two initials for an avatar: "Ada Lovelace" -> "AL", "ada" -> "A", "" -> "?". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = [...parts[0]!][0] ?? '';
  const last = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? '') : '';
  return (first + last).toUpperCase();
}
