export const EMPLOYMENT_TYPES = ["full_time", "contractor"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: "正社員",
  contractor: "業務委託",
};

export const DRIVER_STATUSES = ["active", "day_off", "leave", "retired"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];
export const DRIVER_STATUS_LABEL: Record<DriverStatus, string> = {
  active: "稼働中",
  day_off: "本日休み",
  leave: "休職中",
  retired: "退職",
};

export const VEHICLE_STATUSES = ["active", "maintenance", "standby", "retired"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export const VEHICLE_STATUS_LABEL: Record<VehicleStatus, string> = {
  active: "稼働中",
  maintenance: "整備中",
  standby: "予備",
  retired: "廃車",
};

export const EXPENSE_CATEGORIES = [
  "fuel",
  "toll",
  "labor",
  "outsourcing",
  "vehicle_maintenance",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  fuel: "燃料費",
  toll: "高速道路料金",
  labor: "人件費",
  outsourcing: "外注費",
  vehicle_maintenance: "車両維持費",
  other: "その他",
};

export type AppRole = "admin" | "driver";
