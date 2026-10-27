/** データ整合性のチェック項目。各 SQL は違反件数（n）を返す。 */
export const INTEGRITY_CHECKS: { label: string; sql: string }[] = [
  {
    label: "案件のドライバーが同じ会社に存在する",
    sql: `select count(*) n from delivery_orders o left join drivers d on d.id = o.driver_id
          where o.driver_id is not null and (d.id is null or d.company_id <> o.company_id)`,
  },
  {
    label: "案件の荷主が同じ会社に存在する",
    sql: `select count(*) n from delivery_orders o left join clients c on c.id = o.client_id
          where c.id is null or c.company_id <> o.company_id`,
  },
  {
    label: "案件の車両が同じ会社に存在する",
    sql: `select count(*) n from delivery_orders o left join vehicles v on v.id = o.vehicle_id
          where o.vehicle_id is not null and (v.id is null or v.company_id <> o.company_id)`,
  },
  {
    label: "配送完了の案件だけに完了日時がある",
    sql: `select count(*) n from delivery_orders where (status = 'delivered') <> (completed_at is not null)`,
  },
  {
    label: "未割当の案件にはドライバーが無く、配車済以降にはある",
    sql: `select count(*) n from delivery_orders
          where (status = 'unassigned' and driver_id is not null)
             or (status in ('assigned','picked_up','in_transit','delivered','failed') and driver_id is null)`,
  },
  {
    label: "受注日時 ≦ 集荷予定 ≦ 配送予定",
    sql: `select count(*) n from delivery_orders where created_at > pickup_at or pickup_at > delivery_at`,
  },
  {
    label: "完了日時は集荷予定より後で、現在より前",
    sql: `select count(*) n from delivery_orders
          where completed_at is not null and (completed_at < pickup_at or completed_at > now())`,
  },
  {
    label: "最後のステータス履歴が現在のステータスと一致する",
    sql: `select count(*) n from delivery_orders o
          join lateral (select to_status from delivery_status_logs l where l.order_id = o.id
                        order by created_at desc, id desc limit 1) last on true
          where last.to_status <> o.status`,
  },
  {
    label: "すべての案件にステータス履歴がある",
    sql: `select count(*) n from delivery_orders o
          where not exists (select 1 from delivery_status_logs l where l.order_id = o.id)`,
  },
  {
    label: "ステータス履歴がつながっている（前の変更後＝次の変更前）",
    sql: `select count(*) n from (
            select from_status, lag(to_status) over (partition by order_id order by created_at, id) prev
              from delivery_status_logs) t
          where t.prev is distinct from t.from_status`,
  },
  {
    label: "ステータス履歴の遷移が業務ルールに沿っている",
    sql: `select count(*) n from delivery_status_logs
          where (from_status is null and to_status <> 'unassigned')
             or (from_status is not null and not can_transition(from_status, to_status))`,
  },
  {
    label: "配送完了の履歴時刻が完了日時と一致する",
    sql: `select count(*) n from delivery_orders o
          join delivery_status_logs l on l.order_id = o.id and l.to_status = 'delivered'
          where l.created_at <> o.completed_at`,
  },
  {
    label: "未来の日時の履歴が無い",
    sql: `select count(*) n from delivery_status_logs where created_at > now()`,
  },
  {
    label: "経費の日付が未来でない",
    sql: `select count(*) n from expenses where spent_on > app.today_jst()`,
  },
  {
    label: "現在の車両担当は1台につき1名",
    sql: `select count(*) n from (select vehicle_id from vehicle_assignments where end_on is null
          group by vehicle_id having count(*) > 1) t`,
  },
];
