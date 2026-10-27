/** 検索条件を保ったまま一部だけ変えた URL を作る */
export function withParams(
  path: string,
  current: Record<string, string | number | undefined | null>,
  changes: Record<string, string | number | undefined | null>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...changes })) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
