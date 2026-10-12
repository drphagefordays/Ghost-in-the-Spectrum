import { NormalizationMode } from '../types/sec';

/**
 * Computes Pearson correlation coefficient between two numeric vectors.
 * Handles zeroes, constant values, and NaN gracefully without crashing.
 */
export function calculatePearsonR(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i] || 0;
    sumY += y[i] || 0;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let varX = 0;
  let varY = 0;

  for (let i = 0; i < n; i++) {
    const dx = (x[i] || 0) - meanX;
    const dy = (y[i] || 0) - meanY;
    numerator += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denominator = Math.sqrt(varX * varY);
  if (denominator <= 1e-12 || isNaN(denominator)) return 0;

  const r = numerator / denominator;
  return Math.max(-1, Math.min(1, r));
}

/**
 * Computes Cosine Similarity / Normalized Dot Product between two vectors.
 */
export function calculateCosineSimilarity(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;

  let dot = 0;
  let normX = 0;
  let normY = 0;

  for (let i = 0; i < n; i++) {
    const xi = x[i] || 0;
    const yi = y[i] || 0;
    dot += xi * yi;
    normX += xi * xi;
    normY += yi * yi;
  }

  const denom = Math.sqrt(normX) * Math.sqrt(normY);
  if (denom <= 1e-12) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

/**
 * Finds the apex (maximum) fraction index and intensity for a profile.
 * fractions are 1-based (e.g. Fraction 1 to 70).
 */
export function findApex(values: number[], fractions: number[]): { apexFraction: number; apexIntensity: number; totalArea: number } {
  let maxVal = -Infinity;
  let apexIdx = 0;
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    const val = values[i] || 0;
    sum += val;
    if (val > maxVal) {
      maxVal = val;
      apexIdx = i;
    }
  }

  const apexFraction = fractions[apexIdx] !== undefined ? fractions[apexIdx] : apexIdx + 1;
  const apexIntensity = maxVal > -Infinity && maxVal > 0 ? maxVal : 0;

  return {
    apexFraction,
    apexIntensity,
    totalArea: sum
  };
}

/**
 * Normalizes an array of profile intensities based on the selected mode.
 */
export function normalizeProfile(values: number[], mode: NormalizationMode): number[] {
  if (mode === 'raw') return values;

  if (mode === 'peak') {
    const max = Math.max(...values, 0);
    if (max <= 1e-12) return values.map(() => 0);
    return values.map(v => (v || 0) / max);
  }

  if (mode === 'area') {
    const sum = values.reduce((acc, v) => acc + (v || 0), 0);
    if (sum <= 1e-12) return values.map(() => 0);
    return values.map(v => ((v || 0) / sum) * 100); // Expressed as percentage
  }

  return values;
}
