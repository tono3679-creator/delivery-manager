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
};
