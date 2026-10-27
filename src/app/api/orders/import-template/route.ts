import { asAdmin } from "@/lib/auth";
import { toCsv } from "@/lib/csv/csv";
import { csvResponse } from "@/lib/csv/download";
import { ORDER_IMPORT_HEADER } from "@/lib/csv/orders";
import { addDays, todayJst } from "@/lib/date";

/**
 * 取り込み用のひな形（見出し＋記入例2行）。記入例には自社の荷主コード・ドライバー名を使い、そのまま取り込んでも通る値にする。
 */
export async function GET() {
  const { client, driver } = await asAdmin(async (tx) => {
    const [[client], [driver]] = await Promise.all([
      tx<{ code: string; address: string | null }[]>`select code, address from clients order by code limit 1`,
      tx<{ name: string }[]>`
        select d.name from drivers d
          join vehicle_assignments va on va.driver_id = d.id and va.end_on is null
          join vehicles v on v.id = va.vehicle_id and v.status = 'active'
         where d.status = 'active' order by d.code limit 1`,
    ]);
    return { client, driver };
  });
  const day = addDays(todayJst(), 1).replaceAll("-", "/");
  const body = toCsv(ORDER_IMPORT_HEADER, [
    [client?.code ?? "C001", "", "山田商店", "東京都江東区豊洲3-2-20", `${day} 09:00`, `${day} 10:30`, driver?.name ?? "", "", "段ボール", 3, 4500, "午前中必着"],
    [client?.code ?? "C001", client?.address ?? "", "株式会社サンプル 倉庫", "東京都大田区平和島6-1-1", `${day} 13:00`, `${day} 15:00`, "", "", "パレット", 1, 12000, ""],
  ]);
  return csvResponse(body, "配送案件_取り込みひな形.csv", "orders_import_template.csv");
}
