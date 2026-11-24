export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type PlayerRole = 'mayor' | 'citizen';
export type PlayMode = PlayerRole;

export type RoadTier = 'street' | 'avenue' | 'bus_avenue';

export type ZoneType = 'none' | 'residential' | 'commercial' | 'tourism' | 'industrial';

export type LandmarkType =
  | 'macau_tower'
  | 'lotus_plaza'
  | 'harbor_park'
  | 'ferry_terminal'
  | 'grand_casino_resort'
  | 'heritage_pavilion'
  | 'eco_solar_plant'
  | 'fire_hospital_hub'
  | 'grand_prix_stand'
  | 'coastal_promenade'
  | 'lrt_station'
  | 'university_hub'
  | 'convention_expo'
  | 'port_logistics_depot'
  | 'water_purification_plant'
  | 'macau_art_museum';

export type BuildingCategory = 'landmark' | 'civic' | 'transit' | 'leisure';

export type TerrainOpKind = 'raise' | 'lower' | 'flatten' | 'reclaim' | 'canal';

export interface TerrainEdit {
  id: string;
  kind: TerrainOpKind;
  x: number;
  z: number;
  radius: number;
  delta: number;
  targetHeight?: number;
}

export type ToolMode =
  | 'select'
  | 'road_street'
  | 'road_avenue'
  | 'road_bus'
  | 'upgrade_roundabout'
  | 'upgrade_bus'
  | 'zone_residential'
  | 'zone_commercial'
  | 'zone_tourism'
  | 'zone_industrial'
  | 'landmark_tower'
  | 'landmark_plaza'
  | 'landmark_park'
  | 'landmark_ferry'
  | 'landmark_resort'
  | 'landmark_heritage'
  | 'landmark_solar'
  | 'landmark_hospital'
  | 'landmark_grandprix'
  | 'landmark_ferris'
  | 'landmark_lrt'
  | 'landmark_university'
  | 'landmark_expo'
  | 'landmark_cargo'
  | 'landmark_waterplant'
  | 'landmark_museum'
  | 'build_residential'
  | 'build_commercial'
  | 'build_tourism'
  | 'build_industrial'
  | 'terraform_raise'
  | 'terraform_lower'
  | 'terraform_flatten'
  | 'terraform_reclaim'
  | 'terraform_canal'
  | 'unlock_tile'
  | 'bulldoze';

export interface MapTile {
  id: string;
  col: number;
  row: number;
  name: string;
  subtitle: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  unlocked: boolean;
  unlockCost: number;
  minPopulation: number;
  bonusDescription: string;
}

export type OverlayMode = 'normal' | 'traffic' | 'land_value';

export interface Vec2 {
  x: number;
  z: number;
}

export interface RoadNode {
  id: string;
  x: number;
  z: number;
  isRoundabout: boolean;
  isBridgeNode: boolean;
}

export interface RoadSegment {
  id: string;
  nodeA: string;
  nodeB: string;
  tier: RoadTier;
  isBridge: boolean;
  isTunnel?: boolean;
  tunnelEntryT?: number;
  tunnelExitT?: number;
  builtAtTick?: number;
  length: number;
  trafficLoad: number; // 0..1.5 (1.0 = capacity, >1.0 = congested)
  capacity: number;
}

export interface ZoneParcel {
  id: string;
  segmentId: string;
  x: number;
  z: number;
  angle: number; // radians, facing the road
  width: number;
  depth: number;
  zone: ZoneType;
  landValue: number; // 10..120
  ownerMerchantId: string | null;
  ownerPlayerId: string | null;
  purchasePrice: number;
  buildingId: string | null;
  tradeCount: number;
  forSale: boolean;
}

export type BuildingStatus = 'constructing' | 'active' | 'upgrading';

export interface Building {
  id: string;
  parcelId: string;
  x: number;
  z: number;
  angle: number;
  zone: Exclude<ZoneType, 'none'>;
  level: 1 | 2 | 3;
  styleVariant: number; // 0, 1, 2 for architectural variety
  status: BuildingStatus;
  buildProgress: number; // 0..1
  residents: number;
  jobs: number;
  taxYield: number;
  ownerMerchantId: string;
  builtAtTick: number;
}

export interface PlacedLandmark {
  id: string;
  type: LandmarkType;
  name: string;
  x: number;
  z: number;
  radius: number;
  landValueBonus: number;
  tourismBonus: number;
  happinessBonus?: number;
  taxYield?: number;
  trafficReliefBonus?: number;
  jobsBonus?: number;
  populationBonus?: number;
  builtAtTick?: number;
}

export interface Merchant {
  id: string;
  name: string;
  focus: Exclude<ZoneType, 'none'>;
  color: string;
  capital: number;
  riskAppetite: number; // 0.2 .. 0.9
  holdingsCount: number;
  buildingsBuilt: number;
  tradesCompleted: number;
  lastActionText: string;
}

export interface MerchantTransaction {
  id: string;
  tick: number;
  merchantName: string;
  counterpartyName: string | null;
  action: 'buy' | 'flip' | 'build' | 'upgrade';
  zone: Exclude<ZoneType, 'none'>;
  amount: number;
  taxPaid: number;
  x: number;
  z: number;
  summary: string;
}

export interface EventChoice {
  id: string;
  label: string;
  effectSummary: string;
  treasuryDelta: number;
  happinessDelta: number;
  trafficReliefDelta: number;
  demandBoost?: Partial<Record<Exclude<ZoneType, 'none'>, number>>;
  landValueMultiplier?: number;
}

export interface CityEvent {
  id: string;
  title: string;
  category: 'festival' | 'weather' | 'market' | 'transit' | 'heritage';
  description: string;
  choices: EventChoice[];
  triggeredAtTick: number;
}

export interface MilestoneTask {
  id: string;
  title: string;
  description: string;
  rewardTreasury: number;
  completed: boolean;
  progressText: string;
  progressRatio: number;
}

export type DynamicWorldElementKind =
  | 'parade_float'
  | 'drone_show'
  | 'street_market'
  | 'harbor_flotilla';

export interface DynamicWorldElement {
  id: string;
  kind: DynamicWorldElementKind;
  title: string;
  districtName: string;
  description: string;
  accentColor: string;
  x: number;
  z: number;
  segmentId?: string | null;
  remainingTicks: number;
  maxTicks: number;
  happinessBonus: number;
  tourismBonus: number;
  createdByAi: boolean;
}

export type AiQuestGoalType =
  | 'reach_population'
  | 'build_buildings'
  | 'improve_traffic'
  | 'unlock_districts'
  | 'treasury_goal';

export interface AiDynamicQuest {
  id: string;
  title: string;
  description: string;
  goalType: AiQuestGoalType;
  targetValue: number;
  progressText: string;
  progressRatio: number;
  rewardTreasury: number;
  rewardHappiness: number;
  completed: boolean;
  remainingTicks: number;
}

export interface DemandState {
  residential: number; // 0..100
  commercial: number; // 0..100
  tourism: number; // 0..100
  industrial: number; // 0..100
}

export interface CityStats {
  tick: number;
  day: number;
  treasury: number;
  lastIncome: number;
  lastUpkeep: number;
  population: number;
  jobs: number;
  happiness: number; // 0..100
  trafficFlowPct: number; // 0..100
  avgLandValue: number;
  totalBuildings: number;
  totalRoads: number;
  roundaboutCount: number;
  busLaneCount: number;
  unlockedTileCount: number;
  demand: DemandState;
  gameOverReason: 'victory' | 'bankruptcy' | null;
}

// ============================================
// THE SIMS (模擬人生) + MULTIPLAYER (多人連線)
// ============================================

export type SimActivity =
  | 'idle'
  | 'walking'
  | 'working'
  | 'dining'
  | 'resting'
  | 'entertaining'
  | 'socializing';

export interface SimNeeds {
  energy: number; // 0..100
  hunger: number; // 0..100
  fun: number; // 0..100
  social: number; // 0..100
  comfort: number; // 0..100
}

export interface SimCareer {
  title: string;
  level: 1 | 2 | 3 | 4;
  salary: number;
  xp: number;
  nextXp: number;
}

export interface SimPlayer {
  id: string;
  name: string;
  color: string;
  role: PlayerRole;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  waypoints?: Vec2[];
  interactingBuildingId?: string | null;
  heading: number;
  activity: SimActivity;
  activityBubble: string;
  activityTimer: number;
  needs: SimNeeds;
  wallet: number; // Personal MOP wallet for Sims gameplay & parcel buying
  career: SimCareer;
  ownedParcelIds: string[];
  autonomy: boolean;
  lastActiveAt: number;
  cursorPos: Vec2 | null;
  emoteText: string | null;
  emoteExpiresAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  timestamp: number;
  kind: 'chat' | 'system' | 'emote';
}

export type SnapKind = 'node' | 'segment' | 'angle' | 'parallel' | 'grid' | 'free';

export interface SnapResult {
  pos: Vec2;
  kind: SnapKind;
  snappedNodeId?: string;
  snappedSegmentId?: string;
  guideLine?: { from: Vec2; to: Vec2 };
  secondaryGuideLine?: { from: Vec2; to: Vec2 };
  angleDeg?: number;
  lengthM?: number;
  isBridge?: boolean;
  isTunnel?: boolean;
  valid: boolean;
  reason?: string;
}

export interface BudgetSnapshot {
  tick: number;
  day: number;
  label: string;
  treasury: number;
  residentialTax: number;
  commercialTax: number;
  tourismTax: number;
  industrialTax: number;
  citizenHeadTax: number;
  stampAndSalesTax: number;
  eventAndGrants: number;
  totalRevenue: number;
  streetUpkeep: number;
  avenueUpkeep: number;
  busUpkeep: number;
  bridgeUpkeep: number;
  tunnelUpkeep?: number;
  landmarkUpkeep: number;
  capitalSpending: number;
  totalSpending: number;
  netBalance: number;
}

export interface BudgetLedgerAccumulators {
  stampAndSalesTax: number;
  capitalSpending: number;
  eventAndGrants: number;
}

export interface CurrentBudgetSummary {
  residentialTax: number;
  commercialTax: number;
  tourismTax: number;
  industrialTax: number;
  citizenHeadTax: number;
  recurringRevenue: number;
  streetUpkeep: number;
  avenueUpkeep: number;
  busUpkeep: number;
  bridgeUpkeep: number;
  tunnelUpkeep: number;
  landmarkUpkeep: number;
  recurringUpkeep: number;
  pendingStampAndSalesTax: number;
  pendingCapitalSpending: number;
  pendingEventAndGrants: number;
  projectedNetRecurring: number;
  unitCounts: {
    residentialBuildings: number;
    commercialBuildings: number;
    tourismBuildings: number;
    industrialBuildings: number;
    streetSegments: number;
    avenueSegments: number;
    busSegments: number;
    bridgeSegments: number;
    tunnelSegments: number;
    landmarks: number;
  };
}

export interface PopulationPoint {
  tick: number;
  hourLabel: string;
  population: number;
}

export type WeatherPhase = 'clear' | 'monsoon_rain' | 'typhoon_t8' | 'typhoon_t10';

export interface WeatherState {
  phase: WeatherPhase;
  typhoonSignal: 0 | 3 | 8 | 10;
  typhoonName: string;
  windSpeedKmh: number;
  windAngleRad: number;
  rainIntensity: number;
  surgeLevel: number;
  floodedRoadIds: string[];
  floodedBuildingIds: string[];
  drainageProtectionCount: number;
  remainingTicks: number;
  vortexX: number;
  vortexZ: number;
}

export interface CityState {
  roomId: string;
  simSpeed: 0 | 1 | 2 | 3;
  stats: CityStats;
  mapTiles: MapTile[];
  nodes: RoadNode[];
  segments: RoadSegment[];
  parcels: ZoneParcel[];
  buildings: Building[];
  landmarks: PlacedLandmark[];
  merchants: Merchant[];
  transactions: MerchantTransaction[];
  activeEvent: CityEvent | null;
  eventHistory: string[];
  milestones: MilestoneTask[];
  activeModifiers: {
    tourismBoomTicks: number;
    trafficPenaltyTicks: number;
    landBoomTicks: number;
    transitSubsidyTicks: number;
  };
  budgetHistory: BudgetSnapshot[];
  populationHistory: PopulationPoint[];
  pendingBudget: BudgetLedgerAccumulators;
  terrainEdits: TerrainEdit[];
  weather: WeatherState;
  dynamicElements: DynamicWorldElement[];
  aiQuests: AiDynamicQuest[];
  aiDirectorHeadline: string | null;
  aiAutoDirector: boolean;
  players: Record<string, SimPlayer>;
  chat: ChatMessage[];
}

export type ClientAction =
  | { type: 'join'; roomId: string; playerId: string; name: string; color: string; role?: PlayerRole }
  | { type: 'switch_role'; role: PlayerRole }
  | { type: 'set_speed'; speed: 0 | 1 | 2 | 3 }
  | {
      type: 'build_road';
      startPos: Vec2;
      endPos: Vec2;
      startNodeId?: string | null;
      endNodeId?: string | null;
      splitSegmentA?: string | null;
      splitSegmentB?: string | null;
      tier: RoadTier;
    }
  | { type: 'upgrade_roundabout'; nodeId: string }
  | { type: 'upgrade_bus'; segmentId: string }
  | { type: 'paint_zone'; parcelIds: string[]; zone: ZoneType }
  | { type: 'place_landmark'; landmarkType: LandmarkType; x: number; z: number }
  | { type: 'construct_building'; parcelId: string; zone: Exclude<ZoneType, 'none'> }
  | { type: 'upgrade_building'; buildingId: string }
  | { type: 'terraform'; kind: TerrainOpKind; x: number; z: number; radius?: number }
  | { type: 'trigger_weather'; phase: WeatherPhase }
  | { type: 'unlock_tile'; tileId: string }
  | { type: 'bulldoze'; kind: 'segment' | 'building' | 'landmark'; id: string }
  | { type: 'resolve_event'; choiceId: string }
  | { type: 'sim_move'; x: number; z: number; activity?: SimActivity }
  | { type: 'sim_action'; kind: 'work' | 'dine' | 'rest' | 'entertain' | 'social' | 'buy_parcel' | 'sell_parcel'; targetId?: string }
  | { type: 'sim_autonomy'; enabled: boolean }
  | { type: 'sim_emote'; emoteText: string }
  | { type: 'chat'; text: string }
  | { type: 'cursor'; pos: Vec2 | null }
  | { type: 'toggle_ai_director'; enabled: boolean }
  | { type: 'reset_city' };
