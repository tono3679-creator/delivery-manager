/** 配車の重複判定 */

export type TimeWindow = { id: string; start: Date; end: Date };

/** 2つの時間帯が重なっているか（端が接しているだけなら重ならない） */
export function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/** target と重なる予定を返す（自分自身は除く） */
export function findOverlaps<T extends TimeWindow>(target: TimeWindow, others: T[]): T[] {
  return others.filter((o) => o.id !== target.id && overlaps(target, o));
}

/** 同じドライバーの予定の中で、他と重なっているものの ID */
export function overlappingIds(windows: TimeWindow[]): Set<string> {
  const sorted = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const ids = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
      ids.add(sorted[i].id);
      ids.add(sorted[j].id);
    }
  }
  return ids;
}
