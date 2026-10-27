"use client";
/**
 * ドライバーの位置情報の共有。
 * - 本人が「共有を開始」したときだけ、ブラウザの位置情報を1分ごとに送る（アプリを開いている間だけ）
 * - 共有中は画面上部に「位置を共有中」を出し続ける（知らないうちに送られていることがないように）
 * - 共有中のまま画面を閉じても、次に開いたときに自動で再開する（止めるまで共有中）
 * 提供範囲はドライバー画面のレイアウト全体（ページを移っても送り続けるため）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Loader2, LocateFixed, LocateOff, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { reportLocation, stopLocationSharing } from "@/lib/actions/location";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 送る間隔 */
const SEND_INTERVAL_MS = 60_000;
const UNSUPPORTED = "この端末・ブラウザでは位置情報を使えません";

type SharingState =
  | { status: "off" }
  | { status: "starting" }
  | { status: "on"; sentAt: string | null; accuracy: number | null; warning: string | null }
  | { status: "error"; message: string };

type SharingContext = {
  state: SharingState;
  supported: boolean;
  start: () => void;
  stop: () => Promise<void>;
};

const Ctx = createContext<SharingContext | null>(null);

function geolocationSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "geolocation" in navigator;
}
const noSubscribe = () => () => {};

function positionErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "位置情報の利用が許可されていません。ブラウザの設定で、このサイトの位置情報を「許可」にしてください";
  }
  if (error.code === error.TIMEOUT) return "現在地の取得に時間がかかっています。電波の良い場所でお待ちください";
  return "現在地を取得できませんでした。電波の良い場所でお待ちください";
}

export function LocationSharingProvider({ initiallySharing, children }: { initiallySharing: boolean; children: React.ReactNode }) {
  // サーバーでの描画では使える前提にし、ブラウザで確かめる（表示の食い違いを起こさない）
  const supported = useSyncExternalStore(noSubscribe, geolocationSupported, () => true);
  const [state, setState] = useState<SharingState>(() => (initiallySharing ? { status: "starting" } : { status: "off" }));
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const active = useRef(false);
  const sending = useRef(false);

  const halt = useCallback(() => {
    active.current = false;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const send = useCallback(
    (pos: GeolocationPosition) => {
      if (!active.current || sending.current) return;
      sending.current = true;
      const { latitude, longitude, accuracy, heading, speed } = pos.coords;
      const finite = (v: number | null) => (v !== null && Number.isFinite(v) ? v : null);
      // 端末によっては範囲外の値が来るので、受け付ける範囲に収める（精度は上限で丸め、向き・速さは捨てる）
      const acc = finite(accuracy);
      const head = finite(heading);
      const spd = finite(speed);
      reportLocation({
        lat: latitude,
        lng: longitude,
        accuracy: acc === null ? null : Math.min(Math.max(acc, 0), 100_000),
        heading: head !== null && head >= 0 && head < 360 ? head : null,
        speed: spd !== null && spd >= 0 && spd <= 100 ? spd : null,
        recordedAt: new Date(pos.timestamp).toISOString(),
      })
        .then((result) => {
          if (!active.current) return;
          if (result.ok) {
            setState((prev) => ({
              status: "on",
              sentAt: result.savedAt ?? (prev.status === "on" ? prev.sentAt : null),
              accuracy: finite(accuracy) === null ? null : Math.round(accuracy),
              warning: null,
            }));
          } else {
            halt();
            setState({ status: "error", message: result.error });
          }
        })
        .catch(() => {
          // 通信が切れたときは止めずに次の回で送り直す
          if (active.current) setState((prev) => (prev.status === "on" ? { ...prev, warning: "通信できないため、送れていません" } : prev));
        })
        .finally(() => {
          sending.current = false;
        });
    },
    [halt],
  );

  const locate = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      send,
      (error) => {
        if (!active.current) return;
        if (error.code === error.PERMISSION_DENIED) {
          halt();
          setState({ status: "error", message: positionErrorMessage(error) });
          return;
        }
        setState((prev) =>
          prev.status === "on" ? { ...prev, warning: positionErrorMessage(error) } : { status: "on", sentAt: null, accuracy: null, warning: positionErrorMessage(error) },
        );
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
  }, [send, halt]);

  /** 1分ごとの送信を始める（状態は位置の取得・送信の結果で変わる） */
  const run = useCallback(() => {
    if (active.current || !geolocationSupported()) return;
    active.current = true;
    locate();
    timer.current = setInterval(locate, SEND_INTERVAL_MS);
  }, [locate]);

  const start = useCallback(() => {
    if (!geolocationSupported()) {
      setState({ status: "error", message: UNSUPPORTED });
      return;
    }
    setState({ status: "starting" });
    run();
  }, [run]);

  const stop = useCallback(async () => {
    halt();
    setState({ status: "off" });
    const result = await stopLocationSharing();
    if (!result.ok) setState({ status: "error", message: result.error });
  }, [halt]);

  // 共有中のまま閉じていたら、開いたときに再開する
  useEffect(() => {
    if (initiallySharing) run();
    return halt;
  }, [initiallySharing, run, halt]);

  // 共有中のまま閉じたあと、位置情報を使えない端末で開いた場合
  const value = useMemo(() => {
    const shown: SharingState = state.status === "starting" && !supported ? { status: "error", message: UNSUPPORTED } : state;
    return { state: shown, supported, start, stop };
  }, [state, supported, start, stop]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useLocationSharing(): SharingContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("LocationSharingProvider の中で使ってください");
  return ctx;
}

/** 画面上部の表示（共有中だけ） */
export function LocationSharingIndicator() {
  const { state } = useLocationSharing();
  if (state.status !== "on" && state.status !== "starting") return null;
  return (
    <Link
      href="/driver#location-sharing"
      aria-label="位置を共有中"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium whitespace-nowrap text-success-strong"
    >
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      {/* スマホの狭い見出しでは短く */}
      <span className="sm:hidden">共有中</span>
      <span className="hidden sm:inline">位置を共有中</span>
    </Link>
  );
}

/** ホームの「位置情報の共有」カード */
export function LocationSharingCard({ isDemo }: { isDemo: boolean }) {
  const { state, supported, start, stop } = useLocationSharing();
  const [stopping, setStopping] = useState(false);
  const on = state.status === "on" || state.status === "starting";

  return (
    <Card id="location-sharing" className="scroll-mt-20">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <MapPin className={cn("mt-0.5 size-5 shrink-0", on ? "text-success" : "text-muted-foreground")} aria-hidden />
            <div>
              <h2 className="font-semibold">位置情報の共有</h2>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {state.status === "starting" && "現在地を取得しています…"}
                {state.status === "on" &&
                  (state.sentAt
                    ? `共有中・最終送信 ${formatTime(state.sentAt)}${state.accuracy !== null ? `（精度 約${state.accuracy.toLocaleString("ja-JP")}m）` : ""}`
                    : "共有中")}
                {state.status === "off" && "オフ"}
                {state.status === "error" && "停止しています"}
              </p>
            </div>
          </div>
          {on ? (
            <Button
              variant="outline"
              onClick={async () => {
                setStopping(true);
                await stop();
                setStopping(false);
              }}
              disabled={stopping}
            >
              {stopping ? <Loader2 className="animate-spin" aria-hidden /> : <LocateOff aria-hidden />}
              共有を停止
            </Button>
          ) : (
            <Button variant="brand" onClick={start} disabled={!supported}>
              <LocateFixed aria-hidden />
              {state.status === "error" ? "もう一度試す" : "共有を開始"}
            </Button>
          )}
        </div>
        {state.status === "on" && state.warning && <p className="text-sm text-warning-strong" role="status">{state.warning}</p>}
        {state.status === "error" && <p className="text-sm text-danger-strong" role="alert">{state.message}</p>}
        {!supported && <p className="text-sm text-muted-foreground">この端末・ブラウザでは位置情報を使えません。</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">
          オンにすると、配車担当者の地図にあなたの現在地が表示されます。送るのは1分ごと、このアプリを開いている間だけです。保存するのは最新の位置だけで、停止すると消えます。
          {isDemo && "デモでは、送った位置はこのデモ環境の中だけで使い、デモの終了とともに削除されます。"}
        </p>
      </CardContent>
    </Card>
  );
}
