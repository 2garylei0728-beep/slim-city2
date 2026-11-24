import {
  createMacauMapTiles,
  dist2D,
  generateParcelsForSegment,
  isTileAdjacentToUnlocked,
  isTileUnlockedAt,
  isWalkablePosition,
  isWaterAt,
  projectPointToSegment,
  segmentCrossesWater,
  segmentsIntersect,
  terrainHeightAt,
} from './geometry';
import { findRoadPath } from './navigation';
import {
  getActiveDynamicModifiers,
  stepDynamicWorldElementsAndQuests,
} from './aiDirector';
import {
  computeFloodImpacts,
  createInitialWeatherState,
  setWeatherPhase,
  stepCityWeather,
} from './weather';
import type {
  BuildingCategory,
  BudgetSnapshot,
  Building,
  CityEvent,
  CityState,
  ClientAction,
  CurrentBudgetSummary,
  LandmarkType,
  MapTile,
  Merchant,
  MerchantTransaction,
  MilestoneTask,
  PlayerRole,
  RoadNode,
  RoadSegment,
  RoadTier,
  SimPlayer,
  TerrainEdit,
  TerrainOpKind,
  Vec2,
  ZoneParcel,
  ZoneType,
} from './types';

export const ROAD_COST_PER_M: Record<RoadTier, number> = {
  street: 180,
  avenue: 340,
  bus_avenue: 520,
};

export const ROAD_CAPACITY: Record<RoadTier, number> = {
  street: 26,
  avenue: 54,
  bus_avenue: 86,
};

export const ROUNDABOUT_COST = 3800;
export const BUS_UPGRADE_COST = 2400;

export const DIRECT_BUILD_COST: Record<Exclude<ZoneType, 'none'>, number> = {
  residential: 2400,
  commercial: 3100,
  tourism: 3800,
  industrial: 2800,
};

export interface LandmarkSpec {
  name: string;
  category: BuildingCategory;
  cost: number;
  radius: number;
  landValueBonus: number;
  tourismBonus: number;
  happinessBonus: number;
  taxYield: number;
  trafficReliefBonus: number;
  jobsBonus?: number;
  populationBonus?: number;
  localTrafficRadius?: number;
  localTrafficRelief?: number;
  demandBoost?: Partial<Record<Exclude<ZoneType, 'none'>, number>>;
  cleanAura?: boolean;
  nimbyResidential?: number;
  allowWaterfront?: boolean;
  description: string;
}

export const LANDMARK_SPECS: Record<LandmarkType, LandmarkSpec> = {
  macau_tower: {
    name: '澳門觀光塔',
    category: 'landmark',
    cost: 18000,
    radius: 56,
    landValueBonus: 26,
    tourismBonus: 22,
    happinessBonus: 5,
    taxYield: 360,
    trafficReliefBonus: 0,
    jobsBonus: 65,
    demandBoost: { tourism: 8 },
    description: '南灣天際線核心高塔，大幅提升周邊地價、觀光客流與文旅稅收',
  },
  lotus_plaza: {
    name: '金蓮花文化廣場',
    category: 'landmark',
    cost: 9500,
    radius: 42,
    landValueBonus: 18,
    tourismBonus: 12,
    happinessBonus: 4,
    taxYield: 120,
    trafficReliefBonus: 0,
    demandBoost: { tourism: 4, commercial: 3 },
    description: '金色盛蓮地標廣場，凝聚市民向心力並帶動周邊商業繁榮',
  },
  harbor_park: {
    name: '南灣海濱公園',
    category: 'leisure',
    cost: 4200,
    radius: 34,
    landValueBonus: 12,
    tourismBonus: 6,
    happinessBonus: 4,
    taxYield: 0,
    trafficReliefBonus: 0,
    demandBoost: { residential: 4 },
    description: '林蔭噴泉海濱休憩園地，性價比極高的地價與居住幸福引擎',
  },
  grand_casino_resort: {
    name: '路氹綜合度假宮',
    category: 'landmark',
    cost: 22000,
    radius: 60,
    landValueBonus: 24,
    tourismBonus: 28,
    happinessBonus: 4,
    taxYield: 520,
    trafficReliefBonus: 0,
    jobsBonus: 160,
    demandBoost: { tourism: 12, commercial: 6 },
    description: '雙子金塔旗艦綜合度假城，提供 160 職位與豐厚文旅稅收',
  },
  coastal_promenade: {
    name: '海濱觀景摩天輪',
    category: 'leisure',
    cost: 9600,
    radius: 44,
    landValueBonus: 14,
    tourismBonus: 15,
    happinessBonus: 6,
    taxYield: 180,
    trafficReliefBonus: 0,
    jobsBonus: 35,
    demandBoost: { tourism: 6 },
    description: '旋轉發光黃金摩天輪與木棧廣場，深受旅客與市民喜愛',
  },
  grand_prix_stand: {
    name: '東望洋賽車看台',
    category: 'leisure',
    cost: 8800,
    radius: 40,
    landValueBonus: 15,
    tourismBonus: 16,
    happinessBonus: 5,
    taxYield: 190,
    trafficReliefBonus: 0,
    jobsBonus: 45,
    demandBoost: { tourism: 7 },
    description: '賽車文化看台與維修區，提升文旅吸引力與賽事經濟活力',
  },
  heritage_pavilion: {
    name: '葡韻議事亭書院',
    category: 'civic',
    cost: 7400,
    radius: 44,
    landValueBonus: 15,
    tourismBonus: 9,
    happinessBonus: 7,
    taxYield: 60,
    trafficReliefBonus: 0,
    jobsBonus: 40,
    demandBoost: { residential: 5 },
    description: '融合南歐拱廊與嶺南書院的文化市政學府，大幅提升居住幸福感',
  },
  fire_hospital_hub: {
    name: '綜合醫療消防中心',
    category: 'civic',
    cost: 10500,
    radius: 52,
    landValueBonus: 11,
    tourismBonus: 2,
    happinessBonus: 9,
    taxYield: 0,
    trafficReliefBonus: 0,
    jobsBonus: 85,
    populationBonus: 60,
    demandBoost: { residential: 7 },
    description: '配備直升機坪的市政急救醫療園區，提升全城滿意度與人口承載力',
  },
  ferry_terminal: {
    name: '港澳水岸客運碼頭',
    category: 'transit',
    cost: 11200,
    radius: 48,
    landValueBonus: 14,
    tourismBonus: 18,
    happinessBonus: 3,
    taxYield: 240,
    trafficReliefBonus: 0.08,
    localTrafficRadius: 48,
    localTrafficRelief: 0.14,
    jobsBonus: 75,
    allowWaterfront: true,
    demandBoost: { tourism: 8, commercial: 6 },
    description: '建於海陸岸線，停泊噴射飛航並有效分流周邊跨海車流與吸引旅客',
  },
  eco_solar_plant: {
    name: '路環綠能潔淨電站',
    category: 'transit',
    cost: 8600,
    radius: 38,
    landValueBonus: 6,
    tourismBonus: 3,
    happinessBonus: 3,
    taxYield: 260,
    trafficReliefBonus: 0,
    jobsBonus: 55,
    cleanAura: true,
    demandBoost: { industrial: 6 },
    description: '旋轉風機與太陽能光伏潔淨供電樞紐，穩定輸出電力稅收並淨化環境',
  },
  lrt_station: {
    name: '澳門輕軌樞紐站',
    category: 'transit',
    cost: 12400,
    radius: 50,
    landValueBonus: 16,
    tourismBonus: 8,
    happinessBonus: 5,
    taxYield: 160,
    trafficReliefBonus: 0.10,
    localTrafficRadius: 52,
    localTrafficRelief: 0.24,
    jobsBonus: 60,
    demandBoost: { commercial: 7, residential: 6 },
    description: '架空輕軌列車往返穿梭，大幅舒緩方圓 52m 路網壅塞並拉升沿線地價',
  },
  university_hub: {
    name: '澳門科創大學城',
    category: 'civic',
    cost: 13800,
    radius: 54,
    landValueBonus: 17,
    tourismBonus: 7,
    happinessBonus: 6,
    taxYield: 180,
    trafficReliefBonus: 0,
    jobsBonus: 120,
    populationBonus: 110,
    demandBoost: { industrial: 12, commercial: 7 },
    description: '孕育科研人才與青年住房需求，提供 120 職位與 +110 校區人口容量',
  },
  convention_expo: {
    name: '國際會展商貿中心',
    category: 'landmark',
    cost: 16500,
    radius: 56,
    landValueBonus: 20,
    tourismBonus: 24,
    happinessBonus: 4,
    taxYield: 420,
    trafficReliefBonus: 0,
    jobsBonus: 140,
    demandBoost: { commercial: 12, tourism: 10 },
    description: '拱頂會展殿堂強勢帶動商業與商旅需求，每期創收 $420 商貿稅收',
  },
  port_logistics_depot: {
    name: '九澳貨櫃物流樞紐',
    category: 'transit',
    cost: 11800,
    radius: 46,
    landValueBonus: 10,
    tourismBonus: 0,
    happinessBonus: 1,
    taxYield: 390,
    trafficReliefBonus: 0.04,
    jobsBonus: 130,
    nimbyResidential: 8,
    allowWaterfront: true,
    demandBoost: { industrial: 15, commercial: 5 },
    description: '臨海集裝箱深水碼頭（需建於岸線），大幅推升工貿產值與職位（宜遠離純住宅）',
  },
  water_purification_plant: {
    name: '海濱再生淨水廠',
    category: 'civic',
    cost: 9200,
    radius: 48,
    landValueBonus: 12,
    tourismBonus: 2,
    happinessBonus: 8,
    taxYield: 90,
    trafficReliefBonus: 0,
    jobsBonus: 50,
    populationBonus: 180,
    cleanAura: true,
    demandBoost: { residential: 10 },
    description: '雙旋轉沉澱池供水設施，消除周邊工業污染懲罰並支撐 +180 城市人口',
  },
  macau_art_museum: {
    name: '澳門當代藝術館',
    category: 'leisure',
    cost: 10800,
    radius: 46,
    landValueBonus: 22,
    tourismBonus: 18,
    happinessBonus: 7,
    taxYield: 140,
    trafficReliefBonus: 0,
    jobsBonus: 48,
    demandBoost: { tourism: 9, residential: 5 },
    description: '幾何黃金稜鏡藝文地標，顯著拉升周邊高端住宅地價與文化滿意度',
  },
};

export interface TerraformSpec {
  name: string;
  cost: number;
  radius: number;
  delta: number;
  description: string;
  colorHex: string;
}

export const TERRAFORM_SPECS: Record<TerrainOpKind, TerraformSpec> = {
  reclaim: {
    name: '填海造地',
    cost: 2200,
    radius: 14,
    delta: 0,
    description: '將海域填築為平坦可建設土地（重現澳門填海工程）',
    colorHex: '#10b981',
  },
  canal: {
    name: '開鑿運河',
    cost: 1800,
    radius: 12,
    delta: 0,
    description: '開挖城市運河或內湖景觀水域，沿岸地價上升且可架橋通行',
    colorHex: '#06b6d4',
  },
  raise: {
    name: '隆起造山',
    cost: 900,
    radius: 13,
    delta: 2.2,
    description: '平滑抬升地形海拔，塑造澳氹山水輪廓',
    colorHex: '#f59e0b',
  },
  flatten: {
    name: '削平坡地',
    cost: 1100,
    radius: 15,
    delta: 0,
    description: '將起伏山丘整平為適合修路劃地與置業的台地',
    colorHex: '#38bdf8',
  },
  lower: {
    name: '降低地形',
    cost: 800,
    radius: 13,
    delta: -2.0,
    description: '平滑降低地面高度以配合海濱與道路高程',
    colorHex: '#a78bfa',
  },
};

const CAREER_LADDER = [
  { level: 1 as const, title: '實習城市規劃師', salary: 650, nextXp: 100 },
  { level: 2 as const, title: '註冊都市建築師', salary: 1250, nextXp: 260 },
  { level: 3 as const, title: '澳氹地產開發總監', salary: 2200, nextXp: 520 },
  { level: 4 as const, title: '大灣區傳奇置業大亨', salary: 3800, nextXp: 999999 },
];

export const EVENT_CATALOG: Omit<CityEvent, 'triggeredAtTick'>[] = [
  {
    id: 'grand_prix',
    title: '澳門格蘭披治大賽車揭幕',
    category: 'festival',
    description:
      '東望洋跑道迎來年度大賽車，旅客與商賈雲集半島，商業與文旅地價急升，但主幹道交通負荷大增。',
    choices: [
      {
        id: 'gp_transit',
        label: '加開免費賽事接駁巴士',
        effectSummary: '庫房 -$3,500 · 交通舒緩 +15% · 市民滿意度 +8 · 文旅需求大增',
        treasuryDelta: -3500,
        happinessDelta: 8,
        trafficReliefDelta: 15,
        demandBoost: { tourism: 24, commercial: 14 },
      },
      {
        id: 'gp_tickets',
        label: '開放商業贊助與貴賓看台',
        effectSummary: '庫房 +$7,200 · 交通壓力略增 · 商旅地價短期上漲',
        treasuryDelta: 7200,
        happinessDelta: -2,
        trafficReliefDelta: -10,
        demandBoost: { tourism: 18, commercial: 20 },
        landValueMultiplier: 1.12,
      },
    ],
  },
  {
    id: 'typhoon_alert',
    title: '熱帶氣旋「天鴿」迫近警報',
    category: 'weather',
    description:
      '氣象局發出八號風球預警，低窪海濱路段面臨風暴潮考驗，需立即決定防災與營運方案。',
    choices: [
      {
        id: 'typhoon_shield',
        label: '啟動海濱防洪閘與應急補貼',
        effectSummary: '庫房 -$4,800 · 滿意度 +10 · 保障全城設施免受損失',
        treasuryDelta: -4800,
        happinessDelta: 10,
        trafficReliefDelta: 6,
      },
      {
        id: 'typhoon_minimal',
        label: '僅發布交通管制通知',
        effectSummary: '庫房 -$900 · 滿意度 -7 · 短期交通放緩',
        treasuryDelta: -900,
        happinessDelta: -7,
        trafficReliefDelta: -12,
      },
    ],
  },
  {
    id: 'land_auction_boom',
    title: '澳氹土地拍賣熱潮',
    category: 'market',
    description:
      '多家地產商看好澳門灣區前景，爭相在路網沿線搶購地塊並準備轉售套利！',
    choices: [
      {
        id: 'auction_tax',
        label: '開放快速審批並徵收標準印花稅',
        effectSummary: '庫房 +$4,500 · 地產商資金充裕 · 全城地價上浮',
        treasuryDelta: 4500,
        happinessDelta: 3,
        trafficReliefDelta: 0,
        demandBoost: { residential: 16, commercial: 16 },
        landValueMultiplier: 1.15,
      },
      {
        id: 'auction_cap',
        label: '優先保留部分土地作宜居住宅',
        effectSummary: '滿意度 +9 · 住宅需求與舒適度大幅提升',
        treasuryDelta: 1200,
        happinessDelta: 9,
        trafficReliefDelta: 4,
        demandBoost: { residential: 28 },
      },
    ],
  },
  {
    id: 'bridge_visitor_surge',
    title: '港珠澳口岸客流創新高',
    category: 'transit',
    description:
      '週末大量旅客經跨海通道湧入澳門，酒店與娛樂綜合體需求爆棚，跨海橋樑車流激增。',
    choices: [
      {
        id: 'bridge_bus',
        label: '實施橋樑巴士優先通行調度',
        effectSummary: '庫房 -$2,200 · 交通舒緩 +14% · 文旅收入攀升',
        treasuryDelta: -2200,
        happinessDelta: 5,
        trafficReliefDelta: 14,
        demandBoost: { tourism: 20, commercial: 12 },
      },
      {
        id: 'bridge_toll',
        label: '增收高峰時段過橋調節費',
        effectSummary: '庫房 +$5,600 · 滿意度 -4 · 稍微抑制車流',
        treasuryDelta: 5600,
        happinessDelta: -4,
        trafficReliefDelta: 5,
      },
    ],
  },
  {
    id: 'heritage_revival',
    title: '歷史城區葡韻活化計劃',
    category: 'heritage',
    description:
      '市民與建築師聯署推動葡式建築群保育與文創商圈升級，有助提升居住品質與觀光吸引力。',
    choices: [
      {
        id: 'heritage_fund',
        label: '撥款設立文創活化基金',
        effectSummary: '庫房 -$3,000 · 滿意度 +11 · 文旅與住宅地價上升',
        treasuryDelta: -3000,
        happinessDelta: 11,
        trafficReliefDelta: 2,
        demandBoost: { tourism: 15, residential: 12 },
        landValueMultiplier: 1.1,
      },
      {
        id: 'heritage_private',
        label: '鼓勵地產商出資認養街道',
        effectSummary: '庫房 +$1,800 · 滿意度 +4 · 商戶活躍度上升',
        treasuryDelta: 1800,
        happinessDelta: 4,
        trafficReliefDelta: 0,
        demandBoost: { commercial: 14 },
      },
    ],
  },
];

let uidCounter = 1;
export function nextId(prefix: string): string {
  uidCounter += 1;
  return `${prefix}_${uidCounter}_${Math.floor(Math.random() * 10000)}`;
}

function createStarterMerchants(): Merchant[] {
  return [
    {
      id: 'm_namvan',
      name: '南灣置業集團',
      focus: 'residential',
      color: '#34d399',
      capital: 48000,
      riskAppetite: 0.65,
      holdingsCount: 0,
      buildingsBuilt: 0,
      tradesCompleted: 0,
      lastActionText: '正在評估南灣沿線住宅地塊',
    },
    {
      id: 'm_cotai',
      name: '路氹文旅控股',
      focus: 'tourism',
      color: '#f59e0b',
      capital: 72000,
      riskAppetite: 0.85,
      holdingsCount: 0,
      buildingsBuilt: 0,
      tradesCompleted: 0,
      lastActionText: '物色海景度假村與娛樂用地',
    },
    {
      id: 'm_nape',
      name: '新口岸商貿行',
      focus: 'commercial',
      color: '#38bdf8',
      capital: 56000,
      riskAppetite: 0.72,
      holdingsCount: 0,
      buildingsBuilt: 0,
      tradesCompleted: 0,
      lastActionText: '關注高人流大道商業地段',
    },
    {
      id: 'm_hengqin',
      name: '澳琴科創投資',
      focus: 'industrial',
      color: '#a78bfa',
      capital: 52000,
      riskAppetite: 0.55,
      holdingsCount: 0,
      buildingsBuilt: 0,
      tradesCompleted: 0,
      lastActionText: '尋找物流與智慧研發園區',
    },
    {
      id: 'm_heritage',
      name: '大三巴華商會',
      focus: 'commercial',
      color: '#fb7185',
      capital: 44000,
      riskAppetite: 0.78,
      holdingsCount: 0,
      buildingsBuilt: 0,
      tradesCompleted: 0,
      lastActionText: '擅長低買高賣翻新地產套利',
    },
  ];
}

export function createInitialCityState(roomId = 'macau-main'): CityState {
  const mapTiles: MapTile[] = createMacauMapTiles();

  // All starter nodes sit inside central starter tile_2_2 ([-42, 42] x [-42, 42])
  // avoiding Sai Van Lake (-21,-24) and Nam Van Lake (20,-23)
  const nodes: RoadNode[] = [
    { id: 'n_1', x: -32, z: -30, isRoundabout: false, isBridgeNode: false },
    { id: 'n_2', x: 0, z: -30, isRoundabout: true, isBridgeNode: false },
    { id: 'n_3', x: 32, z: -30, isRoundabout: false, isBridgeNode: false },
    { id: 'n_4', x: -32, z: -16, isRoundabout: false, isBridgeNode: false },
    { id: 'n_5', x: 0, z: -14, isRoundabout: false, isBridgeNode: false },
    // Cross-harbor bridge from central Peninsula roundabout to Taipa North Shore
    { id: 'n_6', x: 0, z: 28, isRoundabout: false, isBridgeNode: false },
    { id: 'n_7', x: 32, z: 28, isRoundabout: false, isBridgeNode: false },
  ];

  const segments: RoadSegment[] = [
    { id: 's_1', nodeA: 'n_1', nodeB: 'n_2', tier: 'avenue', isBridge: false, length: 32, trafficLoad: 0.28, capacity: ROAD_CAPACITY.avenue },
    { id: 's_2', nodeA: 'n_2', nodeB: 'n_3', tier: 'avenue', isBridge: false, length: 32, trafficLoad: 0.24, capacity: ROAD_CAPACITY.avenue },
    { id: 's_3', nodeA: 'n_1', nodeB: 'n_4', tier: 'street', isBridge: false, length: 14, trafficLoad: 0.18, capacity: ROAD_CAPACITY.street },
    { id: 's_4', nodeA: 'n_2', nodeB: 'n_5', tier: 'street', isBridge: false, length: 16, trafficLoad: 0.22, capacity: ROAD_CAPACITY.street },
    { id: 's_5', nodeA: 'n_2', nodeB: 'n_6', tier: 'avenue', isBridge: true, length: 58, trafficLoad: 0.31, capacity: ROAD_CAPACITY.avenue },
    { id: 's_6', nodeA: 'n_6', nodeB: 'n_7', tier: 'street', isBridge: false, length: 32, trafficLoad: 0.16, capacity: ROAD_CAPACITY.street },
  ];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const parcels: ZoneParcel[] = [];
  for (const seg of segments) {
    const generated = generateParcelsForSegment(seg, nodeMap, segments, parcels, () => nextId('p'), mapTiles);
    parcels.push(...generated);
  }

  // Zone a few starter parcels near Peninsula center so merchants start trading immediately
  const starterZones: ZoneType[] = ['residential', 'residential', 'commercial', 'tourism', 'residential', 'commercial'];
  const buildings: Building[] = [];
  const merchants = createStarterMerchants();

  let zonedIdx = 0;
  for (let i = 0; i < parcels.length && zonedIdx < starterZones.length; i++) {
    const p = parcels[i];
    if (p.z < -12 && Math.abs(p.x) < 40) {
      const zt = starterZones[zonedIdx] as Exclude<ZoneType, 'none'>;
      p.zone = zt;
      if (zonedIdx < 4) {
        const merchant = merchants[zonedIdx % merchants.length];
        p.ownerMerchantId = merchant.id;
        p.purchasePrice = 1800 + zonedIdx * 350;
        p.tradeCount = 1;
        const bId = nextId('b');
        p.buildingId = bId;
        merchant.holdingsCount += 1;
        merchant.buildingsBuilt += 1;
        buildings.push({
          id: bId,
          parcelId: p.id,
          x: p.x,
          z: p.z,
          angle: p.angle,
          zone: zt,
          level: 1,
          styleVariant: zonedIdx % 3,
          status: 'active',
          buildProgress: 1,
          residents: zt === 'residential' ? 95 : 0,
          jobs: zt === 'residential' ? 0 : 60,
          taxYield: zt === 'tourism' ? 320 : 210,
          ownerMerchantId: merchant.id,
          builtAtTick: 0,
        });
      }
      zonedIdx++;
    }
  }

  const milestones: MilestoneTask[] = [
    {
      id: 'ms_1',
      title: '首步開埠 · 地產活絡',
      description: '劃設分區並讓地產商完成至少 6 宗土地買賣或建案',
      rewardTreasury: 8000,
      completed: false,
      progressText: '0 / 6 宗交易',
      progressRatio: 0,
    },
    {
      id: 'ms_2',
      title: '澳氹繁榮 · 千人聚落',
      description: '城市人口突破 1,400 人且市民滿意度維持 70% 以上',
      rewardTreasury: 14000,
      completed: false,
      progressText: '0 / 1,400 人',
      progressRatio: 0,
    },
    {
      id: 'ms_3',
      title: '智慧路網 · 圓形地樞紐',
      description: '興建至少 2 座圓形地與 2 條巴士專線，並維持交通流暢度 ≥ 78%',
      rewardTreasury: 18000,
      completed: false,
      progressText: '0 / 2 圓形地',
      progressRatio: 0,
    },
    {
      id: 'ms_4',
      title: '拓展全澳版圖 · 六區聯動',
      description: '於「擴展地圖」解鎖至少 6 個澳門行政分區（涵蓋半島、氹仔、人工島或路環）',
      rewardTreasury: 22000,
      completed: false,
      progressText: '1 / 6 區',
      progressRatio: 1 / 6,
    },
    {
      id: 'ms_5',
      title: '璀璨天際線 · 澳門大都會',
      description: '擁有至少 1 座地標建築、人口達 3,200 人且平均地價 ≥ 62',
      rewardTreasury: 32000,
      completed: false,
      progressText: '0 / 3,200 人',
      progressRatio: 0,
    },
  ];

  const state: CityState = {
    roomId,
    simSpeed: 1,
    stats: {
      tick: 0,
      day: 1,
      treasury: 88000,
      lastIncome: 950,
      lastUpkeep: 240,
      population: 190,
      jobs: 120,
      happiness: 78,
      trafficFlowPct: 91,
      avgLandValue: 48,
      totalBuildings: buildings.length,
      totalRoads: segments.length,
      roundaboutCount: 1,
      busLaneCount: 0,
      unlockedTileCount: 1,
      demand: {
        residential: 76,
        commercial: 68,
        tourism: 72,
        industrial: 58,
      },
      gameOverReason: null,
    },
    mapTiles,
    nodes,
    segments,
    parcels,
    buildings,
    landmarks: [
      {
        id: 'lm_starter_park',
        type: 'harbor_park',
        name: '南灣海濱公園',
        x: -5,
        z: -18,
        radius: 34,
        landValueBonus: 12,
        tourismBonus: 6,
      },
    ],
    merchants,
    transactions: [
      {
        id: 'tx_init_1',
        tick: 0,
        merchantName: '南灣置業集團',
        counterpartyName: null,
        action: 'build',
        zone: 'residential',
        amount: 2150,
        taxPaid: 258,
        x: 0,
        z: -30,
        summary: '南灣置業集團於中區南灣湖畔完成首期葡韻住宅樓盤',
      },
    ],
    activeEvent: null,
    eventHistory: [],
    milestones,
    activeModifiers: {
      tourismBoomTicks: 0,
      trafficPenaltyTicks: 0,
      landBoomTicks: 0,
      transitSubsidyTicks: 0,
    },
    budgetHistory: [],
    populationHistory: [],
    pendingBudget: {
      stampAndSalesTax: 0,
      capitalSpending: 0,
      eventAndGrants: 0,
    },
    terrainEdits: [],
    dynamicElements: [],
    aiQuests: [],
    aiDirectorHeadline: null,
    aiAutoDirector: false,
    weather: createInitialWeatherState(),
    players: {},
    chat: [
      {
        id: 'chat_welcome',
        senderId: 'system',
        senderName: '澳門市政廳',
        senderColor: '#38bdf8',
        text: '歡迎來到全澳門天際線！您由「中區・南灣西灣」出發，向北可拓展關閘青洲、東望洋、新城A區與港珠澳口岸，向南橫跨氹仔、澳門機場、澳大橫琴校區直達路環黑沙海灘與九澳港！',
        timestamp: Date.now(),
        kind: 'system',
      },
    ],
  };

  recomputeLandValuesAndTraffic(state);
  evaluateMilestones(state);

  // Seed opening Macau fiscal progression up to the real tick-0 city state
  const starterSummary = computeCurrentBudgetSummary(state);
  state.stats.lastIncome = starterSummary.recurringRevenue;
  state.stats.lastUpkeep = starterSummary.recurringUpkeep;
  const baselineFactors = [0.58, 0.72, 0.84, 0.93];
  const openingSnapshots: BudgetSnapshot[] = baselineFactors.map((factor, idx) => {
    const residentialTax = Math.round(starterSummary.residentialTax * factor);
    const commercialTax = Math.round(starterSummary.commercialTax * factor);
    const tourismTax = Math.round(starterSummary.tourismTax * factor);
    const industrialTax = Math.round(starterSummary.industrialTax * factor);
    const citizenHeadTax = Math.round(starterSummary.citizenHeadTax * factor);
    const stampAndSalesTax = idx === 3 ? 258 : idx === 1 ? 180 : 0;
    const totalRevenue =
      residentialTax +
      commercialTax +
      tourismTax +
      industrialTax +
      citizenHeadTax +
      stampAndSalesTax;
    const streetUpkeep = starterSummary.streetUpkeep;
    const avenueUpkeep = starterSummary.avenueUpkeep;
    const busUpkeep = starterSummary.busUpkeep;
    const bridgeUpkeep = starterSummary.bridgeUpkeep;
    const landmarkUpkeep = starterSummary.landmarkUpkeep;
    const capitalSpending = idx === 0 ? 4200 : idx === 2 ? 1800 : 0;
    const totalSpending =
      streetUpkeep +
      avenueUpkeep +
      busUpkeep +
      bridgeUpkeep +
      landmarkUpkeep +
      capitalSpending;
    return {
      tick: idx - 4,
      day: 1,
      label: `開埠${idx + 1}`,
      treasury: Math.round(state.stats.treasury - (3 - idx) * 650),
      residentialTax,
      commercialTax,
      tourismTax,
      industrialTax,
      citizenHeadTax,
      stampAndSalesTax,
      eventAndGrants: 0,
      totalRevenue,
      streetUpkeep,
      avenueUpkeep,
      busUpkeep,
      bridgeUpkeep,
      landmarkUpkeep,
      capitalSpending,
      totalSpending,
      netBalance: totalRevenue - totalSpending,
    };
  });

  openingSnapshots.push({
    tick: 0,
    day: 1,
    label: 'D1',
    treasury: Math.round(state.stats.treasury),
    residentialTax: starterSummary.residentialTax,
    commercialTax: starterSummary.commercialTax,
    tourismTax: starterSummary.tourismTax,
    industrialTax: starterSummary.industrialTax,
    citizenHeadTax: starterSummary.citizenHeadTax,
    stampAndSalesTax: 258,
    eventAndGrants: 0,
    totalRevenue: starterSummary.recurringRevenue + 258,
    streetUpkeep: starterSummary.streetUpkeep,
    avenueUpkeep: starterSummary.avenueUpkeep,
    busUpkeep: starterSummary.busUpkeep,
    bridgeUpkeep: starterSummary.bridgeUpkeep,
    landmarkUpkeep: starterSummary.landmarkUpkeep,
    capitalSpending: 0,
    totalSpending: starterSummary.recurringUpkeep,
    netBalance: starterSummary.recurringRevenue + 258 - starterSummary.recurringUpkeep,
  });

  state.budgetHistory = openingSnapshots;

  // Seed 24-hour rolling population baseline culminating at real starter stats.population
  const targetPop = state.stats.population;
  const seedPopHistory = Array.from({ length: 24 }, (_, idx) => {
    const progress = idx / 23;
    const eased = 0.56 + 0.44 * Math.pow(progress, 0.82);
    const subtleWave = idx === 23 ? 0 : Math.round(Math.sin(idx * 0.7) * 4);
    const pop = idx === 23 ? targetPop : Math.max(0, Math.round(targetPop * eased) + subtleWave);
    const hoursAgo = 23 - idx;
    return {
      tick: idx - 23,
      hourLabel: hoursAgo === 0 ? '現在' : `-${hoursAgo}h`,
      population: pop,
    };
  });
  state.populationHistory = seedPopHistory;

  return state;
}

export function computeCurrentBudgetSummary(state: CityState): CurrentBudgetSummary {
  const tourismBoost = state.activeModifiers.tourismBoomTicks > 0 ? 1.25 : 1.0;

  let rawRes = 0;
  let rawCom = 0;
  let rawTour = 0;
  let rawInd = 0;
  let residentialBuildings = 0;
  let commercialBuildings = 0;
  let tourismBuildings = 0;
  let industrialBuildings = 0;

  const floodedBuildingSet = new Set(state.weather?.floodedBuildingIds || []);
  for (const b of state.buildings) {
    if (b.status !== 'active') continue;
    const floodMult = floodedBuildingSet.has(b.id) ? 0.55 : 1.0;
    const yieldAmount = Math.round(b.taxYield * floodMult);
    if (b.zone === 'residential') {
      rawRes += yieldAmount;
      residentialBuildings++;
    } else if (b.zone === 'commercial') {
      rawCom += yieldAmount;
      commercialBuildings++;
    } else if (b.zone === 'tourism') {
      rawTour += yieldAmount;
      tourismBuildings++;
    } else if (b.zone === 'industrial') {
      rawInd += yieldAmount;
      industrialBuildings++;
    }
  }

  for (const lm of state.landmarks) {
    const spec = LANDMARK_SPECS[lm.type];
    const lmTax = lm.taxYield ?? spec?.taxYield ?? 0;
    if (lmTax <= 0) continue;
    if (lm.type === 'eco_solar_plant' || lm.type === 'port_logistics_depot') {
      rawInd += lmTax;
    } else if (
      lm.type === 'ferry_terminal' ||
      lm.type === 'lrt_station' ||
      lm.type === 'convention_expo' ||
      lm.type === 'university_hub'
    ) {
      rawCom += lmTax;
    } else if (lm.type === 'water_purification_plant') {
      rawRes += lmTax;
    } else {
      rawTour += lmTax;
    }
  }

  const residentialTax = Math.round(rawRes * tourismBoost);
  const commercialTax = Math.round(rawCom * tourismBoost);
  const tourismTax = Math.round(rawTour * tourismBoost);
  const industrialTax = Math.round(rawInd * tourismBoost);
  const citizenHeadTax = Math.round(state.stats.population * 1.4 * tourismBoost);
  const recurringRevenue =
    residentialTax + commercialTax + tourismTax + industrialTax + citizenHeadTax;

  let streetUpkeepRaw = 0;
  let avenueUpkeepRaw = 0;
  let busUpkeepRaw = 0;
  let bridgeUpkeepRaw = 0;
  let streetSegments = 0;
  let avenueSegments = 0;
  let busSegments = 0;
  let bridgeSegments = 0;

  for (const s of state.segments) {
    const base = s.tier === 'street' ? 18 : s.tier === 'avenue' ? 35 : 52;
    if (s.isBridge) {
      bridgeUpkeepRaw += base * 1.5;
      bridgeSegments++;
    } else if (s.tier === 'street') {
      streetUpkeepRaw += base;
      streetSegments++;
    } else if (s.tier === 'avenue') {
      avenueUpkeepRaw += base;
      avenueSegments++;
    } else {
      busUpkeepRaw += base;
      busSegments++;
    }
  }

  const streetUpkeep = Math.round(streetUpkeepRaw);
  const avenueUpkeep = Math.round(avenueUpkeepRaw);
  const busUpkeep = Math.round(busUpkeepRaw);
  const bridgeUpkeep = Math.round(bridgeUpkeepRaw);
  const landmarkUpkeep = state.landmarks.length * 140;
  const recurringUpkeep =
    streetUpkeep + avenueUpkeep + busUpkeep + bridgeUpkeep + landmarkUpkeep;

  return {
    residentialTax,
    commercialTax,
    tourismTax,
    industrialTax,
    citizenHeadTax,
    recurringRevenue,
    streetUpkeep,
    avenueUpkeep,
    busUpkeep,
    bridgeUpkeep,
    landmarkUpkeep,
    recurringUpkeep,
    pendingStampAndSalesTax: Math.round(state.pendingBudget.stampAndSalesTax),
    pendingCapitalSpending: Math.round(state.pendingBudget.capitalSpending),
    pendingEventAndGrants: Math.round(state.pendingBudget.eventAndGrants),
    projectedNetRecurring: recurringRevenue - recurringUpkeep,
    unitCounts: {
      residentialBuildings,
      commercialBuildings,
      tourismBuildings,
      industrialBuildings,
      streetSegments,
      avenueSegments,
      busSegments,
      bridgeSegments,
      landmarks: state.landmarks.length,
    },
  };
}

export function assignPlayerRole(
  state: CityState,
  playerId: string,
  requestedRole: PlayerRole,
): { role: PlayerRole; notice?: string } {
  if (requestedRole === 'mayor') {
    const existingMayor = Object.values(state.players).find(
      (p) => p.id !== playerId && p.role === 'mayor',
    );
    if (existingMayor) {
      return {
        role: 'citizen',
        notice: `目前房間已有「${existingMayor.name}」擔任市長，已自動以「市民角色」加入城市`,
      };
    }
  }
  return { role: requestedRole };
}

export function createSimPlayer(
  playerId: string,
  name: string,
  color: string,
  role: PlayerRole = 'citizen',
): SimPlayer {
  return {
    id: playerId,
    name: name.trim().slice(0, 18) || '澳門市民',
    color,
    role,
    x: -6,
    z: -30,
    targetX: -6,
    targetZ: -30,
    heading: 0,
    activity: 'idle',
    activityBubble: role === 'mayor' ? '🏛️ 規劃澳門藍圖' : '探索澳門街區中',
    activityTimer: 0,
    needs: {
      energy: 86,
      hunger: 82,
      fun: 78,
      social: 74,
      comfort: 85,
    },
    wallet: 12000,
    career: { ...CAREER_LADDER[0], xp: 0 },
    ownedParcelIds: [],
    autonomy: role === 'citizen',
    lastActiveAt: Date.now(),
    cursorPos: null,
    emoteText: null,
    emoteExpiresAt: 0,
  };
}

export function recomputeLandValuesAndTraffic(state: CityState): void {
  const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));
  const segMap = new Map(state.segments.map((s) => [s.id, s]));
  computeFloodImpacts(state);
  const floodedRoadSet = new Set(state.weather?.floodedRoadIds || []);
  const floodedBuildingSet = new Set(state.weather?.floodedBuildingIds || []);

  // Count buildings per segment
  const segBuildingDensity = new Map<string, number>();
  for (const p of state.parcels) {
    if (p.buildingId) {
      segBuildingDensity.set(p.segmentId, (segBuildingDensity.get(p.segmentId) || 0) + 1);
    }
  }

  let totalLoadRatio = 0;
  let roundaboutCount = 0;
  let busLaneCount = 0;

  for (const n of state.nodes) {
    if (n.isRoundabout) roundaboutCount++;
  }

  let landmarkTrafficRelief = 0;
  for (const lm of state.landmarks) {
    landmarkTrafficRelief += lm.trafficReliefBonus ?? LANDMARK_SPECS[lm.type]?.trafficReliefBonus ?? 0;
  }
  landmarkTrafficRelief = Math.min(0.42, landmarkTrafficRelief);

  for (const seg of state.segments) {
    if (seg.tier === 'bus_avenue') busLaneCount++;
    const a = nodeMap.get(seg.nodeA);
    const b = nodeMap.get(seg.nodeB);
    const localBuildings = segBuildingDensity.get(seg.id) || 0;

    // Cross-harbor bridges carry heavier inter-district traffic
    const baseFlow = seg.isBridge
      ? 14 + state.buildings.length * 1.45
      : 5 + localBuildings * 5.2 + state.buildings.length * 0.38;

    let junctionRelief = 1.0 - landmarkTrafficRelief;
    if (a?.isRoundabout) junctionRelief -= 0.18;
    if (b?.isRoundabout) junctionRelief -= 0.18;
    if (state.activeModifiers.transitSubsidyTicks > 0) junctionRelief -= 0.12;
    if (state.activeModifiers.trafficPenaltyTicks > 0) junctionRelief += 0.18;

    // Localized transit station / ferry terminal relief for nearby roads
    if (a && b) {
      const midX = (a.x + b.x) * 0.5;
      const midZ = (a.z + b.z) * 0.5;
      let localStationRelief = 0;
      for (const lm of state.landmarks) {
        const spec = LANDMARK_SPECS[lm.type];
        if (spec?.localTrafficRelief && spec.localTrafficRadius) {
          const d = Math.hypot(midX - lm.x, midZ - lm.z);
          if (d < spec.localTrafficRadius) {
            localStationRelief += spec.localTrafficRelief * (1 - (d / spec.localTrafficRadius) * 0.45);
          }
        }
      }
      junctionRelief -= Math.min(0.32, localStationRelief);
    }
    if (floodedRoadSet.has(seg.id)) {
      junctionRelief += 0.38;
    }

    const effectiveFlow = Math.max(2, baseFlow * Math.max(0.38, junctionRelief));
    const cap = ROAD_CAPACITY[seg.tier];
    seg.capacity = cap;
    seg.trafficLoad = Math.min(1.5, effectiveFlow / cap);
    totalLoadRatio += Math.min(1.25, seg.trafficLoad);
  }

  const avgLoad = state.segments.length > 0 ? totalLoadRatio / state.segments.length : 0.2;
  const trafficFlowPct = Math.round(Math.max(18, Math.min(99, 108 - avgLoad * 52)));

  let landValueSum = 0;
  for (const p of state.parcels) {
    let val = 32;
    // Waterfront proximity bonus (natural harbor or sculpted canal waterfront)
    const nearWater =
      (Math.abs(p.z) > 14 && Math.abs(p.z) < 42) ||
      isWaterAt(p.x + 8, p.z, state.terrainEdits) ||
      isWaterAt(p.x - 8, p.z, state.terrainEdits) ||
      isWaterAt(p.x, p.z + 8, state.terrainEdits) ||
      isWaterAt(p.x, p.z - 8, state.terrainEdits);
    if (nearWater) val += 14;
    // Road tier bonus
    const seg = segMap.get(p.segmentId);
    if (seg) {
      if (seg.tier === 'avenue') val += 10;
      if (seg.tier === 'bus_avenue') val += 16;
      if (seg.trafficLoad > 0.95) val -= 9; // congestion penalty
    }
    // Landmark aura & clean sanitation protection
    let hasCleanAura = false;
    for (const lm of state.landmarks) {
      const spec = LANDMARK_SPECS[lm.type];
      const d = Math.hypot(p.x - lm.x, p.z - lm.z);
      if (d < lm.radius) {
        val += lm.landValueBonus * (1 - d / lm.radius);
        if (spec?.cleanAura) hasCleanAura = true;
        if (spec?.nimbyResidential && p.zone === 'residential' && d < 28) {
          val -= spec.nimbyResidential;
        }
      }
    }
    // Nearby industrial penalty / commercial synergy
    for (const b of state.buildings) {
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < 24 && d > 1) {
        if (b.zone === 'industrial' && p.zone === 'residential' && !hasCleanAura) val -= 7;
        if (b.zone === 'tourism') val += 5;
      }
    }
    if (p.buildingId && floodedBuildingSet.has(p.buildingId)) val -= 12;
    if (state.activeModifiers.landBoomTicks > 0) val *= 1.15;
    p.landValue = Math.round(Math.max(12, Math.min(120, val)));
    landValueSum += p.landValue;
  }

  let pop = 0;
  let jobs = 0;
  for (const b of state.buildings) {
    if (b.status !== 'constructing') {
      pop += b.residents;
      jobs += b.jobs;
    }
  }
  for (const lm of state.landmarks) {
    const spec = LANDMARK_SPECS[lm.type];
    pop += lm.populationBonus ?? spec?.populationBonus ?? 0;
    jobs += lm.jobsBonus ?? spec?.jobsBonus ?? 0;
  }

  state.stats.population = pop;
  state.stats.jobs = jobs;
  state.stats.totalBuildings = state.buildings.length;
  state.stats.totalRoads = state.segments.length;
  state.stats.roundaboutCount = roundaboutCount;
  state.stats.busLaneCount = busLaneCount;
  state.stats.unlockedTileCount = state.mapTiles.filter((t) => t.unlocked).length;
  state.stats.trafficFlowPct = trafficFlowPct;
  state.stats.avgLandValue =
    state.parcels.length > 0 ? Math.round(landValueSum / state.parcels.length) : 40;
}

function splitSegmentInState(
  state: CityState,
  segmentId: string,
  splitPos: Vec2,
  newNodeId?: string,
): RoadNode | null {
  const segIndex = state.segments.findIndex((s) => s.id === segmentId);
  if (segIndex === -1) return null;
  const seg = state.segments[segIndex];
  const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));
  const a = nodeMap.get(seg.nodeA);
  const b = nodeMap.get(seg.nodeB);
  if (!a || !b) return null;

  const midNode: RoadNode = {
    id: newNodeId || nextId('n'),
    x: splitPos.x,
    z: splitPos.z,
    isRoundabout: false,
    isBridgeNode: isWaterAt(splitPos.x, splitPos.z, state.terrainEdits),
  };
  state.nodes.push(midNode);

  // Remove old segment and replace with two clean sub-segments
  state.segments.splice(segIndex, 1);
  const len1 = dist2D(a, midNode);
  const len2 = dist2D(midNode, b);

  const seg1: RoadSegment = {
    id: nextId('s'),
    nodeA: a.id,
    nodeB: midNode.id,
    tier: seg.tier,
    isBridge: segmentCrossesWater(a, midNode, state.terrainEdits),
    length: len1,
    trafficLoad: seg.trafficLoad,
    capacity: seg.capacity,
  };
  const seg2: RoadSegment = {
    id: nextId('s'),
    nodeA: midNode.id,
    nodeB: b.id,
    tier: seg.tier,
    isBridge: segmentCrossesWater(midNode, b, state.terrainEdits),
    length: len2,
    trafficLoad: seg.trafficLoad,
    capacity: seg.capacity,
  };

  state.segments.push(seg1, seg2);

  // Rebind parcels from old segment to closest half
  for (const p of state.parcels) {
    if (p.segmentId === seg.id) {
      const d1 = projectPointToSegment(p, a, midNode).dist;
      const d2 = projectPointToSegment(p, midNode, b).dist;
      p.segmentId = d1 <= d2 ? seg1.id : seg2.id;
    }
  }

  return midNode;
}

export function applyBuildRoad(
  state: CityState,
  payload: Extract<ClientAction, { type: 'build_road' }>,
): { ok: boolean; error?: string } {
  const len = dist2D(payload.startPos, payload.endPos);
  if (len < 6) return { ok: false, error: '道路長度過短' };
  if (len > 122) return { ok: false, error: '單段道路過長 (上限 120m)' };

  const spanValid = [0, 0.25, 0.5, 0.75, 1].every((t) =>
    isTileUnlockedAt(
      payload.startPos.x + (payload.endPos.x - payload.startPos.x) * t,
      payload.startPos.z + (payload.endPos.z - payload.startPos.z) * t,
      state.mapTiles,
    ),
  );
  if (!spanValid) {
    return { ok: false, error: '此澳門分區尚未解鎖，請先在「擴展地圖」購買分區' };
  }

  const isBridge = segmentCrossesWater(payload.startPos, payload.endPos, state.terrainEdits);
  const cost = Math.round(len * ROAD_COST_PER_M[payload.tier] * (isBridge ? 1.8 : 1));
  if (state.stats.treasury < cost) {
    return { ok: false, error: `庫房資金不足 (需要 $${cost.toLocaleString()})` };
  }

  let nodeAId = payload.startNodeId || null;
  if (!nodeAId && payload.splitSegmentA) {
    const splitNode = splitSegmentInState(state, payload.splitSegmentA, payload.startPos);
    if (splitNode) nodeAId = splitNode.id;
  }
  if (!nodeAId) {
    const na: RoadNode = {
      id: nextId('n'),
      x: payload.startPos.x,
      z: payload.startPos.z,
      isRoundabout: false,
      isBridgeNode: isWaterAt(payload.startPos.x, payload.startPos.z, state.terrainEdits),
    };
    state.nodes.push(na);
    nodeAId = na.id;
  }

  let nodeBId = payload.endNodeId || null;
  if (!nodeBId && payload.splitSegmentB) {
    const splitNode = splitSegmentInState(state, payload.splitSegmentB, payload.endPos);
    if (splitNode) nodeBId = splitNode.id;
  }
  if (!nodeBId) {
    const nb: RoadNode = {
      id: nextId('n'),
      x: payload.endPos.x,
      z: payload.endPos.z,
      isRoundabout: false,
      isBridgeNode: isWaterAt(payload.endPos.x, payload.endPos.z, state.terrainEdits),
    };
    state.nodes.push(nb);
    nodeBId = nb.id;
  }

  if (nodeAId === nodeBId) return { ok: false, error: '起點與終點不可相同' };

  // Avoid duplicate segment between same nodes
  const duplicate = state.segments.find(
    (s) => (s.nodeA === nodeAId && s.nodeB === nodeBId) || (s.nodeA === nodeBId && s.nodeB === nodeAId),
  );
  if (duplicate) return { ok: false, error: '此路段已存在' };

  const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));
  const a = nodeMap.get(nodeAId)!;
  const b = nodeMap.get(nodeBId)!;

  // Collect ALL existing crossed segments in order along a -> b so every intersection connects
  const crossings: Array<{ segmentId: string; point: Vec2; distFromA: number }> = [];
  for (const existing of state.segments) {
    if (
      existing.nodeA === nodeAId ||
      existing.nodeB === nodeAId ||
      existing.nodeA === nodeBId ||
      existing.nodeB === nodeBId
    ) {
      continue;
    }
    const ea = nodeMap.get(existing.nodeA);
    const eb = nodeMap.get(existing.nodeB);
    if (!ea || !eb) continue;
    const ix = segmentsIntersect(a, b, ea, eb);
    if (ix) {
      const distFromA = dist2D(a, ix);
      if (distFromA > 2.0 && dist2D(ix, b) > 2.0) {
        crossings.push({ segmentId: existing.id, point: ix, distFromA });
      }
    }
  }
  crossings.sort((c1, c2) => c1.distFromA - c2.distFromA);

  state.stats.treasury -= cost;
  state.pendingBudget.capitalSpending += cost;

  if (crossings.length > 0) {
    const chainNodeIds: string[] = [nodeAId];
    let lastPt: Vec2 = a;
    for (const cr of crossings) {
      if (dist2D(lastPt, cr.point) < 1.8) continue;
      const crossNode = splitSegmentInState(state, cr.segmentId, cr.point);
      if (crossNode) {
        chainNodeIds.push(crossNode.id);
        lastPt = cr.point;
      }
    }
    chainNodeIds.push(nodeBId);

    const updatedNodeMap = new Map(state.nodes.map((n) => [n.id, n]));
    for (let i = 0; i < chainNodeIds.length - 1; i++) {
      const u = updatedNodeMap.get(chainNodeIds[i]);
      const v = updatedNodeMap.get(chainNodeIds[i + 1]);
      if (!u || !v || u.id === v.id) continue;
      const seg: RoadSegment = {
        id: nextId('s'),
        nodeA: u.id,
        nodeB: v.id,
        tier: payload.tier,
        isBridge: segmentCrossesWater(u, v, state.terrainEdits),
        length: dist2D(u, v),
        trafficLoad: 0.2,
        capacity: ROAD_CAPACITY[payload.tier],
      };
      state.segments.push(seg);
      state.parcels.push(
        ...generateParcelsForSegment(
          seg,
          updatedNodeMap,
          state.segments,
          state.parcels,
          () => nextId('p'),
          state.mapTiles,
          state.terrainEdits,
        ),
      );
    }
  } else {
    const newSeg: RoadSegment = {
      id: nextId('s'),
      nodeA: nodeAId,
      nodeB: nodeBId,
      tier: payload.tier,
      isBridge,
      length: len,
      trafficLoad: 0.2,
      capacity: ROAD_CAPACITY[payload.tier],
    };
    state.segments.push(newSeg);
    const updatedNodeMap = new Map(state.nodes.map((n) => [n.id, n]));
    const newParcels = generateParcelsForSegment(
      newSeg,
      updatedNodeMap,
      state.segments,
      state.parcels,
      () => nextId('p'),
      state.mapTiles,
      state.terrainEdits,
    );
    state.parcels.push(...newParcels);
  }

  recomputeLandValuesAndTraffic(state);
  evaluateMilestones(state);
  return { ok: true };
}

export function stepMerchants(state: CityState, rng = Math.random): void {
  const tick = state.stats.tick;

  // 1. Advance construction and upgrades on existing buildings
  for (const b of state.buildings) {
    if (b.status === 'constructing') {
      b.buildProgress = Math.min(1, b.buildProgress + 0.22);
      if (b.buildProgress >= 1) {
        b.status = 'active';
        b.buildProgress = 1;
      }
    } else if (b.status === 'upgrading') {
      b.buildProgress = Math.min(1, b.buildProgress + 0.25);
      if (b.buildProgress >= 1) {
        b.status = 'active';
        b.buildProgress = 1;
      }
    }
  }

  // 2. Each simulation tick, 1-2 active merchants scout land parcels to buy, flip, or build!
  const parcelMap = new Map(state.parcels.map((p) => [p.id, p]));
  const merchantMap = new Map(state.merchants.map((m) => [m.id, m]));

  for (const merchant of state.merchants) {
    // Passive investment returns from existing holdings
    merchant.capital += Math.round(merchant.holdingsCount * 160);

    // Try building on an owned empty zoned parcel first
    const ownedEmpty = state.parcels.find(
      (p) => p.ownerMerchantId === merchant.id && !p.buildingId && p.zone !== 'none',
    );
    if (ownedEmpty) {
      const buildCost = 1400 + ownedEmpty.landValue * 18;
      if (merchant.capital >= buildCost && rng() < 0.72) {
        merchant.capital -= buildCost;
        const zone = ownedEmpty.zone as Exclude<ZoneType, 'none'>;
        const bId = nextId('b');
        const building: Building = {
          id: bId,
          parcelId: ownedEmpty.id,
          x: ownedEmpty.x,
          z: ownedEmpty.z,
          angle: ownedEmpty.angle,
          zone,
          level: 1,
          styleVariant: Math.floor(rng() * 3),
          status: 'constructing',
          buildProgress: 0.15,
          residents: zone === 'residential' ? 95 : 0,
          jobs: zone === 'residential' ? 0 : zone === 'tourism' ? 85 : 65,
          taxYield: zone === 'tourism' ? 340 : zone === 'commercial' ? 270 : 195,
          ownerMerchantId: merchant.id,
          builtAtTick: tick,
        };
        ownedEmpty.buildingId = bId;
        state.buildings.push(building);
        merchant.buildingsBuilt += 1;
        merchant.lastActionText = `動工興建 ${zoneLabel(zone)} 樓盤`;
        recordTransaction(state, {
          merchantName: merchant.name,
          counterpartyName: null,
          action: 'build',
          zone,
          amount: buildCost,
          taxPaid: Math.round(buildCost * 0.05),
          x: ownedEmpty.x,
          z: ownedEmpty.z,
          summary: `${merchant.name} 投入 $${buildCost.toLocaleString()} 動工興建${zoneLabel(zone)}建築`,
        });
        continue;
      }
    }

    // Look to BUY an unowned zoned parcel
    const buyCandidates = state.parcels.filter(
      (p) =>
        p.zone !== 'none' &&
        !p.ownerMerchantId &&
        !p.ownerPlayerId &&
        !p.buildingId,
    );

    if (buyCandidates.length > 0 && rng() < 0.58) {
      // Score candidates by merchant focus + land value
      buyCandidates.sort((a, b) => {
        const scoreA = a.landValue + (a.zone === merchant.focus ? 26 : 0);
        const scoreB = b.landValue + (b.zone === merchant.focus ? 26 : 0);
        return scoreB - scoreA;
      });
      const target = buyCandidates[Math.min(buyCandidates.length - 1, Math.floor(rng() * 3))];
      const price = Math.round(900 + target.landValue * 28);
      if (merchant.capital >= price) {
        merchant.capital -= price;
        target.ownerMerchantId = merchant.id;
        target.purchasePrice = price;
        target.tradeCount += 1;
        target.forSale = rng() < merchant.riskAppetite * 0.5;
        merchant.holdingsCount += 1;
        merchant.tradesCompleted += 1;
        const zone = target.zone as Exclude<ZoneType, 'none'>;
        const tax = Math.round(price * 0.12);
        state.stats.treasury += tax;
        state.pendingBudget.stampAndSalesTax += tax;
        merchant.lastActionText = `以 $${price.toLocaleString()} 購入${zoneLabel(zone)}地皮`;
        recordTransaction(state, {
          merchantName: merchant.name,
          counterpartyName: '市政府批地',
          action: 'buy',
          zone,
          amount: price,
          taxPaid: tax,
          x: target.x,
          z: target.z,
          summary: `${merchant.name} 以 $${price.toLocaleString()} 購入${zoneLabel(zone)}地塊 (印花稅 +$${tax})`,
        });
        continue;
      }
    }

    // Look to FLIP/TRADE an existing parcel between merchants when land value rose!
    const flipCandidates = state.parcels.filter(
      (p) =>
        p.zone !== 'none' &&
        p.ownerMerchantId &&
        p.ownerMerchantId !== merchant.id &&
        !p.buildingId &&
        p.tradeCount < 3 &&
        (p.forSale || p.landValue > 54),
    );

    if (flipCandidates.length > 0 && rng() < 0.28 * merchant.riskAppetite) {
      const target = flipCandidates[Math.floor(rng() * flipCandidates.length)];
      const seller = merchantMap.get(target.ownerMerchantId!);
      const marketPrice = Math.round(Math.max(target.purchasePrice * 1.24, 1100 + target.landValue * 34));
      if (seller && merchant.capital >= marketPrice) {
        merchant.capital -= marketPrice;
        seller.capital += marketPrice;
        seller.holdingsCount = Math.max(0, seller.holdingsCount - 1);
        seller.tradesCompleted += 1;
        merchant.holdingsCount += 1;
        merchant.tradesCompleted += 1;
        target.ownerMerchantId = merchant.id;
        target.purchasePrice = marketPrice;
        target.tradeCount += 1;
        target.forSale = false;

        const zone = target.zone as Exclude<ZoneType, 'none'>;
        const tax = Math.round(marketPrice * 0.14);
        state.stats.treasury += tax;
        state.pendingBudget.stampAndSalesTax += tax;
        merchant.lastActionText = `溢價接手 ${seller.name} 的${zoneLabel(zone)}地塊`;
        seller.lastActionText = `高價轉讓地皮套利 +$${marketPrice.toLocaleString()}`;
        recordTransaction(state, {
          merchantName: merchant.name,
          counterpartyName: seller.name,
          action: 'flip',
          zone,
          amount: marketPrice,
          taxPaid: tax,
          x: target.x,
          z: target.z,
          summary: `${merchant.name} 從 ${seller.name} 手中溢價購入${zoneLabel(zone)}地塊 ($${marketPrice.toLocaleString()})`,
        });
        continue;
      }
    }

    // Upgrade high-value active buildings (level 1 -> 2 -> 3)
    const upgradeBuilding = state.buildings.find((b) => {
      if (b.ownerMerchantId !== merchant.id || b.status !== 'active' || b.level >= 3) return false;
      const p = parcelMap.get(b.parcelId);
      return p ? p.landValue >= (b.level === 1 ? 52 : 70) : false;
    });

    if (upgradeBuilding && rng() < 0.26) {
      const upCost = upgradeBuilding.level === 1 ? 2600 : 4800;
      if (merchant.capital >= upCost) {
        merchant.capital -= upCost;
        upgradeBuilding.level = (upgradeBuilding.level + 1) as 2 | 3;
        upgradeBuilding.status = 'upgrading';
        upgradeBuilding.buildProgress = 0.2;
        upgradeBuilding.residents = Math.round(upgradeBuilding.residents * 1.65);
        upgradeBuilding.jobs = Math.round(upgradeBuilding.jobs * 1.55);
        upgradeBuilding.taxYield = Math.round(upgradeBuilding.taxYield * 1.6);
        merchant.lastActionText = `擴建升級 ${zoneLabel(upgradeBuilding.zone)} 至 Lv.${upgradeBuilding.level}`;
        recordTransaction(state, {
          merchantName: merchant.name,
          counterpartyName: null,
          action: 'upgrade',
          zone: upgradeBuilding.zone,
          amount: upCost,
          taxPaid: Math.round(upCost * 0.08),
          x: upgradeBuilding.x,
          z: upgradeBuilding.z,
          summary: `${merchant.name} 投資加建 ${zoneLabel(upgradeBuilding.zone)} 大廈至 Lv.${upgradeBuilding.level}`,
        });
      }
    }
  }
}

function recordTransaction(
  state: CityState,
  tx: Omit<MerchantTransaction, 'id' | 'tick'>,
): void {
  state.transactions.unshift({
    id: nextId('tx'),
    tick: state.stats.tick,
    ...tx,
  });
  if (state.transactions.length > 24) {
    state.transactions.length = 24;
  }
}

export function zoneLabel(z: ZoneType): string {
  switch (z) {
    case 'residential':
      return '住宅';
    case 'commercial':
      return '商業';
    case 'tourism':
      return '文旅娛樂';
    case 'industrial':
      return '科創工業';
    default:
      return '未分區';
  }
}

function assignSimRoadRoute(state: CityState, player: SimPlayer, destX: number, destZ: number, buildingId?: string | null): void {
  const path = findRoadPath(
    { x: player.x, z: player.z },
    { x: destX, z: destZ },
    state.nodes,
    state.segments,
    1,
    state.terrainEdits,
  );
  player.waypoints = path.map((wp) => ({ x: wp.x, z: wp.z }));
  const first = player.waypoints[0];
  player.targetX = first ? first.x : destX;
  player.targetZ = first ? first.z : destZ;
  player.interactingBuildingId = buildingId ?? null;
}

export function applySimAction(
  state: CityState,
  playerId: string,
  action: Extract<ClientAction, { type: 'sim_action' }>,
): { ok: boolean; error?: string } {
  const player = state.players[playerId];
  if (!player) return { ok: false, error: '找不到市民角色' };

  const findNearestBuilding = (zones: Exclude<ZoneType, 'none'>[]) => {
    const candidates = state.buildings.filter((b) => zones.includes(b.zone) && b.status === 'active');
    if (candidates.length === 0) return null;
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z),
    );
    return candidates[0];
  };

  if (action.kind === 'work') {
    const b = findNearestBuilding(['commercial', 'industrial', 'tourism']);
    if (b) {
      assignSimRoadRoute(state, player, b.x, b.z, b.id);
    }
    player.activity = 'working';
    player.activityTimer = 3;
    player.activityBubble = `💼 ${player.career.title}上班中`;
    player.wallet += player.career.salary;
    player.needs.energy = Math.max(10, player.needs.energy - 14);
    player.needs.hunger = Math.max(10, player.needs.hunger - 12);
    player.needs.fun = Math.max(10, player.needs.fun - 8);
    player.career.xp += 45;
    // Check career promotion
    const nextTier = CAREER_LADDER.find((c) => c.level === player.career.level + 1);
    if (nextTier && player.career.xp >= player.career.nextXp) {
      player.career = { ...nextTier, xp: player.career.xp };
      player.activityBubble = `🎉 升職為 ${nextTier.title}！`;
    }
    return { ok: true };
  }

  if (action.kind === 'dine') {
    if (player.wallet < 120) return { ok: false, error: '個人資金不足 ($120)' };
    const b = findNearestBuilding(['commercial', 'tourism']);
    if (b) {
      assignSimRoadRoute(state, player, b.x, b.z, b.id);
    }
    player.wallet -= 120;
    state.stats.treasury += 18; // consumption tax
    state.pendingBudget.stampAndSalesTax += 18;
    player.activity = 'dining';
    player.activityTimer = 2;
    player.activityBubble = '🍜 澳門茶餐廳享用餐點';
    player.needs.hunger = Math.min(100, player.needs.hunger + 38);
    player.needs.comfort = Math.min(100, player.needs.comfort + 12);
    return { ok: true };
  }

  if (action.kind === 'rest') {
    const b = findNearestBuilding(['residential']);
    if (b) {
      assignSimRoadRoute(state, player, b.x, b.z, b.id);
    }
    player.activity = 'resting';
    player.activityTimer = 3;
    player.activityBubble = '🏠 返回住宅休息充電';
    player.needs.energy = Math.min(100, player.needs.energy + 44);
    player.needs.comfort = Math.min(100, player.needs.comfort + 24);
    return { ok: true };
  }

  if (action.kind === 'entertain') {
    if (player.wallet < 180) return { ok: false, error: '個人資金不足 ($180)' };
    const lm = state.landmarks[0];
    const b = findNearestBuilding(['tourism', 'commercial']);
    if (lm) {
      assignSimRoadRoute(state, player, lm.x, lm.z + 4.2, lm.id);
    } else if (b) {
      assignSimRoadRoute(state, player, b.x, b.z, b.id);
    }
    player.wallet -= 180;
    state.stats.treasury += 30;
    state.pendingBudget.stampAndSalesTax += 30;
    player.activity = 'entertaining';
    player.activityTimer = 2;
    player.activityBubble = '🎡 觀光地標漫步娛樂';
    player.needs.fun = Math.min(100, player.needs.fun + 42);
    player.needs.social = Math.min(100, player.needs.social + 14);
    return { ok: true };
  }

  if (action.kind === 'social') {
    const others = Object.values(state.players).filter((p) => p.id !== playerId);
    if (others.length > 0) {
      const nearestOther = others[0];
      assignSimRoadRoute(state, player, nearestOther.x + 2, nearestOther.z + 2, null);
      nearestOther.needs.social = Math.min(100, nearestOther.needs.social + 22);
      nearestOther.activityBubble = `👋 與 ${player.name} 交流中`;
    } else if (state.landmarks.length > 0) {
      assignSimRoadRoute(state, player, state.landmarks[0].x, state.landmarks[0].z + 4.2, state.landmarks[0].id);
    }
    player.activity = 'socializing';
    player.activityTimer = 2;
    player.activityBubble = '🤝 與市民熱絡交流';
    player.needs.social = Math.min(100, player.needs.social + 36);
    player.needs.fun = Math.min(100, player.needs.fun + 10);
    return { ok: true };
  }

  if (action.kind === 'buy_parcel') {
    const candidate = action.targetId
      ? state.parcels.find((p) => p.id === action.targetId)
      : state.parcels.find((p) => p.zone !== 'none' && !p.ownerPlayerId && !p.buildingId);
    if (!candidate) return { ok: false, error: '目前沒有可購買的空置分區地塊' };
    if (!isTileUnlockedAt(candidate.x, candidate.z, state.mapTiles)) {
      return { ok: false, error: '該地塊所在分區尚未解鎖' };
    }
    if (candidate.buildingId) return { ok: false, error: '此地塊已有建築物，無法購買空地' };
    if (candidate.ownerPlayerId === playerId) return { ok: false, error: '您已擁有此地塊' };
    if (candidate.ownerPlayerId) return { ok: false, error: '此地塊已有其他市民持有' };

    const price = Math.round(1100 + candidate.landValue * 28);
    if (player.wallet < price) {
      return { ok: false, error: `個人資金不足 (需要 $${price.toLocaleString()})` };
    }

    let counterpartyName = '公開市場';
    if (candidate.ownerMerchantId) {
      const sellerMerchant = state.merchants.find((m) => m.id === candidate.ownerMerchantId);
      if (sellerMerchant) {
        sellerMerchant.capital += price;
        sellerMerchant.holdingsCount = Math.max(0, sellerMerchant.holdingsCount - 1);
        sellerMerchant.tradesCompleted += 1;
        sellerMerchant.lastActionText = `將空地轉售予市民 (+$${price.toLocaleString()})`;
        counterpartyName = sellerMerchant.name;
      }
    }

    player.wallet -= price;
    candidate.ownerMerchantId = null;
    candidate.ownerPlayerId = playerId;
    candidate.purchasePrice = price;
    candidate.tradeCount += 1;
    player.ownedParcelIds.push(candidate.id);
    assignSimRoadRoute(state, player, candidate.x, candidate.z, candidate.id);
    player.activityBubble = `🏡 個人購地 $${price.toLocaleString()}`;
    const tax = Math.round(price * 0.1);
    state.stats.treasury += tax;
    state.pendingBudget.stampAndSalesTax += tax;
    recordTransaction(state, {
      merchantName: `玩家市民 ${player.name}`,
      counterpartyName,
      action: 'buy',
      zone: candidate.zone === 'none' ? 'residential' : candidate.zone,
      amount: price,
      taxPaid: tax,
      x: candidate.x,
      z: candidate.z,
      summary: `市民 ${player.name} 以個人資金 $${price.toLocaleString()} 向${counterpartyName}買下地塊投資`,
    });
    return { ok: true };
  }

  if (action.kind === 'sell_parcel') {
    const ownedId = action.targetId || player.ownedParcelIds[0];
    const parcel = state.parcels.find((p) => p.id === ownedId && p.ownerPlayerId === playerId);
    if (!parcel) return { ok: false, error: '您目前未持有可出售的地塊' };
    const salePrice = Math.round(Math.max(parcel.purchasePrice * 1.18, 1250 + parcel.landValue * 34));
    player.wallet += salePrice;
    parcel.ownerPlayerId = null;
    player.ownedParcelIds = player.ownedParcelIds.filter((id) => id !== parcel.id);
    player.activityBubble = `💰 售出地產獲利 +$${salePrice.toLocaleString()}`;
    const sellTax = Math.round(salePrice * 0.08);
    state.stats.treasury += sellTax;
    state.pendingBudget.stampAndSalesTax += sellTax;
    recordTransaction(state, {
      merchantName: `玩家市民 ${player.name}`,
      counterpartyName: '澳門地產市場',
      action: 'flip',
      zone: parcel.zone === 'none' ? 'commercial' : parcel.zone,
      amount: salePrice,
      taxPaid: sellTax,
      x: parcel.x,
      z: parcel.z,
      summary: `市民 ${player.name} 轉手出售地塊，成交價 $${salePrice.toLocaleString()}`,
    });
    return { ok: true };
  }

  return { ok: false, error: '未知的市民行動' };
}

export function stepSimPlayers(state: CityState, dtSeconds = 1.0): void {
  const players = Object.values(state.players);
  for (const p of players) {
    if (p.emoteExpiresAt && Date.now() > p.emoteExpiresAt) {
      p.emoteText = null;
      p.emoteExpiresAt = 0;
    }

    // Only Citizen players walk, decay Sims needs, and run Sims autonomy
    if (p.role !== 'citizen') continue;

    // Smooth walking along road-network waypoints toward target
    if (p.waypoints && p.waypoints.length > 0) {
      p.targetX = p.waypoints[0].x;
      p.targetZ = p.waypoints[0].z;
    }
    const dx = p.targetX - p.x;
    const dz = p.targetZ - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.35) {
      const step = Math.min(dist, 9.5 * dtSeconds);
      p.x += (dx / dist) * step;
      p.z += (dz / dist) * step;
      p.heading = Math.atan2(dx, dz);
    } else if (p.waypoints && p.waypoints.length > 0) {
      p.waypoints.shift();
      if (p.waypoints.length > 0) {
        p.targetX = p.waypoints[0].x;
        p.targetZ = p.waypoints[0].z;
      }
    }

    // Proximity social boost when two online Citizen Sims are near each other
    for (const other of players) {
      if (other.id !== p.id && other.role === 'citizen' && Math.hypot(other.x - p.x, other.z - p.z) < 8) {
        p.needs.social = Math.min(100, p.needs.social + 2.5 * dtSeconds);
      }
    }

    // Needs decay slowly
    p.needs.energy = Math.max(5, p.needs.energy - 0.65 * dtSeconds);
    p.needs.hunger = Math.max(5, p.needs.hunger - 0.8 * dtSeconds);
    p.needs.fun = Math.max(5, p.needs.fun - 0.6 * dtSeconds);
    p.needs.social = Math.max(5, p.needs.social - 0.5 * dtSeconds);
    p.needs.comfort = Math.max(15, Math.min(100, (state.stats.happiness + state.stats.avgLandValue) * 0.62));

    if (p.activityTimer > 0) {
      p.activityTimer = Math.max(0, p.activityTimer - dtSeconds);
      if (p.activityTimer === 0) {
        p.activity = 'idle';
        p.activityBubble = '漫步澳門街區';
      }
    }

    // Autonomous Sims AI when enabled and idle
    if (p.autonomy && p.activity === 'idle' && dist < 0.6) {
      if (p.needs.energy < 35) {
        applySimAction(state, p.id, { type: 'sim_action', kind: 'rest' });
      } else if (p.needs.hunger < 38 && p.wallet >= 120) {
        applySimAction(state, p.id, { type: 'sim_action', kind: 'dine' });
      } else if (p.needs.fun < 38 && p.wallet >= 180) {
        applySimAction(state, p.id, { type: 'sim_action', kind: 'entertain' });
      } else if (p.needs.social < 38) {
        applySimAction(state, p.id, { type: 'sim_action', kind: 'social' });
      } else if (p.wallet < 1800) {
        applySimAction(state, p.id, { type: 'sim_action', kind: 'work' });
      }
    }
  }
}

export function stepCitySimulation(state: CityState, rng = Math.random): void {
  if (state.simSpeed === 0 || state.stats.gameOverReason) return;

  state.stats.tick += 1;
  state.stats.day = Math.floor(state.stats.tick / 4) + 1;

  // Tick down modifiers
  if (state.activeModifiers.tourismBoomTicks > 0) state.activeModifiers.tourismBoomTicks--;
  if (state.activeModifiers.trafficPenaltyTicks > 0) state.activeModifiers.trafficPenaltyTicks--;
  if (state.activeModifiers.landBoomTicks > 0) state.activeModifiers.landBoomTicks--;
  if (state.activeModifiers.transitSubsidyTicks > 0) state.activeModifiers.transitSubsidyTicks--;

  // Merchants trade land & construct buildings
  stepMerchants(state, rng);

  // Advance typhoon / monsoon / storm-surge cycle before recomputing flood impacts
  stepCityWeather(state, rng);

  // Recompute land values and traffic network load
  recomputeLandValuesAndTraffic(state);

  // Tick AI-generated 3D dynamic world elements & dynamic quests
  stepDynamicWorldElementsAndQuests(state);
  const dynamicMods = getActiveDynamicModifiers(state);

  // City budget & taxes
  const summary = computeCurrentBudgetSummary(state);
  const income = summary.recurringRevenue + dynamicMods.tourismBonus * 6;
  const roadUpkeep = summary.recurringUpkeep;

  state.stats.lastIncome = income;
  state.stats.lastUpkeep = roadUpkeep;
  state.stats.treasury += income - roadUpkeep;

  // Update Happiness & RCI+Tourism demand (factoring typhoon & flood resilience)
  const weather = state.weather;
  const stormHappinessDelta =
    weather?.phase === 'typhoon_t10'
      ? -14
      : weather?.phase === 'typhoon_t8'
        ? -8
        : weather?.phase === 'monsoon_rain'
          ? -2
          : 0;
  const floodPenalty = (weather?.floodedBuildingIds.length || 0) * 0.6;
  const drainageShieldBonus = Math.min(4, (weather?.drainageProtectionCount || 0) * 0.5);
  const stormTourismDelta =
    weather?.phase === 'typhoon_t10' || weather?.phase === 'typhoon_t8'
      ? -15
      : weather?.phase === 'monsoon_rain'
        ? -5
        : 0;

  const trafficScore = state.stats.trafficFlowPct;
  const landmarkHappinessRaw = state.landmarks.reduce(
    (acc, lm) => acc + (lm.happinessBonus ?? LANDMARK_SPECS[lm.type]?.happinessBonus ?? 3),
    0,
  );
  const landmarkHappiness = Math.min(20, landmarkHappinessRaw);
  const landmarkTourism = state.landmarks.reduce(
    (acc, lm) => acc + Math.round((lm.tourismBonus ?? LANDMARK_SPECS[lm.type]?.tourismBonus ?? 6) * 0.45),
    0,
  );
  const targetHappiness = Math.round(
    Math.max(
      15,
      Math.min(
        99,
        52 +
          (trafficScore - 60) * 0.45 +
          landmarkHappiness +
          dynamicMods.happinessBonus +
          stormHappinessDelta -
          floodPenalty +
          drainageShieldBonus,
      ),
    ),
  );
  state.stats.happiness = Math.round(state.stats.happiness * 0.7 + targetHappiness * 0.3);

  const lmDemand = { residential: 0, commercial: 0, tourism: 0, industrial: 0 };
  for (const lm of state.landmarks) {
    const db = LANDMARK_SPECS[lm.type]?.demandBoost;
    if (!db) continue;
    if (db.residential) lmDemand.residential += db.residential;
    if (db.commercial) lmDemand.commercial += db.commercial;
    if (db.tourism) lmDemand.tourism += db.tourism;
    if (db.industrial) lmDemand.industrial += db.industrial;
  }

  const jobRatio = state.stats.population > 0 ? state.stats.jobs / state.stats.population : 0.7;
  state.stats.demand.residential = Math.round(
    Math.max(15, Math.min(98, 55 + (jobRatio - 0.65) * 45 + (state.stats.happiness - 65) * 0.4 + Math.min(18, lmDemand.residential))),
  );
  state.stats.demand.commercial = Math.round(
    Math.max(15, Math.min(98, 52 + (state.stats.population / 140) * 6 + Math.min(18, lmDemand.commercial))),
  );
  state.stats.demand.tourism = Math.round(
    Math.max(
      20,
      Math.min(
        98,
        50 +
          landmarkTourism +
          (state.activeModifiers.tourismBoomTicks > 0 ? 22 : 0) +
          dynamicMods.tourismBonus +
          Math.min(16, lmDemand.tourism) +
          stormTourismDelta,
      ),
    ),
  );
  state.stats.demand.industrial = Math.round(
    Math.max(15, Math.min(95, 64 - (jobRatio - 0.8) * 35 + Math.min(20, lmDemand.industrial))),
  );

  // Trigger a random Macau city event roughly every 14 ticks if none is active
  if (!state.activeEvent && state.stats.tick > 6 && state.stats.tick % 14 === 0) {
    const idx = Math.floor(rng() * EVENT_CATALOG.length);
    const tpl = EVENT_CATALOG[idx];
    state.activeEvent = {
      ...tpl,
      triggeredAtTick: state.stats.tick,
    };
  }

  // Evaluate Milestones & Check Victory / Bankruptcy
  evaluateMilestones(state);

  // Flush full fiscal ledger snapshot for this tick
  const stampAndSalesTax = Math.round(state.pendingBudget.stampAndSalesTax);
  const capitalSpending = Math.round(state.pendingBudget.capitalSpending);
  const eventAndGrants = Math.round(state.pendingBudget.eventAndGrants);
  const totalRevenue = income + stampAndSalesTax + eventAndGrants;
  const totalSpending = roadUpkeep + capitalSpending;

  state.budgetHistory.push({
    tick: state.stats.tick,
    day: state.stats.day,
    label: `D${state.stats.day}·T${state.stats.tick}`,
    treasury: Math.round(state.stats.treasury),
    residentialTax: summary.residentialTax,
    commercialTax: summary.commercialTax,
    tourismTax: summary.tourismTax,
    industrialTax: summary.industrialTax,
    citizenHeadTax: summary.citizenHeadTax,
    stampAndSalesTax,
    eventAndGrants,
    totalRevenue,
    streetUpkeep: summary.streetUpkeep,
    avenueUpkeep: summary.avenueUpkeep,
    busUpkeep: summary.busUpkeep,
    bridgeUpkeep: summary.bridgeUpkeep,
    landmarkUpkeep: summary.landmarkUpkeep,
    capitalSpending,
    totalSpending,
    netBalance: totalRevenue - totalSpending,
  });
  if (state.budgetHistory.length > 24) {
    state.budgetHistory.splice(0, state.budgetHistory.length - 24);
  }

  state.populationHistory.push({
    tick: state.stats.tick,
    hourLabel: '現在',
    population: state.stats.population,
  });
  if (state.populationHistory.length > 24) {
    state.populationHistory.splice(0, state.populationHistory.length - 24);
  }
  const popLen = state.populationHistory.length;
  for (let i = 0; i < popLen; i++) {
    const hoursAgo = popLen - 1 - i;
    state.populationHistory[i].hourLabel = hoursAgo === 0 ? '現在' : `-${hoursAgo}h`;
  }

  state.pendingBudget = {
    stampAndSalesTax: 0,
    capitalSpending: 0,
    eventAndGrants: 0,
  };

  if (state.stats.treasury < -15000) {
    state.stats.gameOverReason = 'bankruptcy';
  }
}

export function applyResolveEvent(state: CityState, choiceId: string): { ok: boolean } {
  if (!state.activeEvent) return { ok: false };
  const choice = state.activeEvent.choices.find((c) => c.id === choiceId);
  if (!choice) return { ok: false };

  state.stats.treasury += choice.treasuryDelta;
  if (choice.treasuryDelta >= 0) {
    state.pendingBudget.eventAndGrants += choice.treasuryDelta;
  } else {
    state.pendingBudget.capitalSpending += Math.abs(choice.treasuryDelta);
  }
  state.stats.happiness = Math.max(10, Math.min(100, state.stats.happiness + choice.happinessDelta));

  if (choice.trafficReliefDelta > 0) {
    state.activeModifiers.transitSubsidyTicks = 10;
  } else if (choice.trafficReliefDelta < 0) {
    state.activeModifiers.trafficPenaltyTicks = 8;
  }

  if (choice.demandBoost?.tourism) {
    state.activeModifiers.tourismBoomTicks = 10;
  }
  if (choice.landValueMultiplier && choice.landValueMultiplier > 1) {
    state.activeModifiers.landBoomTicks = 10;
  }

  state.eventHistory.unshift(`${state.activeEvent.title}：${choice.label}`);
  if (state.eventHistory.length > 10) state.eventHistory.length = 10;
  state.activeEvent = null;

  recomputeLandValuesAndTraffic(state);
  evaluateMilestones(state);
  return { ok: true };
}

export function applyUnlockTile(
  state: CityState,
  tileId: string,
): { ok: boolean; error?: string } {
  const tile = state.mapTiles.find((t) => t.id === tileId);
  if (!tile) return { ok: false, error: '找不到指定的澳門分區' };
  if (tile.unlocked) return { ok: false, error: `「${tile.name}」已經解鎖` };
  if (!isTileAdjacentToUnlocked(tile, state.mapTiles)) {
    return { ok: false, error: '請先解鎖與已開拓區相鄰的澳門分區' };
  }
  if (state.stats.population < tile.minPopulation) {
    return {
      ok: false,
      error: `城市人口需達 ${tile.minPopulation.toLocaleString()} 人方可解鎖「${tile.name}」`,
    };
  }
  if (state.stats.treasury < tile.unlockCost) {
    return {
      ok: false,
      error: `庫房資金不足 (解鎖「${tile.name}」需要 $${tile.unlockCost.toLocaleString()})`,
    };
  }

  state.stats.treasury -= tile.unlockCost;
  state.pendingBudget.capitalSpending += tile.unlockCost;
  tile.unlocked = true;
  state.stats.unlockedTileCount = state.mapTiles.filter((t) => t.unlocked).length;

  state.chat.push({
    id: nextId('chat'),
    senderId: 'system',
    senderName: '澳門都市規劃局',
    senderColor: '#fbbf24',
    text: `領土擴展：已解鎖「${tile.name}」(${state.stats.unlockedTileCount}/${state.mapTiles.length})！${tile.bonusDescription}`,
    timestamp: Date.now(),
    kind: 'system',
  });
  if (state.chat.length > 40) state.chat.shift();

  recomputeLandValuesAndTraffic(state);
  evaluateMilestones(state);
  return { ok: true };
}

export function evaluateMilestones(state: CityState): void {
  const totalTrades = state.merchants.reduce((acc, m) => acc + m.tradesCompleted + m.buildingsBuilt, 0);
  const unlockedCount = state.mapTiles.filter((t) => t.unlocked).length;

  for (const ms of state.milestones) {
    if (ms.id === 'ms_1') {
      ms.progressRatio = Math.min(1, totalTrades / 6);
      ms.progressText = `${Math.min(6, totalTrades)} / 6 宗交易`;
      if (!ms.completed && totalTrades >= 6) {
        ms.completed = true;
        state.stats.treasury += ms.rewardTreasury;
        state.pendingBudget.eventAndGrants += ms.rewardTreasury;
      }
    } else if (ms.id === 'ms_2') {
      const pop = state.stats.population;
      ms.progressRatio = Math.min(1, pop / 1400);
      ms.progressText = `${pop} / 1,400 人 (滿意度 ${state.stats.happiness}%)`;
      if (!ms.completed && pop >= 1400 && state.stats.happiness >= 70) {
        ms.completed = true;
        state.stats.treasury += ms.rewardTreasury;
        state.pendingBudget.eventAndGrants += ms.rewardTreasury;
      }
    } else if (ms.id === 'ms_3') {
      const rCount = state.stats.roundaboutCount;
      const bCount = state.stats.busLaneCount;
      ms.progressRatio = Math.min(1, (Math.min(2, rCount) + Math.min(2, bCount)) / 4);
      ms.progressText = `圓形地 ${rCount}/2 · 巴士線 ${bCount}/2 · 流暢 ${state.stats.trafficFlowPct}%`;
      if (!ms.completed && rCount >= 2 && bCount >= 2 && state.stats.trafficFlowPct >= 78) {
        ms.completed = true;
        state.stats.treasury += ms.rewardTreasury;
        state.pendingBudget.eventAndGrants += ms.rewardTreasury;
      }
    } else if (ms.id === 'ms_4') {
      ms.progressRatio = Math.min(1, unlockedCount / 6);
      ms.progressText = `已解鎖 ${unlockedCount} / 6 個澳門分區`;
      if (!ms.completed && unlockedCount >= 6) {
        ms.completed = true;
        state.stats.treasury += ms.rewardTreasury;
        state.pendingBudget.eventAndGrants += ms.rewardTreasury;
      }
    } else if (ms.id === 'ms_5') {
      const hasTowerOrPlaza = state.landmarks.some(
        (l) => l.type === 'macau_tower' || l.type === 'lotus_plaza',
      );
      ms.progressRatio = Math.min(1, state.stats.population / 3200);
      ms.progressText = `人口 ${state.stats.population}/3,200 · 地價 ${state.stats.avgLandValue}/62`;
      if (
        !ms.completed &&
        hasTowerOrPlaza &&
        state.stats.population >= 3200 &&
        state.stats.avgLandValue >= 62
      ) {
        ms.completed = true;
        state.stats.treasury += ms.rewardTreasury;
        state.pendingBudget.eventAndGrants += ms.rewardTreasury;
      }
    }
  }
}

export function applyTerraform(
  state: CityState,
  kind: TerrainOpKind,
  x: number,
  z: number,
  customRadius?: number,
): { ok: boolean; error?: string } {
  const spec = TERRAFORM_SPECS[kind];
  if (!spec) return { ok: false, error: '無效的地形改造操作' };
  const radius = customRadius ?? spec.radius;

  if (!isTileUnlockedAt(x, z, state.mapTiles)) {
    return { ok: false, error: '此澳門分區尚未解鎖，請先在「擴展地圖」解鎖' };
  }
  if (Math.abs(x) > 202 || Math.abs(z) > 202) {
    return { ok: false, error: '無法改造地圖邊界以外的水域' };
  }
  if (state.stats.treasury < spec.cost) {
    return { ok: false, error: `庫房資金不足 (需要 $${spec.cost.toLocaleString()})` };
  }

  const currWater = isWaterAt(x, z, state.terrainEdits);
  const currH = terrainHeightAt(x, z, state.terrainEdits);

  if (kind === 'reclaim') {
    const hasNearbyWater =
      currWater ||
      currH < 0.42 ||
      isWaterAt(x + 6, z, state.terrainEdits) ||
      isWaterAt(x - 6, z, state.terrainEdits) ||
      isWaterAt(x, z + 6, state.terrainEdits) ||
      isWaterAt(x, z - 6, state.terrainEdits);
    if (!hasNearbyWater) {
      return { ok: false, error: '「填海造地」請對準海域或海濱淺灘區域使用' };
    }
  }

  // Protect existing buildings, landmarks, and ground roads from sinking or burying
  const buildingClearance = 6.5;
  for (const b of state.buildings) {
    if (Math.hypot(b.x - x, b.z - z) < buildingClearance) {
      return { ok: false, error: '此處鄰近現有建築地基，請避開或先拆除建築再改造地形' };
    }
  }
  for (const lm of state.landmarks) {
    if (Math.hypot(lm.x - x, lm.z - z) < buildingClearance + 1.5) {
      return { ok: false, error: '此處鄰近現有地標設施，請避開地基範圍' };
    }
  }
  if (kind === 'canal' || kind === 'lower' || kind === 'raise') {
    const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));
    for (const seg of state.segments) {
      if (seg.isBridge) continue;
      const a = nodeMap.get(seg.nodeA);
      const b = nodeMap.get(seg.nodeB);
      if (!a || !b) continue;
      const proj = projectPointToSegment({ x, z }, a, b);
      if (proj.dist < 5.5) {
        return { ok: false, error: '請避開現有地面道路進行開鑿或大幅升降地形' };
      }
    }
  }

  const targetHeight =
    kind === 'flatten'
      ? Math.max(0.48, Math.min(3.8, currWater ? 0.48 : currH))
      : kind === 'reclaim'
        ? 0.48
        : kind === 'canal'
          ? -1.65
          : undefined;

  const edit: TerrainEdit = {
    id: nextId('tf'),
    kind,
    x: Math.round(x * 10) / 10,
    z: Math.round(z * 10) / 10,
    radius,
    delta: spec.delta,
    targetHeight,
  };

  state.stats.treasury -= spec.cost;
  state.pendingBudget.capitalSpending += spec.cost;
  state.terrainEdits.push(edit);
  if (state.terrainEdits.length > 180) {
    state.terrainEdits.shift();
  }

  // When land is reclaimed or flattened near existing roads, generate newly eligible roadside parcels!
  if (kind === 'reclaim' || kind === 'flatten' || kind === 'lower') {
    const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));
    for (const seg of state.segments) {
      const a = nodeMap.get(seg.nodeA);
      const b = nodeMap.get(seg.nodeB);
      if (!a || !b) continue;
      const proj = projectPointToSegment({ x, z }, a, b);
      if (proj.dist < radius + 16) {
        const extra = generateParcelsForSegment(
          seg,
          nodeMap,
          state.segments,
          state.parcels,
          () => nextId('p'),
          state.mapTiles,
          state.terrainEdits,
        );
        if (extra.length > 0) {
          state.parcels.push(...extra);
        }
      }
    }
  }

  recomputeLandValuesAndTraffic(state);
  evaluateMilestones(state);
  return { ok: true };
}

export function applyClientAction(
  state: CityState,
  playerId: string,
  action: ClientAction,
): { ok: boolean; error?: string } {
  const actingPlayer = state.players[playerId];
  const isMayorAction =
    action.type === 'set_speed' ||
    action.type === 'build_road' ||
    action.type === 'upgrade_roundabout' ||
    action.type === 'upgrade_bus' ||
    action.type === 'paint_zone' ||
    action.type === 'unlock_tile' ||
    action.type === 'place_landmark' ||
    action.type === 'construct_building' ||
    action.type === 'upgrade_building' ||
    action.type === 'terraform' ||
    action.type === 'bulldoze' ||
    action.type === 'resolve_event' ||
    action.type === 'toggle_ai_director' ||
    action.type === 'trigger_weather';

  if (isMayorAction && actingPlayer && actingPlayer.role !== 'mayor') {
    return { ok: false, error: '此市政操作僅限「市長角色」執行，可於右上切換為市長或協同市長建設' };
  }

  switch (action.type) {
    case 'switch_role': {
      const player = state.players[playerId];
      if (!player) return { ok: false, error: '找不到玩家資料' };
      if (player.role === action.role) return { ok: true };
      if (action.role === 'mayor') {
        const existingMayor = Object.values(state.players).find(
          (p) => p.id !== playerId && p.role === 'mayor',
        );
        if (existingMayor) {
          return {
            ok: false,
            error: `目前已有「${existingMayor.name}」擔任市長角色，每房同時僅限 1 位市長`,
          };
        }
      }
      player.role = action.role;
      player.cursorPos = null;
      player.waypoints = [];
      player.interactingBuildingId = null;
      player.activity = 'idle';
      player.autonomy = action.role === 'citizen';
      player.activityBubble = action.role === 'mayor' ? '🏛️ 市政規劃中' : '🧑 體驗澳門市民生活';
      state.chat.push({
        id: nextId('chat'),
        senderId: 'system',
        senderName: '市政廣播',
        senderColor: '#38bdf8',
        text: `${player.name} 切換為「${action.role === 'mayor' ? '🏛️ 市長角色' : '🧑 市民角色'}」`,
        timestamp: Date.now(),
        kind: 'system',
      });
      if (state.chat.length > 40) state.chat.shift();
      return { ok: true };
    }
    case 'set_speed': {
      state.simSpeed = action.speed;
      return { ok: true };
    }
    case 'build_road': {
      return applyBuildRoad(state, action);
    }
    case 'upgrade_roundabout': {
      const node = state.nodes.find((n) => n.id === action.nodeId);
      if (!node) return { ok: false, error: '找不到路口節點' };
      if (node.isRoundabout) return { ok: false, error: '此路口已是圓形地' };
      if (node.isBridgeNode) return { ok: false, error: '橋面中央無法設置圓形地' };
      if (state.stats.treasury < ROUNDABOUT_COST) {
        return { ok: false, error: `資金不足 (需要 $${ROUNDABOUT_COST.toLocaleString()})` };
      }
      state.stats.treasury -= ROUNDABOUT_COST;
      state.pendingBudget.capitalSpending += ROUNDABOUT_COST;
      node.isRoundabout = true;
      recomputeLandValuesAndTraffic(state);
      evaluateMilestones(state);
      return { ok: true };
    }
    case 'upgrade_bus': {
      const seg = state.segments.find((s) => s.id === action.segmentId);
      if (!seg) return { ok: false, error: '找不到道路路段' };
      if (seg.tier === 'bus_avenue') return { ok: false, error: '此路段已升級為巴士專線' };
      if (state.stats.treasury < BUS_UPGRADE_COST) {
        return { ok: false, error: `資金不足 (需要 $${BUS_UPGRADE_COST.toLocaleString()})` };
      }
      state.stats.treasury -= BUS_UPGRADE_COST;
      state.pendingBudget.capitalSpending += BUS_UPGRADE_COST;
      seg.tier = 'bus_avenue';
      seg.capacity = ROAD_CAPACITY.bus_avenue;
      recomputeLandValuesAndTraffic(state);
      evaluateMilestones(state);
      return { ok: true };
    }
    case 'paint_zone': {
      let changed = 0;
      let blockedByBuilding = 0;
      const costPerParcel = action.zone === 'none' ? 0 : 280;
      for (const pid of action.parcelIds) {
        const parcel = state.parcels.find((p) => p.id === pid);
        if (!parcel) continue;
        if (parcel.buildingId) {
          blockedByBuilding++;
          continue;
        }
        if (parcel.zone === action.zone) continue;
        if (state.stats.treasury < costPerParcel) break;
        state.stats.treasury -= costPerParcel;
        state.pendingBudget.capitalSpending += costPerParcel;
        parcel.zone = action.zone;
        changed++;
      }
      if (changed === 0 && blockedByBuilding > 0 && action.parcelIds.length === 1) {
        return { ok: false, error: '已有建築之地塊不可直接變更分區，請先拆除建築' };
      }
      if (changed === 0 && action.parcelIds.length > 0 && state.stats.treasury < costPerParcel) {
        return { ok: false, error: '庫房資金不足以劃設分區' };
      }
      recomputeLandValuesAndTraffic(state);
      return { ok: true };
    }
    case 'unlock_tile': {
      return applyUnlockTile(state, action.tileId);
    }
    case 'place_landmark': {
      const spec = LANDMARK_SPECS[action.landmarkType];
      if (!spec) return { ok: false, error: '無效建築類型' };
      if (!isTileUnlockedAt(action.x, action.z, state.mapTiles)) {
        return { ok: false, error: '此澳門分區尚未解鎖，請先擴展地圖' };
      }
      const onWater = isWaterAt(action.x, action.z, state.terrainEdits);
      const elev = terrainHeightAt(action.x, action.z, state.terrainEdits);
      if (spec.allowWaterfront) {
        // Waterfront structures (e.g., Ferry Terminal) require shoreline or shallow coastal waters near dry land
        const nearDryLand =
          !onWater ||
          !isWaterAt(action.x + 10, action.z, state.terrainEdits) ||
          !isWaterAt(action.x - 10, action.z, state.terrainEdits) ||
          !isWaterAt(action.x, action.z + 10, state.terrainEdits) ||
          !isWaterAt(action.x, action.z - 10, state.terrainEdits);
        const nearAnyWater =
          onWater ||
          isWaterAt(action.x + 12, action.z, state.terrainEdits) ||
          isWaterAt(action.x - 12, action.z, state.terrainEdits) ||
          isWaterAt(action.x, action.z + 12, state.terrainEdits) ||
          isWaterAt(action.x, action.z - 12, state.terrainEdits);
        if (!nearDryLand || !nearAnyWater || elev > 4.5) {
          return { ok: false, error: '海濱碼頭或貨運港需建於臨海堤岸或近岸水濱' };
        }
      } else if (onWater || elev > 5.5) {
        return { ok: false, error: '此建築需建於平坦陸地（可使用「改造地形」削平或填海）' };
      }
      const tooCloseToLandmark = state.landmarks.some(
        (l) => Math.hypot(l.x - action.x, l.z - action.z) < 8,
      );
      if (tooCloseToLandmark) {
        return { ok: false, error: '距離現有特色建築過近，請留出廣場空間' };
      }
      if (state.stats.treasury < spec.cost) {
        return { ok: false, error: `資金不足 (需要 $${spec.cost.toLocaleString()})` };
      }
      state.stats.treasury -= spec.cost;
      state.pendingBudget.capitalSpending += spec.cost;
      state.landmarks.push({
        id: nextId('lm'),
        type: action.landmarkType,
        name: spec.name,
        x: action.x,
        z: action.z,
        radius: spec.radius,
        landValueBonus: spec.landValueBonus,
        tourismBonus: spec.tourismBonus,
        happinessBonus: spec.happinessBonus,
        taxYield: spec.taxYield,
        trafficReliefBonus: spec.trafficReliefBonus,
        jobsBonus: spec.jobsBonus,
        populationBonus: spec.populationBonus,
      });
      recomputeLandValuesAndTraffic(state);
      evaluateMilestones(state);
      return { ok: true };
    }
    case 'construct_building': {
      const parcel = state.parcels.find((p) => p.id === action.parcelId);
      if (!parcel) return { ok: false, error: '找不到指定地塊' };
      if (parcel.buildingId) return { ok: false, error: '此地塊已有建築物' };
      if (!isTileUnlockedAt(parcel.x, parcel.z, state.mapTiles)) {
        return { ok: false, error: '此地塊所在分區尚未解鎖' };
      }
      const cost = DIRECT_BUILD_COST[action.zone];
      if (!cost) return { ok: false, error: '無效的建築類型' };
      if (state.stats.treasury < cost) {
        return { ok: false, error: `庫房資金不足 (需要 $${cost.toLocaleString()})` };
      }

      state.stats.treasury -= cost;
      state.pendingBudget.capitalSpending += cost;
      parcel.zone = action.zone;
      const bId = nextId('b');
      parcel.buildingId = bId;
      const styleVariant = (state.buildings.length + parcel.x.toFixed(0).length) % 3;
      state.buildings.push({
        id: bId,
        parcelId: parcel.id,
        x: parcel.x,
        z: parcel.z,
        angle: parcel.angle,
        zone: action.zone,
        level: 1,
        styleVariant,
        status: 'active',
        buildProgress: 1,
        residents: action.zone === 'residential' ? 105 : 0,
        jobs: action.zone === 'residential' ? 0 : action.zone === 'tourism' ? 92 : 70,
        taxYield:
          action.zone === 'tourism'
            ? 360
            : action.zone === 'commercial'
              ? 285
              : action.zone === 'industrial'
                ? 240
                : 205,
        ownerMerchantId: 'municipal_direct',
        builtAtTick: state.stats.tick,
      });
      recordTransaction(state, {
        merchantName: '澳門市政工務局',
        counterpartyName: null,
        action: 'build',
        zone: action.zone,
        amount: cost,
        taxPaid: 0,
        x: parcel.x,
        z: parcel.z,
        summary: `市長直接撥款 $${cost.toLocaleString()} 興建${zoneLabel(action.zone)}大樓`,
      });
      recomputeLandValuesAndTraffic(state);
      evaluateMilestones(state);
      return { ok: true };
    }
    case 'upgrade_building': {
      const building = state.buildings.find((b) => b.id === action.buildingId);
      if (!building) return { ok: false, error: '找不到指定建築物' };
      if (building.level >= 3) return { ok: false, error: '此建築已達最高 Lv.3 規模' };
      const upCost = building.level === 1 ? 2800 : 4800;
      if (state.stats.treasury < upCost) {
        return { ok: false, error: `庫房資金不足 (升級需要 $${upCost.toLocaleString()})` };
      }
      state.stats.treasury -= upCost;
      state.pendingBudget.capitalSpending += upCost;
      building.level = (building.level + 1) as 2 | 3;
      building.status = 'active';
      building.buildProgress = 1;
      building.residents = Math.round(building.residents * 1.65);
      building.jobs = Math.round(building.jobs * 1.55);
      building.taxYield = Math.round(building.taxYield * 1.6);
      recomputeLandValuesAndTraffic(state);
      evaluateMilestones(state);
      return { ok: true };
    }
    case 'terraform': {
      return applyTerraform(state, action.kind, action.x, action.z, action.radius);
    }
    case 'bulldoze': {
      if (action.kind === 'building') {
        const bIdx = state.buildings.findIndex((b) => b.id === action.id);
        if (bIdx === -1) return { ok: false };
        const [removed] = state.buildings.splice(bIdx, 1);
        const parcel = state.parcels.find((p) => p.id === removed.parcelId);
        if (parcel) {
          if (parcel.ownerMerchantId) {
            const m = state.merchants.find((mc) => mc.id === parcel.ownerMerchantId);
            if (m) m.holdingsCount = Math.max(0, m.holdingsCount - 1);
          }
          parcel.buildingId = null;
          parcel.ownerMerchantId = null;
        }
        recomputeLandValuesAndTraffic(state);
        return { ok: true };
      }
      if (action.kind === 'landmark') {
        const lIdx = state.landmarks.findIndex((l) => l.id === action.id);
        if (lIdx === -1) return { ok: false };
        state.landmarks.splice(lIdx, 1);
        recomputeLandValuesAndTraffic(state);
        return { ok: true };
      }
      if (action.kind === 'segment') {
        if (state.segments.length <= 2) return { ok: false, error: '請保留基礎對外聯絡道路' };
        const sIdx = state.segments.findIndex((s) => s.id === action.id);
        if (sIdx === -1) return { ok: false };
        state.segments.splice(sIdx, 1);

        const removedParcels = state.parcels.filter((p) => p.segmentId === action.id);
        const removedParcelIds = new Set(removedParcels.map((p) => p.id));
        for (const rp of removedParcels) {
          if (rp.ownerMerchantId) {
            const m = state.merchants.find((mc) => mc.id === rp.ownerMerchantId);
            if (m) m.holdingsCount = Math.max(0, m.holdingsCount - 1);
          }
          if (rp.ownerPlayerId && state.players[rp.ownerPlayerId]) {
            state.players[rp.ownerPlayerId].ownedParcelIds = state.players[
              rp.ownerPlayerId
            ].ownedParcelIds.filter((pid) => pid !== rp.id);
          }
        }
        state.parcels = state.parcels.filter((p) => p.segmentId !== action.id);
        state.buildings = state.buildings.filter((b) => !removedParcelIds.has(b.parcelId));

        // Prune orphaned road nodes with no remaining segments
        const connectedNodeIds = new Set<string>();
        for (const seg of state.segments) {
          connectedNodeIds.add(seg.nodeA);
          connectedNodeIds.add(seg.nodeB);
        }
        state.nodes = state.nodes.filter((n) => connectedNodeIds.has(n.id));

        recomputeLandValuesAndTraffic(state);
        return { ok: true };
      }
      return { ok: false };
    }
    case 'resolve_event': {
      return applyResolveEvent(state, action.choiceId);
    }
    case 'sim_move': {
      const player = state.players[playerId];
      if (!player) return { ok: false };
      if (player.role !== 'citizen') {
        return { ok: false, error: '請切換至「市民角色」以操控角色漫步街區' };
      }
      if (
        !isWalkablePosition(
          { x: action.x, z: action.z },
          state.nodes,
          state.segments,
          state.mapTiles,
          state.terrainEdits,
        )
      ) {
        return { ok: false, error: '市民只可沿陸地、跨海大橋或已解鎖分區步行' };
      }
      const distGoal = Math.hypot(action.x - player.x, action.z - player.z);
      if (distGoal > 11) {
        assignSimRoadRoute(state, player, action.x, action.z, null);
      } else {
        player.waypoints = [{ x: action.x, z: action.z }];
        player.targetX = action.x;
        player.targetZ = action.z;
        player.interactingBuildingId = null;
      }
      player.activity = action.activity || 'walking';
      player.activityBubble = '🚶 沿道路前往目的地';
      player.activityTimer = 2.5;
      return { ok: true };
    }
    case 'sim_action': {
      if (actingPlayer && actingPlayer.role !== 'citizen') {
        return { ok: false, error: '此市民生活互動僅限「市民角色」使用' };
      }
      return applySimAction(state, playerId, action);
    }
    case 'sim_autonomy': {
      const player = state.players[playerId];
      if (!player) return { ok: false };
      player.autonomy = action.enabled;
      return { ok: true };
    }
    case 'sim_emote': {
      const player = state.players[playerId];
      if (!player) return { ok: false };
      player.emoteText = action.emoteText.slice(0, 24);
      player.emoteExpiresAt = Date.now() + 4500;
      player.needs.social = Math.min(100, player.needs.social + 12);
      state.chat.push({
        id: nextId('chat'),
        senderId: player.id,
        senderName: player.name,
        senderColor: player.color,
        text: action.emoteText,
        timestamp: Date.now(),
        kind: 'emote',
      });
      if (state.chat.length > 40) state.chat.shift();
      return { ok: true };
    }
    case 'chat': {
      const player = state.players[playerId];
      if (!player || !action.text.trim()) return { ok: false };
      state.chat.push({
        id: nextId('chat'),
        senderId: player.id,
        senderName: player.name,
        senderColor: player.color,
        text: action.text.trim().slice(0, 140),
        timestamp: Date.now(),
        kind: 'chat',
      });
      if (state.chat.length > 40) state.chat.shift();
      player.needs.social = Math.min(100, player.needs.social + 8);
      return { ok: true };
    }
    case 'cursor': {
      const player = state.players[playerId];
      if (!player) return { ok: false };
      player.cursorPos = action.pos;
      return { ok: true };
    }
    case 'toggle_ai_director': {
      state.aiAutoDirector = Boolean(action.enabled);
      return { ok: true };
    }
    case 'trigger_weather': {
      const w = setWeatherPhase(state, action.phase);
      recomputeLandValuesAndTraffic(state);
      const signalLabel =
        w.typhoonSignal === 0
          ? '除下風球・晴朗天氣'
          : w.typhoonSignal === 3
            ? `三號風球・季風驟雨 (${w.typhoonName})`
            : w.typhoonSignal === 8
              ? `八號烈風或暴風信號 (${w.typhoonName})`
              : `十號颶風信號・特大風暴潮 (${w.typhoonName})`;
      const floodSummary =
        w.floodedRoadIds.length + w.floodedBuildingIds.length > 0
          ? `｜水浸路段 ${w.floodedRoadIds.length} 條、受淹樓宇 ${w.floodedBuildingIds.length} 座`
          : w.surgeLevel > 0.35
            ? '｜受高地勢與防洪淨水設施保護，目前市區零水浸'
            : '';
      state.chat.push({
        id: nextId('chat'),
        senderId: 'system',
        senderName: '澳門地球物理氣象局',
        senderColor: w.typhoonSignal >= 8 ? '#f43f5e' : '#38bdf8',
        text: `天氣信號更新：${signalLabel} · 陣風 ${w.windSpeedKmh} km/h · 風暴潮 +${w.surgeLevel.toFixed(2)}m${floodSummary}`,
        timestamp: Date.now(),
        kind: 'system',
      });
      if (state.chat.length > 40) state.chat.shift();
      return { ok: true };
    }
    default:
      return { ok: false };
  }
}
