/**
 * SYNTHETIC-DATA RANDOMNESS ONLY.
 *
 * This file provides a tiny seeded PRNG (mulberry32 seeded by an xmur3 string hash) and
 * deterministic UUID derivation. It exists so the demo dataset is reproducible byte-for-byte in
 * the Worker, in Node and in tests. It is NOT cryptographically secure and MUST NEVER be used
 * for access codes, session tokens, secrets or anything security-relevant — production code
 * uses crypto.getRandomValues (see src/backend/services/crypto.ts). Demo access codes derived
 * from it are demo-only and are only ever loaded when the in-memory/demo store is in use.
 *
 * Pure: no Node APIs, no globals beyond Math/Number.
 */

/** xmur3 string hash → generator of 32-bit unsigned ints. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  /** Normal(mean, sd) via Box–Muller. */
  normal(mean?: number, sd?: number): number;
  /** Fisher–Yates copy. */
  shuffle<T>(items: readonly T[]): T[];
}

/** Deterministic RNG for a string seed (synthetic data only — see file header). */
export function createRng(seed: string): Rng {
  const seedGen = xmur3(seed);
  let a = seedGen();
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    chance: (p) => next() < p,
    normal: (mean = 0, sd = 1) => {
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = tmp;
      }
      return out;
    },
  };
  return rng;
}

const HEX = '0123456789abcdef';

/**
 * Deterministic, valid RFC 4122 v4-format UUID derived from (kind, key). Stable across runs and
 * independent of generation order, so adding rows elsewhere never changes existing ids.
 * Synthetic data only.
 */
export function demoUuid(kind: string, key: string): string {
  const gen = xmur3(`${kind}\u0000${key}`);
  const words = [gen(), gen(), gen(), gen()];
  let hex = '';
  for (const w of words) {
    for (let i = 7; i >= 0; i--) hex += HEX[(w >>> (i * 4)) & 0xf];
  }
  const variant = HEX[8 + (parseInt(hex[16] as string, 16) & 3)] as string;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
