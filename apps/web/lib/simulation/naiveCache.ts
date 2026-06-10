// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT — Agent B fills implementation.
// ═══════════════════════════════════════════════════════════════

/**
 * String-identity baseline cache that nearly always misses in agentic workflows
 * because every prompt has dynamic variance (timestamps, JSON args, etc.).
 *
 * Used only for the Section A comparison baseline — NOT part of the bandit logic.
 */
export class NaiveStringCache {
  private readonly store = new Map<string, string>();

  /**
   * Look up a pre-computed action for an exact cache key.
   * Returns null on any mismatch (representing a cold fetch).
   */
  public get(key: string): string | null {
    throw new Error('Not implemented — Agent B');
  }

  /** Store a key→action mapping. */
  public set(key: string, action: string): void {
    throw new Error('Not implemented — Agent B');
  }

  public get size(): number {
    return this.store.size;
  }

  public clear(): void {
    this.store.clear();
  }
}
