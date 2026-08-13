/**
 * @signet/intelligence — portable FNV-1a 32-bit hash.
 *
 * Pure JS (no `node:crypto`) so the package runs in BOTH Node (vitest) and the
 * extension service worker. NOT cryptographically strong — adequate for stable
 * cache keys and claim ids inside one process, which is all that is asked of it.
 * It is not a security boundary.
 */

/**
 * FNV-1a (32-bit) over a string → unsigned 32-bit hex (8 chars, zero-padded).
 * Deterministic for the lifetime of a process and across processes for the same
 * input string.
 */
export function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 0x01000193  (keep as uint32 via Math.imul + >>>0)
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
