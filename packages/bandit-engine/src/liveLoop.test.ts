import { deriveAssetKey, rewardFromLatency } from "./liveLoop";

describe("deriveAssetKey", () => {
  it("derives deterministic, URL-safe keys with normalized action labels", () => {
    const context = [0.125, -0, 1.75, -2.5];

    const key = deriveAssetKey(context, "  Tool Context!! ");

    expect(key).toBe(deriveAssetKey(context, "tool-context"));
    expect(key).toMatch(/^asset\/v1\/tool-context\/d4\/[a-f0-9]{32}$/);
  });

  it("keeps nearby context vectors distinguishable", () => {
    const keys = new Set(
      Array.from({ length: 128 }, (_, index) =>
        deriveAssetKey([0.1 + index * 0.0001, 0.2, 0.3], "EDGEKV_MEMORY"),
      ),
    );

    expect(keys.size).toBe(128);
  });

  it("distributes keys across actions and dimensions", () => {
    const keys = new Set<string>();

    for (const action of ["TOOL_CONTEXT", "EDGEKV_MEMORY", "VECTOR_WEIGHTS", "NO_OP"]) {
      for (let index = 0; index < 64; index++) {
        keys.add(
          deriveAssetKey(
            [Math.sin(index), Math.cos(index / 3), index / 64, action.length],
            action,
          ),
        );
      }
    }

    expect(keys.size).toBe(256);
  });

  it("rejects invalid vectors and action labels", () => {
    expect(() => deriveAssetKey([], "TOOL_CONTEXT")).toThrow("non-empty");
    expect(() => deriveAssetKey([1, Number.NaN], "TOOL_CONTEXT")).toThrow(
      "finite",
    );
    expect(() => deriveAssetKey([1, 2], "***")).toThrow("non-empty");
  });
});

describe("rewardFromLatency", () => {
  it("maps measured hit/miss latency onto a normalized reward", () => {
    expect(rewardFromLatency(5, 5, 105)).toBe(1);
    expect(rewardFromLatency(105, 5, 105)).toBe(0);
    expect(rewardFromLatency(55, 5, 105)).toBeCloseTo(0.5, 12);
  });

  it("is monotone as measured latency improves", () => {
    const rewards = [105, 80, 55, 20, 5].map((latency) =>
      rewardFromLatency(latency, 5, 105),
    );

    expect(rewards).toEqual([...rewards].sort((left, right) => left - right));
  });

  it("clamps impossible measurements and invalid bounds conservatively", () => {
    expect(rewardFromLatency(-20, 5, 105)).toBe(1);
    expect(rewardFromLatency(250, 5, 105)).toBe(0);
    expect(rewardFromLatency(Number.NaN, 5, 105)).toBe(0);
    expect(rewardFromLatency(5, 10, 10)).toBe(0);
    expect(rewardFromLatency(5, 20, 10)).toBe(0);
  });
});
