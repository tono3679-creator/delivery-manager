"use client";
/**
 * 配送先の地図（Leaflet + OpenStreetMap）。
 * - Leaflet はブラウザ専用のため、表示するときに読み込む
 * - 吹き出しは DOM で組み立て、案件の文字（利用者の入力）を HTML として解釈しない
 * - 画面の再取得（リアルタイム更新）ではマーカーだけ差し替え、利用者が動かした表示位置は保つ。
 *   表示位置を合わせ直すのは fitKey（日付・絞り込み）が変わったときだけ
 * - ドライバーの現在地は案件とは別の層に、丸いトラックのマーカーで出す（表示範囲の計算には含めない）
 */
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap, Marker } from "leaflet";
import type { MapOrder } from "@/lib/data/map";
import { DRIVER_ACTIVITY_LABEL, minutesAgo, type DriverPosition } from "@/lib/domain/driver-position";
import { MAP_STATE_COLOR, MAP_STATE_LABEL, type MapState } from "@/lib/domain/map";
import { ORDER_STATUS_LABEL } from "@/lib/domain/status";
import { formatTime } from "@/lib/format";
import { mapTileAttribution, mapTileUrl } from "@/lib/map-config";
import { driverMarkerElement, driverSourceLabel } from "./driver-marker";
import { pinSvg } from "./pin";
import { cn } from "@/lib/utils";

type Leaflet = typeof import("leaflet");

/** 東京駅付近（案件が無いときの初期表示） */
const DEFAULT_CENTER: [number, number] = [35.6812, 139.7671];

function pinIcon(L: Leaflet, state: MapState, selected: boolean) {
  return L.divIcon({
    className: "dm-map-pin",
    html: pinSvg(state, selected ? "lg" : "md"),
    iconSize: selected ? [34, 45] : [26, 35],
    iconAnchor: selected ? [17, 44] : [13, 34],
    popupAnchor: [0, selected ? -40 : -30],
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 吹き出し：案件の概要（文字はすべて textContent で入れる） */
function popupContent(o: MapOrder, detailPath: string, onOpen: (href: string) => void): HTMLElement {
  const root = el("div", "dm-map-popup space-y-1.5 text-[13px] leading-snug");
  const head = el("div", "flex items-center gap-2");
  head.append(el("span", "font-semibold tabular", o.orderNo));
  const badge = el("span", "rounded-full px-1.5 py-px text-[11px] font-medium text-white", MAP_STATE_LABEL[o.state]);
  badge.style.background = MAP_STATE_COLOR[o.state];
  head.append(badge);
  // 区分と実際のステータスが違うとき（例：配送予定のうち「未割当」）だけ補足する
  if (ORDER_STATUS_LABEL[o.status] !== MAP_STATE_LABEL[o.state]) {
    head.append(el("span", "text-[11px] text-muted-foreground", ORDER_STATUS_LABEL[o.status]));
  }
  root.append(head);
  root.append(el("div", "font-medium", o.deliveryName));
  root.append(el("div", "text-muted-foreground", o.deliveryAddress));
  const time = o.completedAt
    ? `予定 ${formatTime(o.deliveryAt)}・完了 ${formatTime(o.completedAt)}${o.completedLate ? "（遅れて完了）" : ""}`
    : `集荷 ${formatTime(o.pickupAt)} → 配送予定 ${formatTime(o.deliveryAt)}`;
  root.append(el("div", "tabular", time));
  root.append(el("div", "text-muted-foreground", `${o.clientName}・${o.driverName ?? "未割当"}`));
  const link = el("a", "inline-block font-medium text-brand hover:underline", "案件の詳細を開く");
  link.href = `${detailPath}/${o.id}`;
  link.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onOpen(`${detailPath}/${o.id}`);
  });
  root.append(link);
  return root;
}

/** 吹き出し：ドライバーの現在地（名前・案件はすべて textContent で入れる） */
function driverPopupContent(d: DriverPosition, detailPath: string, onOpen: (href: string) => void): HTMLElement {
  const root = el("div", "dm-map-popup space-y-1.5 text-[13px] leading-snug");
  const head = el("div", "flex items-center gap-2");
  head.append(el("span", "font-semibold", d.driverName));
  head.append(el("span", "rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-foreground", driverSourceLabel(d)));
  root.append(head);
  root.append(el("div", "", DRIVER_ACTIVITY_LABEL[d.activity]));
  if (d.order) {
    const link = el("a", "block font-medium text-brand hover:underline", `${d.order.orderNo} ${d.order.deliveryName}`);
    link.href = `${detailPath}/${d.order.id}`;
    link.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      onOpen(`${detailPath}/${d.order!.id}`);
    });
    root.append(link);
  }
  if (d.source === "gps") {
    const ago = minutesAgo(d.updatedAt, new Date());
    root.append(el("div", "tabular text-muted-foreground", `最終更新 ${formatTime(d.updatedAt)}（${ago === 0 ? "1分以内" : `${ago}分前`}）${d.accuracyM !== null ? `・精度 約${d.accuracyM.toLocaleString("ja-JP")}m` : ""}`));
    if (d.stale) root.append(el("div", "font-medium text-warning-strong", "しばらく位置が更新されていません"));
  } else {
    root.append(el("div", "text-muted-foreground", "本日の予定から求めたデモ用の位置です"));
  }
  return root;
}

export function DeliveryMap({
  orders, fitKey, selectedId, onSelect, onOpen, className, label, detailPath = "/orders",
  drivers = [], selectedDriverId, onSelectDriver,
}: {
  orders: MapOrder[];
  /** 日付や絞り込みが変わったときだけ表示範囲を合わせ直す */
  fitKey: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onOpen: (href: string) => void;
  className?: string;
  label: string;
  /** 吹き出しの「詳細を開く」の行き先（管理者 /orders、ドライバー /driver/orders） */
  detailPath?: string;
  /** ドライバーの現在地（管理者の地図のみ） */
  drivers?: DriverPosition[];
  selectedDriverId?: string | null;
  onSelectDriver?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [L, setL] = useState<Leaflet | null>(null);
  const [failed, setFailed] = useState(false);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const driverLayer = useRef<LayerGroup | null>(null);
  const driverMarkers = useRef(new Map<string, Marker>());
  const markers = useRef(new Map<string, { marker: Marker; order: MapOrder }>());
  const fitted = useRef<string | null>(null);
  const callbacks = useRef({ onSelect, onOpen, onSelectDriver });
  const selected = useRef(selectedId ?? null);
  useEffect(() => {
    callbacks.current = { onSelect, onOpen, onSelectDriver };
  }, [onSelect, onOpen, onSelectDriver]);

  // Leaflet の読み込み（ブラウザのみ）
  useEffect(() => {
    let cancelled = false;
    import("leaflet")
      .then((mod) => {
        if (!cancelled) setL(("default" in mod ? mod.default : mod) as Leaflet);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // 地図の作成
  useEffect(() => {
    if (!L || !container.current) return;
    const placed = markers.current;
    const placedDrivers = driverMarkers.current;
    const m = L.map(container.current, { center: DEFAULT_CENTER, zoom: 11, scrollWheelZoom: false, zoomControl: true });
    L.tileLayer(mapTileUrl, { attribution: mapTileAttribution, maxZoom: 18 }).addTo(m);
    // 出典表示は地図データ（OpenStreetMap）を主にし、ライブラリ名は文字だけにする
    m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
    layer.current = L.layerGroup().addTo(m);
    driverLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    // 外枠の大きさが後から決まる（グリッド・タブ切替）ときに備えて
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
      layer.current = null;
      driverLayer.current = null;
      placed.clear();
      placedDrivers.clear();
      fitted.current = null;
    };
  }, [L]);

  // マーカーの差し替え
  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!L || !m || !group) return;
    group.clearLayers();
    markers.current.clear();
    const located = orders.filter((o) => o.lat !== null && o.lng !== null);
    // 吹き出しは地図の幅に収め、左上の拡大・縮小ボタンにも重ならないようにする（スマホの細い地図に合わせる）
    const width = container.current?.clientWidth ?? 320;
    const popupOptions = {
      maxWidth: Math.min(280, width - 100),
      minWidth: Math.min(220, width - 100),
      autoPanPaddingTopLeft: [52, 12] as [number, number],
      autoPanPaddingBottomRight: [12, 12] as [number, number],
    };
    for (const o of located) {
      const marker = L.marker([o.lat!, o.lng!], {
        icon: pinIcon(L, o.state, o.id === selected.current),
        title: `${o.orderNo} ${MAP_STATE_LABEL[o.state]} ${o.deliveryName}`,
        alt: `${o.orderNo} ${MAP_STATE_LABEL[o.state]}`,
        keyboard: true,
        riseOnHover: true,
        // 遅延・配送中を手前に
        zIndexOffset: o.id === selected.current ? 1000 : o.state === "late" ? 300 : o.state === "in_transit" ? 200 : o.state === "planned" ? 100 : 0,
      });
      marker.bindPopup(() => popupContent(o, detailPath, (href) => callbacks.current.onOpen(href)), popupOptions);
      marker.on("click", () => callbacks.current.onSelect?.(o.id));
      group.addLayer(marker);
      markers.current.set(o.id, { marker, order: o });
    }
    if (fitted.current !== fitKey) {
      fitted.current = fitKey;
      if (located.length > 0) {
        m.fitBounds(L.latLngBounds(located.map((o) => [o.lat!, o.lng!] as [number, number])), { padding: [36, 36], maxZoom: 14 });
      } else {
        m.setView(DEFAULT_CENTER, 11);
      }
    }
  }, [L, orders, fitKey, detailPath]);

  // ドライバーの現在地（定期的に取り直すたびに差し替える。開いている吹き出しは開き直す）
  useEffect(() => {
    const m = map.current;
    const group = driverLayer.current;
    if (!L || !m || !group) return;
    const openId = [...driverMarkers.current.entries()].find(([, mk]) => mk.isPopupOpen())?.[0] ?? null;
    group.clearLayers();
    driverMarkers.current.clear();
    const width = container.current?.clientWidth ?? 320;
    for (const d of drivers) {
      const icon = L.divIcon({
        className: "dm-map-driver",
        html: driverMarkerElement(d),
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -16],
      });
      const marker = L.marker([d.lat, d.lng], {
        icon,
        title: `${d.driverName}（${driverSourceLabel(d)}・${DRIVER_ACTIVITY_LABEL[d.activity]}）`,
        alt: `${d.driverName}の現在地`,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: 2000,
        opacity: d.stale ? 0.6 : 1,
      });
      marker.bindPopup(() => driverPopupContent(d, detailPath, (href) => callbacks.current.onOpen(href)), {
        maxWidth: Math.min(280, width - 100),
        minWidth: Math.min(200, width - 100),
        autoPanPaddingTopLeft: [52, 12],
        autoPanPaddingBottomRight: [12, 12],
      });
      marker.on("click", () => callbacks.current.onSelectDriver?.(d.driverId));
      group.addLayer(marker);
      driverMarkers.current.set(d.driverId, marker);
      if (d.driverId === openId) marker.openPopup();
    }
  }, [L, drivers, detailPath]);

  // 一覧で選んだドライバーへ移動して吹き出しを開く
  useEffect(() => {
    if (!L || !map.current || !selectedDriverId) return;
    const target = driverMarkers.current.get(selectedDriverId);
    if (!target) return;
    map.current.panTo(target.getLatLng(), { animate: true });
    target.openPopup();
    // drivers の更新では動かさない（選んだときだけ）
  }, [L, selectedDriverId]);

  // 一覧で選んだ案件を強調して吹き出しを開く（再取得のたびには開き直さない）
  useEffect(() => {
    const prev = selected.current;
    selected.current = selectedId ?? null;
    if (!L || !map.current) return;
    const before = prev ? markers.current.get(prev) : undefined;
    if (before) {
      before.marker.setIcon(pinIcon(L, before.order.state, false));
      before.marker.setZIndexOffset(0);
    }
    const target = selectedId ? markers.current.get(selectedId) : undefined;
    if (target) {
      target.marker.setIcon(pinIcon(L, target.order.state, true));
      target.marker.setZIndexOffset(1000);
      map.current.panTo(target.marker.getLatLng(), { animate: true });
      target.marker.openPopup();
    }
  }, [L, selectedId]);

  return (
    <div className={cn("relative isolate overflow-hidden rounded-lg border bg-muted", className)}>
      <div ref={container} className="absolute inset-0" role="region" aria-label={label} />
      {!L && !failed && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">地図を読み込んでいます…</div>}
      {failed && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">地図を読み込めませんでした。再読み込みしてください。</div>}
    </div>
  );
}
