// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT (signatures) — Agent A fills implementations.
// ═══════════════════════════════════════════════════════════════

/**
 * Invert a square matrix using Gauss-Jordan elimination with partial pivoting.
 * Guards against near-singular matrices by returning the identity on failure.
 * @param matrix - d×d input matrix (not mutated)
 */
export function invertMatrix(matrix: number[][]): number[][] {
  throw new Error('Not implemented — Agent A');
}

/**
 * Multiply a matrix by a column vector: result[i] = Σ_j matrix[i][j] * vec[j]
 */
export function matrixVectorMultiply(matrix: number[][], vec: number[]): number[] {
  throw new Error('Not implemented — Agent A');
}

/**
 * Dot product of two equal-length vectors.
 */
export function dotProduct(v1: number[], v2: number[]): number {
  throw new Error('Not implemented — Agent A');
}

/**
 * Compute the variance bound xᵀ A⁻¹ x used in the UCB formula.
 * @param vec       - context vector x (length d)
 * @param matrixInv - A⁻¹ (d×d)
 */
export function calculateVariance(vec: number[], matrixInv: number[][]): number {
  throw new Error('Not implemented — Agent A');
}
