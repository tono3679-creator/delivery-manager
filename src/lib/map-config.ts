/**
 * 地図タイルの設定（ブラウザに公開してよい値だけ）。
 * 既定は OpenStreetMap の公開タイル。デモや少量の利用向けで、利用規約により大量アクセスは禁止されている。
 * 本番で利用者が増える場合は、契約したタイル配信サービスの URL を環境変数で指定する。
 * https://operations.osmfoundation.org/policies/tiles/
 */
export const mapTileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const mapTileAttribution =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
