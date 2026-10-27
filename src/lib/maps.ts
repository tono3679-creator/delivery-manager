/**
 * 地図アプリへのリンク（Google マップの公開 URL 形式。API キー不要、スマホでは地図アプリが開く）
 * https://developers.google.com/maps/documentation/urls/get-started
 */
export function mapSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

/** 電話番号のリンク（数字と + 以外を除く） */
export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
