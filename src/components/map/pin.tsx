import { MAP_STATE_COLOR, type MapState } from "@/lib/domain/map";

/** マーカーの中の記号（色だけで区別しないため）。固定の文字列だけで組み立てる */
const GLYPH: Record<MapState, string> = {
  planned: '<circle cx="12" cy="11.5" r="2.6" fill="COLOR"/>',
  in_transit: '<path d="M8 11.5h7.5M12.5 8.5l3 3-3 3" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  late: '<path d="M12 7.6v4.6" stroke="COLOR" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="15" r="1.3" fill="COLOR"/>',
  delivered: '<path d="M8.4 11.7l2.4 2.4 4.8-5" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  failed: '<path d="M9.4 8.9l5.2 5.2M14.6 8.9l-5.2 5.2" stroke="COLOR" stroke-width="2" stroke-linecap="round"/>',
};

export function pinSvg(state: MapState, size: "sm" | "md" | "lg" = "md"): string {
  const color = MAP_STATE_COLOR[state];
  const [w, h] = size === "lg" ? [34, 45] : size === "md" ? [26, 35] : [15, 20];
  return `<svg width="${w}" height="${h}" viewBox="0 0 24 32" aria-hidden="true" focusable="false">
    <path d="M12 .8C5.8.8.8 5.7.8 11.8c0 8.3 11.2 19.4 11.2 19.4s11.2-11.1 11.2-19.4C23.2 5.7 18.2.8 12 .8z" fill="${color}" stroke="#fff" stroke-width="1.6"/>
    <circle cx="12" cy="11.5" r="6.6" fill="#fff"/>
    ${GLYPH[state].replaceAll("COLOR", color)}
  </svg>`;
}

/** 凡例・一覧用の小さなマーカー */
export function PinGlyph({ state, className }: { state: MapState; className?: string }) {
  // 固定の SVG 文字列のみ（利用者の入力は含まない）
  return <span className={className} dangerouslySetInnerHTML={{ __html: pinSvg(state, "sm") }} />;
}
