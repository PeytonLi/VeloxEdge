import { LinUCBEngine } from "./index";
import { calculateVariance, invertMatrix } from "./linalg";

function expectMatrixCloseTo(actual: number[][], expected: number[][], precision = 8): void {
  expect(actual).toHaveLength(expected.length);

  for (let row = 0; row < expected.length; row++) {
    expect(actual[row]).toHaveLength(expected[row].length);

    for (let column = 0; column < expected[row].length; column++) {
      expect(actual[row][column]).toBeCloseTo(expected[row][column], precision);
    }
  }
}

describe("linear algebra helpers", () => {
  it("inverts a known 2x2 matrix", () => {
    const inverse = invertMatrix([
      [4, 7],
      [2, 6],
    ]);

    expectMatrixCloseTo(inverse, [
      [0.6, -0.7],
      [-0.2, 0.4],
    ]);
  });

  it("inverts a known 3x3 matrix", () => {
    const inverse = invertMatrix([
      [1, 2, 3],
      [0, 1, 4],
      [5, 6, 0],
    ]);

    expectMatrixCloseTo(inverse, [
      [-24, 18, 5],
      [20, -15, -4],
      [-5, 4, 1],
    ]);
  });

  it("falls back to identity for singular matrices", () => {
    const inverse = invertMatrix([
      [1, 2],
      [2, 4],
    ]);

    expectMatrixCloseTo(inverse, [
      [1, 0],
      [0, 1],
    ]);
  });
});

describe("LinUCBEngine", () => {
  it("initializes each arm with non-singular identity covariance", () => {
    const engine = new LinUCBEngine({
      dimensions: 3,
      alpha: 0.4,
      actions: ["TOOL_CONTEXT", "EDGEKV_MEMORY"],
    });

    const snapshot = engine.snapshot();

    expect(snapshot.aInvDiag.TOOL_CONTEXT).toEqual([1, 1, 1]);
    expect(snapshot.aInvDiag.EDGEKV_MEMORY).toEqual([1, 1, 1]);
    expect(snapshot.thetaHat.TOOL_CONTEXT).toEqual([0, 0, 0]);
    expect(snapshot.thetaHat.EDGEKV_MEMORY).toEqual([0, 0, 0]);
  });

  it("selects the higher-reward arm after closed-form updates", () => {
    const engine = new LinUCBEngine({
      dimensions: 2,
      alpha: 0.01,
      actions: ["NO_OP", "PREFETCH_TOOL_CONTEXT"],
    });
    const context = [1, 0];

    for (let i = 0; i < 12; i++) {
      engine.updateWeights("NO_OP", context, 0);
      engine.updateWeights("PREFETCH_TOOL_CONTEXT", context, 1);
    }

    const prediction = engine.predictNextAction(context);
    const noOp = prediction.ucbBreakdown.find((entry) => entry.action === "NO_OP");
    const prefetch = prediction.ucbBreakdown.find(
      (entry) => entry.action === "PREFETCH_TOOL_CONTEXT",
    );

    expect(prediction.action).toBe("PREFETCH_TOOL_CONTEXT");
    expect(prefetch?.expectedReward).toBeGreaterThan(noOp?.expectedReward ?? 0);
  });

  it("reduces variance for a visited context after an update", () => {
    const engine = new LinUCBEngine({
      dimensions: 3,
      alpha: 0.4,
      actions: ["EDGEKV_MEMORY"],
    });
    const context = [1, 0, 0];

    const before = calculateVariance(context, [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);

    engine.updateWeights("EDGEKV_MEMORY", context, 1);

    const after = engine.snapshot().aInvDiag.EDGEKV_MEMORY[0];
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(0.5, 8);
  });

  it("predicts under the 1.8ms budget at d=12", () => {
    const actions = ["TOOL_CONTEXT", "EDGEKV_MEMORY", "VECTOR_WEIGHTS", "NO_OP"];
    const engine = new LinUCBEngine({
      dimensions: 12,
      alpha: 0.35,
      actions,
    });
    const context = Array.from({ length: 12 }, (_, index) => (index % 3 === 0 ? 1 : 0.25));

    for (let i = 0; i < 32; i++) {
      engine.updateWeights(actions[i % actions.length], context, i % 2 === 0 ? 1 : 0.25);
    }

    for (let i = 0; i < 25; i++) {
      engine.predictNextAction(context);
    }

    const iterations = 100;
    const start = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
      engine.predictNextAction(context);
    }

    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const averageMs = elapsedMs / iterations;

    expect(averageMs).toBeLessThan(1.8);
  });
});
