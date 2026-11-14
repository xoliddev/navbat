/** Half-open interval [start, end) in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Sorts and merges touching/overlapping intervals. */
export function normalize(list: readonly Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ start: cur.start, end: cur.end });
  }
  return out;
}

/** `base` minus every interval in `cut`. Inputs may be unsorted; output is sorted. */
export function subtract(base: readonly Interval[], cut: readonly Interval[]): Interval[] {
  const cuts = normalize(cut);
  const out: Interval[] = [];
  for (const b of normalize(base)) {
    let pieces: Interval[] = [b];
    for (const c of cuts) {
      if (c.end <= b.start || c.start >= b.end) continue;
      const next: Interval[] = [];
      for (const p of pieces) {
        if (!overlaps(p, c)) {
          next.push(p);
          continue;
        }
        if (c.start > p.start) next.push({ start: p.start, end: c.start });
        if (c.end < p.end) next.push({ start: c.end, end: p.end });
      }
      pieces = next;
    }
    out.push(...pieces);
  }
  return out;
}

export function anyOverlap(target: Interval, list: readonly Interval[]): boolean {
  return list.some((i) => overlaps(target, i));
}

export function totalLength(list: readonly Interval[]): number {
  return normalize(list).reduce((sum, i) => sum + (i.end - i.start), 0);
}

/** Clips every interval to `window`, dropping the ones outside it. */
export function clip(list: readonly Interval[], window: Interval): Interval[] {
  return list
    .map((i) => ({ start: Math.max(i.start, window.start), end: Math.min(i.end, window.end) }))
    .filter((i) => i.end > i.start);
}
