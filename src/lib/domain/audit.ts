/**
 * 操作履歴（audit_logs）の表示。
 * 記録は各操作のサーバー処理で書く（action・entity・detail の形は操作ごとに決まっている）。
 */
import { EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@/lib/domain/labels";

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: "登録",
  update: "更新",
  delete: "削除",
  import: "CSV 取り込み",
  export: "CSV 出力",
  dispatch: "配車",
  unassign: "割り当て解除",
  assign_vehicle: "担当車両を設定",
  unassign_vehicle: "担当車両を解除",
  issue: "請求書を発行",
  cancel: "請求を取り消し",
  share_start: "位置情報の共有を開始",
  share_stop: "位置情報の共有を停止",
};

export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  delivery_order: "配送案件",
  driver: "ドライバー",
  vehicle: "車両",
  client: "荷主",
  client_invoice: "請求",
  expense: "経費",
  company: "会社情報",
  office: "営業所",
  driver_location: "位置情報",
};

/** 操作履歴の絞り込み（画面のタブ）。値は URL の log パラメータ */
export const AUDIT_FILTERS = [
  { key: "", label: "すべて", entities: [] },
  { key: "orders", label: "配送案件・配車", entities: ["delivery_order"] },
  { key: "masters", label: "ドライバー・車両・荷主", entities: ["driver", "driver_location", "vehicle", "client"] },
  { key: "money", label: "請求・経費", entities: ["client_invoice", "expense"] },
  { key: "settings", label: "会社・営業所", entities: ["company", "office"] },
] as const satisfies readonly { key: string; label: string; entities: readonly string[] }[];
export type AuditFilterKey = (typeof AUDIT_FILTERS)[number]["key"];

export type AuditRow = {
  id: string;
  at: Date;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: Record<string, unknown> | null;
  /** detail の ID から引いた名前（ドライバー・荷主） */
  toDriverName: string | null;
  fromDriverName: string | null;
  clientName: string | null;
  /** 対象がまだ存在するか（削除済みならリンクしない） */
  targetExists: boolean;
};

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const yen = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `${v.toLocaleString("ja-JP")}円` : "");
const join = (...parts: string[]) => parts.filter(Boolean).join(" ");

/** 一覧に出す「何をしたか」の1行（対象の番号・名前と、変更の要点） */
export function describeAudit(r: AuditRow): string {
  const d = r.detail ?? {};
  switch (r.entity) {
    case "delivery_order":
      if (r.action === "import") return `${str(d.count)}件（${str(d.fileName)}）`;
      if (r.action === "export") return `${str(d.count)}件`;
      if (r.action === "dispatch") return join(str(d.orderNo), `→ ${r.toDriverName ?? "（削除されたドライバー）"}`, d.timeChanged ? "（時刻も変更）" : "");
      if (r.action === "unassign") return join(str(d.orderNo), r.fromDriverName ? `（${r.fromDriverName}）` : "");
      return str(d.orderNo);
    case "driver":
    case "client":
      return join(str(d.code), str(d.name));
    case "vehicle":
      if (r.action === "assign_vehicle") return join(str(d.plate), `→ ${str(d.driverName)}`);
      return join(str(d.code), str(d.plate));
    case "client_invoice":
      return join(str(d.invoiceNo), r.clientName ?? "", yen(d.amount));
    case "expense": {
      const category = str(d.category);
      const label = EXPENSE_CATEGORY_LABEL[category as ExpenseCategory] ?? category;
      return join(str(d.spentOn), label, yen(d.amount));
    }
    case "company":
      return d.from ? `「${str(d.from)}」→「${str(d.to)}」` : str(d.to);
    case "office":
      return str(d.name);
    case "driver_location":
      return str(d.driverName);
    default:
      return "";
  }
}

/** 対象の画面へのリンク（削除済み・リンク先のない対象は null） */
export function auditHref(r: AuditRow): string | null {
  if (!r.targetExists || !r.entityId) return null;
  switch (r.entity) {
    case "delivery_order":
      return `/orders/${r.entityId}`;
    case "driver":
    case "driver_location":
      return `/drivers/${r.entityId}`;
    case "vehicle":
      return `/vehicles/${r.entityId}`;
    case "client":
      return `/clients/${r.entityId}`;
    case "client_invoice": {
      const clientId = r.detail?.clientId;
      return typeof clientId === "string" ? `/clients/${clientId}` : null;
    }
    default:
      return null;
  }
}
