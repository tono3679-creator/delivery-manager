import "server-only";

/** サーバー専用の環境変数。足りなければ起動時に分かるようにする。 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} が設定されていません（.env.example を参照）`);
  return value;
}

export const serverEnv = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  /** 同時に存在できるデモ会社の上限（1社あたり約 12MB。データベースの容量に合わせて調整する） */
  get demoMaxActive() {
    const n = Number(process.env.DEMO_MAX_ACTIVE);
    return Number.isInteger(n) && n > 0 ? n : 30;
  },
  /**
   * 同じ接続元から1時間に作れるデモ環境の数（大量作成の対策）。
   * 既定は 30（以前使っていた Supabase Auth の匿名ログインの既定の上限と同じ）。E2E テストでは大きくする
   */
  get demoCreateLimitPerHour() {
    const n = Number(process.env.DEMO_CREATE_LIMIT_PER_HOUR);
    return Number.isInteger(n) && n > 0 ? n : 30;
  },
};
