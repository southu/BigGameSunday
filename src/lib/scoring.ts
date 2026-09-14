export const LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** +1 per hit, +5 per completed line (blackout = 49). */
export function scoreBoard(hitFlags: boolean[]) {
  const hits = hitFlags.filter(Boolean).length;
  const lines = LINES.filter((l) => l.every((i) => hitFlags[i])).length;
  return { hits, lines, gridScore: hits + lines * 5 };
}
