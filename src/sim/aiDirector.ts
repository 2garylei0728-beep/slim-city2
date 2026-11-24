import { getTileAt, isTileUnlockedAt, isWaterAt } from './geometry';
import type {
  AiDynamicQuest,
  AiQuestGoalType,
  CityEvent,
  CityState,
  DynamicWorldElement,
  DynamicWorldElementKind,
} from './types';

export interface AiDirectorRawBundle {
  headline: string;
  dynamicElement: {
    kind: DynamicWorldElementKind;
    title: string;
    districtName: string;
    description: string;
    accentColor: string;
    durationTicks: number;
    happinessBonus: number;
    tourismBonus: number;
  };
  quest: {
    title: string;
    description: string;
    goalType: AiQuestGoalType;
    targetDeltaOrFloor: number;
    rewardTreasury: number;
    rewardHappiness: number;
    durationTicks: number;
  };
  event?: {
    title: string;
    category: CityEvent['category'];
    description: string;
    choiceALabel: string;
    choiceAEffectSummary: string;
    choiceATreasuryDelta: number;
    choiceAHappinessDelta: number;
    choiceATrafficRelief: number;
    choiceATourismBoost: boolean;
    choiceBLabel: string;
    choiceBEffectSummary: string;
    choiceBTreasuryDelta: number;
    choiceBHappinessDelta: number;
    choiceBTrafficRelief: number;
    choiceBLandBoom: boolean;
  } | null;
}

export function sanitizeHexColor(raw: string | undefined, fallback = '#38bdf8'): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  return fallback;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function resolveDynamicElementAnchor(
  kind: DynamicWorldElementKind,
  preferredDistrictName: string,
  state: CityState,
): { x: number; z: number; segmentId: string | null; districtName: string } {
  const unlockedTiles = state.mapTiles.filter((t) => t.unlocked);
  const matchedTile =
    unlockedTiles.find(
      (t) =>
        preferredDistrictName &&
        (t.name.includes(preferredDistrictName) || preferredDistrictName.includes(t.name.split('・')[0])),
    ) ||
    unlockedTiles[unlockedTiles.length - 1] ||
    state.mapTiles.find((t) => t.id === 'tile_2_2') ||
    state.mapTiles[0];

  const tileCenterX = (matchedTile.minX + matchedTile.maxX) * 0.5;
  const tileCenterZ = (matchedTile.minZ + matchedTile.maxZ) * 0.5;

  // 1. Parade floats run along an actual road/bridge segment in an unlocked tile
  if (kind === 'parade_float' && state.segments.length > 0) {
    const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));
    const inTargetTile = state.segments.filter((seg) => {
      const a = nodeMap.get(seg.nodeA);
      const b = nodeMap.get(seg.nodeB);
      if (!a || !b) return false;
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      return (
        mx >= matchedTile.minX &&
        mx <= matchedTile.maxX &&
        mz >= matchedTile.minZ &&
        mz <= matchedTile.maxZ
      );
    });
    const pool = inTargetTile.length > 0 ? inTargetTile : state.segments;
    const picked = pool[(state.stats.tick + state.dynamicElements.length) % pool.length];
    const na = nodeMap.get(picked.nodeA);
    const nb = nodeMap.get(picked.nodeB);
    if (na && nb) {
      const mx = (na.x + nb.x) * 0.5;
      const mz = (na.z + nb.z) * 0.5;
      const actualTile = getTileAt(mx, mz, state.mapTiles);
      return {
        x: mx,
        z: mz,
        segmentId: picked.id,
        districtName: actualTile?.name || matchedTile.name,
      };
    }
  }

  // 2. Harbor flotilla glides across open Macau water near an unlocked tile
  if (kind === 'harbor_flotilla') {
    for (let r = 6; r <= 38; r += 6) {
      for (let step = 0; step < 12; step++) {
        const ang = (step / 12) * Math.PI * 2;
        const cx = tileCenterX + Math.cos(ang) * r;
        const cz = tileCenterZ + Math.sin(ang) * r;
        if (isTileUnlockedAt(cx, cz, state.mapTiles) && isWaterAt(cx, cz, state.terrainEdits)) {
          return { x: cx, z: cz, segmentId: null, districtName: matchedTile.name };
        }
      }
    }
    // Starter Macau-Taipa harbor strait fallback
    return { x: 14, z: 6, segmentId: null, districtName: matchedTile.name };
  }

  // 3. Street market / drone show anchor onto dry unlocked land (preferring near buildings/landmarks)
  const drySearchRadii = [0, 8, 16, 24, 32];
  for (const r of drySearchRadii) {
    const steps = r === 0 ? 1 : 10;
    for (let s = 0; s < steps; s++) {
      const ang = (s / steps) * Math.PI * 2;
      const cx = tileCenterX + Math.cos(ang) * r;
      const cz = tileCenterZ + Math.sin(ang) * r;
      if (isTileUnlockedAt(cx, cz, state.mapTiles) && !isWaterAt(cx, cz, state.terrainEdits)) {
        return { x: cx, z: cz, segmentId: null, districtName: matchedTile.name };
      }
    }
  }

  const starterBuilding = state.buildings[0];
  if (starterBuilding) {
    return {
      x: starterBuilding.x,
      z: starterBuilding.z,
      segmentId: null,
      districtName: matchedTile.name,
    };
  }
  return { x: 0, z: -22, segmentId: null, districtName: matchedTile.name };
}

export function buildCityDirectorPromptContext(
  state: CityState,
  customTheme?: string,
): string {
  const unlockedNames = state.mapTiles
    .filter((t) => t.unlocked)
    .map((t) => `${t.name}(${t.subtitle})`)
    .join('、');

  const zoneCounts = {
    residential: state.buildings.filter((b) => b.zone === 'residential').length,
    commercial: state.buildings.filter((b) => b.zone === 'commercial').length,
    tourism: state.buildings.filter((b) => b.zone === 'tourism').length,
    industrial: state.buildings.filter((b) => b.zone === 'industrial').length,
  };

  const activeElements =
    state.dynamicElements.map((e) => `${e.title}[${e.kind}]`).join('、') || '無';

  return [
    `澳門城市即時狀態：`,
    `- 第 ${state.stats.day} 日 (tick ${state.stats.tick})`,
    `- 人口：${state.stats.population} 人，就業：${state.stats.jobs}，滿意度：${state.stats.happiness}%`,
    `- 庫房：$${Math.round(state.stats.treasury).toLocaleString()}，平均地價指數：${state.stats.avgLandValue}`,
    `- 路網流暢度：${state.stats.trafficFlowPct}%，道路段數：${state.stats.totalRoads}（圓形地 ${state.stats.roundaboutCount}、巴士專線 ${state.stats.busLaneCount}）`,
    `- 區域建築分佈：住宅 ${zoneCounts.residential}、商業 ${zoneCounts.commercial}、文旅 ${zoneCounts.tourism}、科創 ${zoneCounts.industrial}`,
    `- 已解鎖澳門分區 (${state.stats.unlockedTileCount}/${state.mapTiles.length})：${unlockedNames}`,
    `- 目前場上動態元素：${activeElements}`,
    customTheme?.trim()
      ? `- 玩家指定創作主題：「${customTheme.trim().slice(0, 80)}」`
      : `- 主題：請依據當前澳門城市發展瓶頸與已解鎖地標，創意設計專屬動態都市活動！`,
  ].join('\n');
}

export function computeAiQuestTarget(
  goalType: AiQuestGoalType,
  rawDeltaOrFloor: number,
  state: CityState,
): number {
  const cleanParam = Math.max(1, Math.round(rawDeltaOrFloor));
  switch (goalType) {
    case 'reach_population':
      return Math.max(state.stats.population + 35, Math.min(state.stats.population + 400, state.stats.population + cleanParam));
    case 'build_buildings':
      return state.stats.totalBuildings + clamp(cleanParam, 1, 5);
    case 'improve_traffic':
      return clamp(Math.max(state.stats.trafficFlowPct + 3, cleanParam), 72, 97);
    case 'unlock_districts':
      return Math.min(
        state.mapTiles.length,
        Math.max(state.stats.unlockedTileCount + 1, state.stats.unlockedTileCount + clamp(cleanParam, 1, 2)),
      );
    case 'treasury_goal':
      return Math.max(
        Math.round(state.stats.treasury + 2500),
        Math.round(state.stats.treasury + clamp(cleanParam, 2500, 22000)),
      );
  }
}

export function evaluateAiQuestProgress(
  quest: AiDynamicQuest,
  state: CityState,
): { ratio: number; text: string; met: boolean } {
  let curr = 0;
  let unit = '';
  switch (quest.goalType) {
    case 'reach_population':
      curr = state.stats.population;
      unit = '人';
      break;
    case 'build_buildings':
      curr = state.stats.totalBuildings;
      unit = '棟';
      break;
    case 'improve_traffic':
      curr = state.stats.trafficFlowPct;
      unit = '%';
      break;
    case 'unlock_districts':
      curr = state.stats.unlockedTileCount;
      unit = '區';
      break;
    case 'treasury_goal':
      curr = Math.round(state.stats.treasury);
      unit = '$';
      break;
  }

  const ratio = quest.targetValue > 0 ? Math.min(1, Math.max(0, curr / quest.targetValue)) : 1;
  const text =
    unit === '$'
      ? `$${curr.toLocaleString()} / $${quest.targetValue.toLocaleString()}`
      : `${curr.toLocaleString()} / ${quest.targetValue.toLocaleString()} ${unit}`;
  return { ratio, text, met: curr >= quest.targetValue };
}

export function applyAiDirectorBundleToState(
  state: CityState,
  raw: AiDirectorRawBundle,
): {
  element: DynamicWorldElement;
  quest: AiDynamicQuest;
  eventApplied: boolean;
} {
  const validKinds: DynamicWorldElementKind[] = [
    'parade_float',
    'drone_show',
    'street_market',
    'harbor_flotilla',
  ];
  const kind: DynamicWorldElementKind = validKinds.includes(raw.dynamicElement.kind)
    ? raw.dynamicElement.kind
    : 'drone_show';

  const anchor = resolveDynamicElementAnchor(kind, raw.dynamicElement.districtName, state);
  const durationTicks = Math.round(clamp(raw.dynamicElement.durationTicks, 10, 24));
  const element: DynamicWorldElement = {
    id: `ai_el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind,
    title: (raw.dynamicElement.title || '澳門AI城市節慶').trim().slice(0, 26),
    districtName: anchor.districtName,
    description: (raw.dynamicElement.description || '由 AI 城市導演即時生成並投放至實景街道。').trim().slice(0, 120),
    accentColor: sanitizeHexColor(raw.dynamicElement.accentColor, '#38bdf8'),
    x: anchor.x,
    z: anchor.z,
    segmentId: anchor.segmentId,
    remainingTicks: durationTicks,
    maxTicks: durationTicks,
    happinessBonus: Math.round(clamp(raw.dynamicElement.happinessBonus, 2, 10)),
    tourismBonus: Math.round(clamp(raw.dynamicElement.tourismBonus, 4, 18)),
    createdByAi: true,
  };

  state.dynamicElements.unshift(element);
  if (state.dynamicElements.length > 4) {
    state.dynamicElements.length = 4;
  }

  const validGoals: AiQuestGoalType[] = [
    'reach_population',
    'build_buildings',
    'improve_traffic',
    'unlock_districts',
    'treasury_goal',
  ];
  const goalType: AiQuestGoalType = validGoals.includes(raw.quest.goalType)
    ? raw.quest.goalType
    : 'reach_population';
  const targetValue = computeAiQuestTarget(goalType, raw.quest.targetDeltaOrFloor, state);
  const quest: AiDynamicQuest = {
    id: `ai_q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: (raw.quest.title || 'AI 都市限時挑戰').trim().slice(0, 28),
    description: (raw.quest.description || '達成動態城市指標以領取市府獎勵。').trim().slice(0, 110),
    goalType,
    targetValue,
    progressText: '',
    progressRatio: 0,
    rewardTreasury: Math.round(clamp(raw.quest.rewardTreasury, 1500, 12000)),
    rewardHappiness: Math.round(clamp(raw.quest.rewardHappiness, 2, 10)),
    completed: false,
    remainingTicks: Math.round(clamp(raw.quest.durationTicks, 12, 32)),
  };
  const initEval = evaluateAiQuestProgress(quest, state);
  quest.progressRatio = initEval.ratio;
  quest.progressText = initEval.text;

  state.aiQuests.unshift(quest);
  if (state.aiQuests.length > 3) {
    state.aiQuests.length = 3;
  }

  let eventApplied = false;
  if (raw.event && !state.activeEvent) {
    const validCategories: CityEvent['category'][] = [
      'festival',
      'weather',
      'market',
      'transit',
      'heritage',
    ];
    const category = validCategories.includes(raw.event.category) ? raw.event.category : 'festival';
    state.activeEvent = {
      id: `ai_evt_${Date.now().toString(36)}`,
      title: (raw.event.title || 'AI 澳門即時政策事件').trim().slice(0, 32),
      category,
      description: (raw.event.description || '城市動態引擎觸發即時決策情境。').trim().slice(0, 140),
      triggeredAtTick: state.stats.tick,
      choices: [
        {
          id: 'ai_choice_a',
          label: (raw.event.choiceALabel || '撥款支持方案').trim().slice(0, 32),
          effectSummary: (raw.event.choiceAEffectSummary || '提升滿意與文旅活力').trim().slice(0, 48),
          treasuryDelta: Math.round(clamp(raw.event.choiceATreasuryDelta, -8000, 8000)),
          happinessDelta: Math.round(clamp(raw.event.choiceAHappinessDelta, -8, 14)),
          trafficReliefDelta: Math.round(clamp(raw.event.choiceATrafficRelief, -10, 16)),
          demandBoost: raw.event.choiceATourismBoost ? { tourism: 16, commercial: 10 } : undefined,
        },
        {
          id: 'ai_choice_b',
          label: (raw.event.choiceBLabel || '市場引導方案').trim().slice(0, 32),
          effectSummary: (raw.event.choiceBEffectSummary || '增加庫房收入與地價動能').trim().slice(0, 48),
          treasuryDelta: Math.round(clamp(raw.event.choiceBTreasuryDelta, -8000, 9000)),
          happinessDelta: Math.round(clamp(raw.event.choiceBHappinessDelta, -8, 14)),
          trafficReliefDelta: Math.round(clamp(raw.event.choiceBTrafficRelief, -10, 16)),
          landValueMultiplier: raw.event.choiceBLandBoom ? 1.12 : undefined,
        },
      ],
    };
    eventApplied = true;
  }

  const cleanHeadline = (raw.headline || `AI 城市導演於「${element.districtName}」啟動「${element.title}」`).trim().slice(0, 120);
  state.aiDirectorHeadline = cleanHeadline;
  state.chat.push({
    id: `ai_news_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    senderId: 'ai_director',
    senderName: '✨ AI 城市導演',
    senderColor: element.accentColor,
    text: `${cleanHeadline}（3D 動態實景「${element.title}」已進駐${element.districtName}）`,
    timestamp: Date.now(),
    kind: 'system',
  });
  if (state.chat.length > 40) state.chat.shift();

  return { element, quest, eventApplied };
}

export function getActiveDynamicModifiers(state: CityState): {
  happinessBonus: number;
  tourismBonus: number;
} {
  let happinessBonus = 0;
  let tourismBonus = 0;
  for (const el of state.dynamicElements) {
    happinessBonus += el.happinessBonus;
    tourismBonus += el.tourismBonus;
  }
  return {
    happinessBonus: Math.min(18, happinessBonus),
    tourismBonus: Math.min(35, tourismBonus),
  };
}

export function stepDynamicWorldElementsAndQuests(state: CityState): void {
  // 1. Tick active 3D dynamic world elements
  const nextElements: DynamicWorldElement[] = [];
  for (const el of state.dynamicElements) {
    el.remainingTicks -= 1;
    if (el.remainingTicks > 0) {
      nextElements.push(el);
    } else {
      state.chat.push({
        id: `ai_end_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        senderId: 'ai_director',
        senderName: '市政活動',
        senderColor: '#94a3b8',
        text: `「${el.title}」於${el.districtName}圓滿落幕`,
        timestamp: Date.now(),
        kind: 'system',
      });
      if (state.chat.length > 40) state.chat.shift();
    }
  }
  state.dynamicElements = nextElements;

  // 2. Evaluate AI dynamic quests & grant completion rewards
  const nextQuests: AiDynamicQuest[] = [];
  for (const q of state.aiQuests) {
    const evalRes = evaluateAiQuestProgress(q, state);
    q.progressRatio = evalRes.ratio;
    q.progressText = evalRes.text;

    if (!q.completed && evalRes.met) {
      q.completed = true;
      q.remainingTicks = Math.min(q.remainingTicks, 4);
      state.stats.treasury += q.rewardTreasury;
      state.pendingBudget.eventAndGrants += q.rewardTreasury;
      state.stats.happiness = Math.min(100, state.stats.happiness + q.rewardHappiness);
      state.chat.push({
        id: `ai_qdone_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        senderId: 'ai_director',
        senderName: '🏆 AI 挑戰達成',
        senderColor: '#fbbf24',
        text: `完成「${q.title}」！獲市政獎勵 +$${q.rewardTreasury.toLocaleString()}、滿意度 +${q.rewardHappiness}%`,
        timestamp: Date.now(),
        kind: 'system',
      });
      if (state.chat.length > 40) state.chat.shift();
      nextQuests.push(q);
      continue;
    }

    q.remainingTicks -= 1;
    if (q.remainingTicks > 0) {
      nextQuests.push(q);
    }
  }
  state.aiQuests = nextQuests;
}
