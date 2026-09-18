// LCS line diff, client-side, zero deps. Runs are short texts: O(n*m) DP
// is fine at the sizes a graph output can reach (thousands of lines would
// only slow the compare view, never the runner).
export type DiffRow = { type: "same" | "add" | "del"; text: string };

export function diffLines(a: string, b: string): DiffRow[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length, m = B.length;
  // dp[i][j] = LCS length of A[i..] and B[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffRow[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ type: "same", text: A[i++] }); j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: "del", text: A[i++] });
    else out.push({ type: "add", text: B[j++] });
  }
  while (i < n) out.push({ type: "del", text: A[i++] });
  while (j < m) out.push({ type: "add", text: B[j++] });
  return out;
}
