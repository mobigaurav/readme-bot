/**
 * Tiny unified-diff formatter — just enough to render a friendly README
 * suggestion in a PR comment. We deliberately avoid pulling in `diff`
 * to keep the bundled action small.
 *
 * Algorithm: Myers-like LCS via dynamic programming on lines, then walk
 * back to emit `+`/`-`/` ` lines. Suitable for typical README sizes
 * (< 2 000 lines); we cap inputs so worst-case memory stays bounded.
 */

const MAX_LINES = 2000;

export function unifiedDiff(
  oldText: string,
  newText: string,
  oldLabel: string,
  newLabel: string,
): string {
  const a = clip(oldText.split('\n'));
  const b = clip(newText.split('\n'));
  const lcs = buildLcs(a, b);
  const ops = walkOps(a, b, lcs);
  const hunks = groupHunks(ops, 3);
  if (hunks.length === 0) return '';

  const out: string[] = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLen} +${h.newStart},${h.newLen} @@`);
    for (const line of h.lines) out.push(line);
  }
  return out.join('\n');
}

function clip(lines: string[]): string[] {
  return lines.length > MAX_LINES ? lines.slice(0, MAX_LINES) : lines;
}

interface Op {
  kind: ' ' | '+' | '-';
  text: string;
  oldIdx: number; // 1-based, 0 if not applicable
  newIdx: number;
}

function buildLcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({length: m + 1}, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }
  return dp;
}

function walkOps(a: string[], b: string[], dp: number[][]): Op[] {
  const ops: Op[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({kind: ' ', text: a[i - 1]!, oldIdx: i, newIdx: j});
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({kind: '+', text: b[j - 1]!, oldIdx: 0, newIdx: j});
      j--;
    } else {
      ops.push({kind: '-', text: a[i - 1]!, oldIdx: i, newIdx: 0});
      i--;
    }
  }
  return ops.reverse();
}

interface Hunk {
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
  lines: string[];
}

function groupHunks(ops: Op[], context: number): Hunk[] {
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < ops.length) {
    // Find the next change.
    while (i < ops.length && ops[i]!.kind === ' ') i++;
    if (i >= ops.length) break;

    // Walk back `context` lines of context.
    const start = Math.max(0, i - context);

    // Walk forward through changes, allowing up to `2*context` consecutive
    // unchanged lines before we close the hunk.
    let end = i;
    let runOfEqual = 0;
    while (end < ops.length) {
      if (ops[end]!.kind === ' ') {
        runOfEqual++;
        if (runOfEqual > context * 2) {
          end -= runOfEqual - context;
          break;
        }
      } else {
        runOfEqual = 0;
      }
      end++;
    }
    end = Math.min(end, ops.length);

    const slice = ops.slice(start, end);
    const oldStart = firstIdx(slice, 'old') ?? 1;
    const newStart = firstIdx(slice, 'new') ?? 1;
    const oldLen = slice.filter(o => o.kind !== '+').length;
    const newLen = slice.filter(o => o.kind !== '-').length;
    hunks.push({
      oldStart,
      oldLen,
      newStart,
      newLen,
      lines: slice.map(o => `${o.kind}${o.text}`),
    });
    i = end;
  }
  return hunks;
}

function firstIdx(slice: Op[], which: 'old' | 'new'): number | null {
  for (const o of slice) {
    if (which === 'old' && o.oldIdx > 0) return o.oldIdx;
    if (which === 'new' && o.newIdx > 0) return o.newIdx;
  }
  return null;
}
