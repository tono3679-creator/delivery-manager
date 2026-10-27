import { adminApiGuard, asAdmin } from "@/lib/auth";
import { getDriverPositions } from "@/lib/data/driver-positions";

/** ドライバーの現在地（管理者の地図が定期的に取得する）。自社のドライバーだけ（RLS）。 */
export async function GET() {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const data = await asAdmin((tx) => getDriverPositions(tx));
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
