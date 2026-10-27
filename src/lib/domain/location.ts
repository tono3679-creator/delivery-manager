import { AREAS } from "@/lib/demo/master-data";

/**
 * 住所からおおよその位置を求める（デモ用）。
 * 市区町村名が登録エリアに一致すれば、その中心付近の座標を返す。
 * 本番で正確な位置が必要な場合は、ジオコーディング API に置き換える。
 */
export function approximateLocation(address: string): { lat: number; lng: number } | null {
  const hit = [...AREAS]
    .sort((a, b) => b.city.length - a.city.length)
    .find((a) => address.includes(a.city));
  if (!hit) return null;
  // 同じ住所なら同じ位置になるよう、文字列から決まる小さなずれを足す
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) | 0;
  const dx = ((h & 0xff) / 255 - 0.5) * 0.02;
  const dy = (((h >> 8) & 0xff) / 255 - 0.5) * 0.02;
  return { lat: Number((hit.lat + dy).toFixed(6)), lng: Number((hit.lng + dx).toFixed(6)) };
}
