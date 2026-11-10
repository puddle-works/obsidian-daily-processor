// Vendored from puddle-works/puddle-tooling fingerprint/fingerprint.ts at
// 23e7e0b0aef150e6acde783906ca0ee177a554ce (MIT), so the trust audit can see
// every dependency: there is no npm or JSR package for it.
/**
 * Freshness marker for puddles: hash the inputs `prepare` saw, and re-check
 * the hash in `run`, so a gap between the two (e.g. a manual approval) cannot
 * silently build output from stale input.
 *
 * @module
 */

/**
 * Hash the given parts into `sha256:<hex>`. Each part is length-prefixed, so
 * `["ab", "c"]` and `["a", "bc"]` give different fingerprints.
 */
export async function fingerprint(...parts: string[]): Promise<string> {
  const enc = new TextEncoder();
  const chunks = parts.map((p) => {
    const bytes = enc.encode(p);
    return `${bytes.length}:${p}`;
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(chunks.join("")),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

/** Throw when `actual` differs from the fingerprint `prepare` stored. */
export function assertFresh(
  expected: string,
  actual: string,
  what: string,
): void {
  if (expected !== actual) {
    throw new Error(
      `${what} changed since prepare (expected ${expected}, now ${actual}); nothing was written. Run the workflow again.`,
    );
  }
}
