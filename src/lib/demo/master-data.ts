/**
 * デモ用のマスターデータ。会社・人物・荷主はすべて架空。
 * 住所は実在の市区町村名に架空の番地を付けたもので、座標は市区町村の中心付近をずらしたダミー。
 */

export const DEMO_COMPANY_NAME = "株式会社ミナトエクスプレス（デモ）";

export const OFFICES = [
  { key: "honsha", name: "本社営業所", address: "東京都大田区平和島4-2-11", lat: 35.5859, lng: 139.7487 },
  { key: "kawasaki", name: "川崎営業所", address: "神奈川県川崎市川崎区浮島町8-5", lat: 35.5196, lng: 139.7716 },
] as const;

export type OfficeKey = (typeof OFFICES)[number]["key"];

export const ADMIN_STAFF = ["配車担当 佐々木", "事務 森下", "代表 高橋"] as const;

export type DriverSeed = {
  name: string;
  kana: string;
  employment: "full_time" | "contractor";
  office: OfficeKey;
  /** 仕事量の多さ（1.0 が標準） */
  capacity: number;
  /** 遅延しやすさ */
  delayRate: number;
  yearsAgo: number;
  status?: "leave";
};

export const DRIVERS: DriverSeed[] = [
  { name: "山田 太郎", kana: "ヤマダ タロウ", employment: "full_time", office: "honsha", capacity: 1.35, delayRate: 0.02, yearsAgo: 9 },
  { name: "佐藤 一郎", kana: "サトウ イチロウ", employment: "full_time", office: "honsha", capacity: 1.25, delayRate: 0.03, yearsAgo: 7 },
  { name: "鈴木 健二", kana: "スズキ ケンジ", employment: "full_time", office: "honsha", capacity: 1.2, delayRate: 0.03, yearsAgo: 6 },
  { name: "田中 誠", kana: "タナカ マコト", employment: "full_time", office: "honsha", capacity: 1.1, delayRate: 0.04, yearsAgo: 5 },
  { name: "伊藤 翔太", kana: "イトウ ショウタ", employment: "full_time", office: "honsha", capacity: 1.05, delayRate: 0.05, yearsAgo: 3 },
  { name: "渡辺 大輔", kana: "ワタナベ ダイスケ", employment: "full_time", office: "kawasaki", capacity: 1.15, delayRate: 0.03, yearsAgo: 6 },
  { name: "中村 拓也", kana: "ナカムラ タクヤ", employment: "full_time", office: "kawasaki", capacity: 1.0, delayRate: 0.05, yearsAgo: 2 },
  { name: "小林 美咲", kana: "コバヤシ ミサキ", employment: "full_time", office: "kawasaki", capacity: 0.95, delayRate: 0.02, yearsAgo: 4 },
  { name: "加藤 隆", kana: "カトウ タカシ", employment: "full_time", office: "honsha", capacity: 0.9, delayRate: 0.06, yearsAgo: 1 },
  { name: "吉田 浩二", kana: "ヨシダ コウジ", employment: "full_time", office: "kawasaki", capacity: 1.0, delayRate: 0.04, yearsAgo: 8, status: "leave" },
  { name: "山本 直樹", kana: "ヤマモト ナオキ", employment: "contractor", office: "honsha", capacity: 1.1, delayRate: 0.06, yearsAgo: 3 },
  { name: "松本 亮", kana: "マツモト リョウ", employment: "contractor", office: "honsha", capacity: 0.95, delayRate: 0.07, yearsAgo: 2 },
  { name: "井上 和也", kana: "イノウエ カズヤ", employment: "contractor", office: "kawasaki", capacity: 0.85, delayRate: 0.08, yearsAgo: 1 },
  { name: "木村 優斗", kana: "キムラ ユウト", employment: "contractor", office: "kawasaki", capacity: 0.8, delayRate: 0.09, yearsAgo: 1 },
  { name: "林 健太", kana: "ハヤシ ケンタ", employment: "contractor", office: "honsha", capacity: 0.75, delayRate: 0.07, yearsAgo: 0 },
];

export type VehicleSeed = {
  plate: string;
  type: string;
  maker: string;
  model: string;
  capacityKg: number;
  status: "active" | "maintenance" | "standby";
  /** 担当ドライバー（DRIVERS の添字） */
  driver?: number;
  /** 今日からの日数（負なら期限切れ） */
  inspectionInDays: number;
  insuranceInDays: number;
  notes?: string;
};

export const VEHICLES: VehicleSeed[] = [
  { plate: "品川 480 あ 12-01", type: "軽バン", maker: "スズキ", model: "エブリイ", capacityKg: 350, status: "active", driver: 0, inspectionInDays: 412, insuranceInDays: 220 },
  { plate: "品川 480 あ 12-02", type: "軽バン", maker: "スズキ", model: "エブリイ", capacityKg: 350, status: "active", driver: 1, inspectionInDays: 18, insuranceInDays: 160, notes: "車検の予約済み（11月中旬）" },
  { plate: "品川 480 あ 12-03", type: "軽バン", maker: "ダイハツ", model: "ハイゼットカーゴ", capacityKg: 350, status: "active", driver: 2, inspectionInDays: 301, insuranceInDays: 95 },
  { plate: "品川 480 あ 12-04", type: "軽バン", maker: "ダイハツ", model: "ハイゼットカーゴ", capacityKg: 350, status: "active", driver: 3, inspectionInDays: 530, insuranceInDays: 27 },
  { plate: "品川 480 い 22-11", type: "軽バン", maker: "ホンダ", model: "N-VAN", capacityKg: 350, status: "active", driver: 4, inspectionInDays: 640, insuranceInDays: 310 },
  { plate: "川崎 480 あ 31-05", type: "軽バン", maker: "スズキ", model: "エブリイ", capacityKg: 350, status: "active", driver: 5, inspectionInDays: 25, insuranceInDays: 188 },
  { plate: "川崎 480 あ 31-06", type: "軽バン", maker: "ホンダ", model: "N-VAN", capacityKg: 350, status: "active", driver: 6, inspectionInDays: 455, insuranceInDays: 240 },
  { plate: "川崎 480 あ 31-07", type: "軽バン", maker: "ダイハツ", model: "ハイゼットカーゴ", capacityKg: 350, status: "active", driver: 7, inspectionInDays: 210, insuranceInDays: 64 },
  { plate: "品川 480 い 22-12", type: "軽バン", maker: "スズキ", model: "エブリイ", capacityKg: 350, status: "active", driver: 8, inspectionInDays: 378, insuranceInDays: 133 },
  { plate: "品川 400 さ 50-21", type: "1tバン", maker: "トヨタ", model: "タウンエースバン", capacityKg: 750, status: "active", driver: 10, inspectionInDays: 156, insuranceInDays: 279 },
  { plate: "品川 400 さ 50-22", type: "1tバン", maker: "日産", model: "NV200バネット", capacityKg: 600, status: "active", driver: 11, inspectionInDays: 98, insuranceInDays: 41 },
  { plate: "川崎 400 さ 61-03", type: "1tバン", maker: "トヨタ", model: "タウンエースバン", capacityKg: 750, status: "active", driver: 12, inspectionInDays: 342, insuranceInDays: 205 },
  { plate: "川崎 400 さ 61-04", type: "1tバン", maker: "日産", model: "NV200バネット", capacityKg: 600, status: "active", driver: 13, inspectionInDays: 488, insuranceInDays: 150 },
  { plate: "品川 100 た 70-08", type: "2tトラック", maker: "いすゞ", model: "エルフ", capacityKg: 2000, status: "active", driver: 14, inspectionInDays: 120, insuranceInDays: 330 },
  { plate: "品川 100 た 70-09", type: "2tトラック", maker: "日野", model: "デュトロ", capacityKg: 2000, status: "maintenance", inspectionInDays: 260, insuranceInDays: 112, notes: "ブレーキ整備のため入庫中" },
  { plate: "品川 480 う 33-15", type: "軽バン", maker: "スズキ", model: "エブリイ", capacityKg: 350, status: "standby", inspectionInDays: 58, insuranceInDays: -4, notes: "任意保険の更新手続き中" },
  { plate: "川崎 480 い 41-02", type: "軽バン", maker: "ダイハツ", model: "ハイゼットカーゴ", capacityKg: 350, status: "standby", inspectionInDays: 199, insuranceInDays: 87 },
  { plate: "川崎 480 い 41-03", type: "軽バン", maker: "ホンダ", model: "N-VAN", capacityKg: 350, status: "standby", inspectionInDays: 610, insuranceInDays: 256 },
];

export type ClientSeed = {
  name: string;
  contact: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  /** 依頼の多さ */
  weight: number;
  /** 1件あたりの基本料金（円） */
  baseFee: number;
  cargo: string[];
  quantity: [number, number];
  /** 配送先の名前の付け方 */
  destinations: string[];
  yearsAgo: number;
  notes?: string;
};

export const CLIENTS: ClientSeed[] = [
  {
    name: "関東フレッシュフーズ株式会社", contact: "物流部 大野", phone: "03-0000-1101",
    address: "東京都大田区東海3-6-1", lat: 35.5892, lng: 139.7563, weight: 26, baseFee: 5200,
    cargo: ["冷蔵食品", "青果", "冷凍食品"], quantity: [3, 24],
    destinations: ["レストラン", "スーパー", "給食センター", "ホテル厨房"], yearsAgo: 6,
    notes: "冷蔵品は温度管理表の記入が必要",
  },
  {
    name: "東邦メディカル商事株式会社", contact: "業務課 石川", phone: "03-0000-2202",
    address: "東京都港区芝浦4-9-25", lat: 35.6386, lng: 139.7499, weight: 18, baseFee: 9000,
    cargo: ["医療機器", "医療消耗品"], quantity: [1, 8],
    destinations: ["クリニック", "病院", "歯科医院"], yearsAgo: 5,
  },
  {
    name: "港南精機株式会社", contact: "生産管理 長谷川", phone: "044-000-3303",
    address: "神奈川県川崎市川崎区殿町3-25", lat: 35.5384, lng: 139.7488, weight: 14, baseFee: 12000,
    cargo: ["精密部品", "検査機器"], quantity: [1, 6],
    destinations: ["工場", "研究所", "技術センター"], yearsAgo: 4,
    notes: "精密機器のため緩衝材を必ず使用",
  },
  {
    name: "武蔵野オフィス機器株式会社", contact: "サービス部 村上", phone: "03-0000-4404",
    address: "東京都品川区南大井6-20-14", lat: 35.5937, lng: 139.7344, weight: 8, baseFee: 7800,
    cargo: ["複合機", "事務用品", "OA機器"], quantity: [1, 10],
    destinations: ["オフィス", "事務所", "支店"], yearsAgo: 3,
  },
  {
    name: "城南ドラッグ株式会社", contact: "店舗運営部 西田", phone: "03-0000-5505",
    address: "東京都目黒区目黒本町2-8-3", lat: 35.6216, lng: 139.6992, weight: 9, baseFee: 4800,
    cargo: ["医薬品", "日用品"], quantity: [2, 16],
    destinations: ["薬局", "ドラッグストア"], yearsAgo: 4,
  },
  {
    name: "湾岸アパレル株式会社", contact: "EC物流 原田", phone: "03-0000-6606",
    address: "東京都江東区新木場2-14-7", lat: 35.6422, lng: 139.8296, weight: 6, baseFee: 6000,
    cargo: ["衣料品", "雑貨"], quantity: [4, 30],
    destinations: ["店舗", "ショールーム", "百貨店"], yearsAgo: 2,
  },
  {
    name: "川崎ケミカル工業株式会社", contact: "資材課 藤田", phone: "044-000-7707",
    address: "神奈川県川崎市川崎区千鳥町9-2", lat: 35.5097, lng: 139.7578, weight: 5, baseFee: 10500,
    cargo: ["工業用薬品（非危険物）", "樹脂材料"], quantity: [1, 12],
    destinations: ["工場", "加工センター"], yearsAgo: 3,
  },
  {
    name: "東京ブックス流通株式会社", contact: "配送課 岡田", phone: "03-0000-8808",
    address: "東京都板橋区舟渡4-3-15", lat: 35.7934, lng: 139.6862, weight: 5, baseFee: 5000,
    cargo: ["書籍", "雑誌"], quantity: [5, 40],
    destinations: ["書店", "図書館", "学校"], yearsAgo: 5,
  },
  {
    name: "品川インテリア株式会社", contact: "配送センター 中島", phone: "03-0000-9909",
    address: "東京都品川区八潮2-5-8", lat: 35.6071, lng: 139.7522, weight: 4, baseFee: 15000,
    cargo: ["オフィス家具", "照明器具"], quantity: [1, 5],
    destinations: ["オフィス", "ショールーム", "ホテル"], yearsAgo: 2,
    notes: "2名作業が必要な案件あり",
  },
  {
    name: "多摩電材株式会社", contact: "営業部 小川", phone: "042-000-1010",
    address: "東京都府中市四谷5-12-1", lat: 35.6672, lng: 139.4639, weight: 4, baseFee: 7000,
    cargo: ["電材", "ケーブル"], quantity: [2, 14],
    destinations: ["工事現場", "電気工事店", "倉庫"], yearsAgo: 1,
  },
  {
    name: "横浜ベーカリー株式会社", contact: "製造部 青木", phone: "045-000-1111",
    address: "神奈川県横浜市鶴見区大黒町5-30", lat: 35.4686, lng: 139.6797, weight: 3, baseFee: 4200,
    cargo: ["パン", "洋菓子"], quantity: [5, 30],
    destinations: ["カフェ", "スーパー", "ホテル"], yearsAgo: 1,
  },
  {
    name: "さくら印刷株式会社", contact: "営業部 松井", phone: "03-0000-1212",
    address: "東京都墨田区立花1-22-6", lat: 35.7015, lng: 139.8296, weight: 3, baseFee: 6500,
    cargo: ["印刷物", "販促物"], quantity: [2, 20],
    destinations: ["オフィス", "展示会場", "店舗"], yearsAgo: 0,
  },
];

/** 配送先のエリア（市区町村名と中心付近の座標） */
export const AREAS = [
  { pref: "東京都", city: "港区", towns: ["芝浦", "海岸", "三田", "高輪", "港南"], lat: 35.6581, lng: 139.7514 },
  { pref: "東京都", city: "品川区", towns: ["東品川", "大崎", "西五反田", "南品川"], lat: 35.6092, lng: 139.7302 },
  { pref: "東京都", city: "大田区", towns: ["蒲田", "大森北", "羽田", "西糀谷", "池上"], lat: 35.5614, lng: 139.716 },
  { pref: "東京都", city: "目黒区", towns: ["中目黒", "自由が丘", "下目黒"], lat: 35.6415, lng: 139.6983 },
  { pref: "東京都", city: "世田谷区", towns: ["三軒茶屋", "用賀", "桜新町", "二子玉川"], lat: 35.6464, lng: 139.6532 },
  { pref: "東京都", city: "渋谷区", towns: ["恵比寿", "神宮前", "代々木"], lat: 35.6639, lng: 139.6982 },
  { pref: "東京都", city: "新宿区", towns: ["西新宿", "高田馬場", "四谷"], lat: 35.6938, lng: 139.7034 },
  { pref: "東京都", city: "千代田区", towns: ["丸の内", "神田", "大手町"], lat: 35.6869, lng: 139.7639 },
  { pref: "東京都", city: "中央区", towns: ["日本橋", "銀座", "八丁堀", "月島"], lat: 35.6707, lng: 139.772 },
  { pref: "東京都", city: "江東区", towns: ["豊洲", "有明", "亀戸", "東陽"], lat: 35.6728, lng: 139.8173 },
  { pref: "東京都", city: "江戸川区", towns: ["葛西", "小岩", "船堀"], lat: 35.7067, lng: 139.8683 },
  { pref: "東京都", city: "台東区", towns: ["上野", "浅草", "蔵前"], lat: 35.7127, lng: 139.7802 },
  { pref: "東京都", city: "板橋区", towns: ["大山", "高島平", "成増"], lat: 35.7512, lng: 139.7093 },
  { pref: "東京都", city: "練馬区", towns: ["光が丘", "石神井", "大泉"], lat: 35.7356, lng: 139.6517 },
  { pref: "東京都", city: "杉並区", towns: ["荻窪", "高円寺", "阿佐谷"], lat: 35.6995, lng: 139.6364 },
  { pref: "東京都", city: "府中市", towns: ["府中町", "分梅町", "新町"], lat: 35.6689, lng: 139.4776 },
  { pref: "東京都", city: "調布市", towns: ["布田", "国領町", "仙川町"], lat: 35.6506, lng: 139.5407 },
  { pref: "神奈川県", city: "川崎市川崎区", towns: ["駅前本町", "砂子", "大師町"], lat: 35.5308, lng: 139.7029 },
  { pref: "神奈川県", city: "川崎市中原区", towns: ["小杉町", "新丸子", "上小田中"], lat: 35.5759, lng: 139.6596 },
  { pref: "神奈川県", city: "川崎市高津区", towns: ["溝口", "久本", "坂戸"], lat: 35.5994, lng: 139.6108 },
  { pref: "神奈川県", city: "横浜市鶴見区", towns: ["鶴見中央", "生麦", "末広町"], lat: 35.5084, lng: 139.6824 },
  { pref: "神奈川県", city: "横浜市港北区", towns: ["新横浜", "日吉", "大倉山"], lat: 35.5196, lng: 139.6332 },
  { pref: "神奈川県", city: "横浜市西区", towns: ["みなとみらい", "高島", "北幸"], lat: 35.4537, lng: 139.6195 },
  { pref: "神奈川県", city: "横浜市中区", towns: ["山下町", "本町", "関内"], lat: 35.4448, lng: 139.6425 },
] as const;

/** 配送先の名前に使う架空の屋号 */
export const BUSINESS_PREFIXES = [
  "あおば", "さくら", "みどり", "ひかり", "あさひ", "はるか", "つばさ", "いろは", "こもれび", "かえで",
  "ほしの", "すみれ", "ゆうき", "なぎさ", "わかば", "ことぶき", "やまびこ", "たちばな", "ふたば", "あけぼの",
] as const;

export { FAILURE_REASONS, CANCEL_REASONS } from "@/lib/domain/reasons";
