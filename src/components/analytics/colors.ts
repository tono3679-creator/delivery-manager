/**
 * グラフの色（検証済みの順番：1 ブルー / 2 オレンジ / 3 アクア）。
 * 1系列のグラフは常にブルー。アクアは白地とのコントラストが 3:1 未満なので、凡例の文字か表を必ず併用する。
 */
export const SERIES_COLORS = { revenue: "#2a78d6", expense: "#eb6834", profit: "#1baf7a" } as const;
