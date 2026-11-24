import {
  dist2D,
  isWaterAt,
  projectPointToSegment,
  terrainHeightAt,
} from './geometry';
import type {
  CityState,
  RoadNode,
  RoadSegment,
  TerrainEdit,
  Vec2,
  ZoneType,
} from './types';

export interface NavWaypoint {
  x: number;
  y: number;
  z: number;
  isBridge: boolean;
}

export interface BuildingEntrance {
  buildingId: string;
  zone: Exclude<ZoneType, 'none'> | 'landmark';
  label: string;
  entrancePos: Vec2;
  lookAtPos: Vec2;
  segmentId: string | null;
}

export type NpcActivityState = 'walking' | 'interacting';

export interface NpcCitizen {
  id: string;
  name: string;
  shirtColor: string;
  accessory: 'bag' | 'camera' | 'briefcase' | 'none';
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  walkPhase: number;
  state: NpcActivityState;
  interactTimer: number;
  waypoints: NavWaypoint[];
  waypointIndex: number;
  originLabel: string;
  destLabel: string;
  destZone: Exclude<ZoneType, 'none'> | 'landmark';
  interactionText: string;
  lookAtPos: Vec2;
}

const MACAU_CITIZEN_NAMES = [
  '陳嘉欣',
  '梁志偉',
  '黃思敏',
  '何俊傑',
  '李婉婷',
  '張子軒',
  '譚曉嵐',
  '周柏豪',
  '鄭詠琳',
  '林家樂',
  '吳詩韻',
  '歐陽文',
  '羅佩珊',
  '曾浩然',
  '馮雅詩',
  '鄧國榮',
];

const SHIRT_PALETTE = [
  '#38bdf8',
  '#f59e0b',
  '#34d399',
  '#fb7185',
  '#a78bfa',
  '#22d3ee',
  '#f97316',
  '#eab308',
  '#60a5fa',
  '#f472b6',
];

function roadElevationAt(
  x: number,
  z: number,
  isBridge: boolean,
  terrainEdits?: TerrainEdit[],
): number {
  return isBridge ? 2.34 : terrainHeightAt(x, z, terrainEdits) + 0.16;
}

function findNearestSegmentProj(
  pt: Vec2,
  segments: RoadSegment[],
  nodeMap: Map<string, RoadNode>,
): { seg: RoadSegment; proj: Vec2; t: number; dist: number } | null {
  let best: { seg: RoadSegment; proj: Vec2; t: number; dist: number } | null = null;
  for (const seg of segments) {
    const a = nodeMap.get(seg.nodeA);
    const b = nodeMap.get(seg.nodeB);
    if (!a || !b) continue;
    const res = projectPointToSegment(pt, a, b);
    if (!best || res.dist < best.dist) {
      best = { seg, proj: res.point, t: res.t, dist: res.dist };
    }
  }
  return best;
}

function computeSidewalkOffset(
  a: Vec2,
  b: Vec2,
  seg: RoadSegment,
  sideSign: 1 | -1,
): Vec2 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  // Walk right outside the vehicle lanes on the pedestrian pavement strip
  const roadHalfW = seg.tier === 'street' ? 1.65 : 2.35;
  return {
    x: (-dz / len) * roadHalfW * sideSign,
    z: (dx / len) * roadHalfW * sideSign,
  };
}

/**
 * Finds an authentic road-network + sidewalk path from `start` to `goal`
 * across Macau streets, avenues, roundabouts, and cross-harbor bridges.
 */
export function findRoadPath(
  start: Vec2,
  goal: Vec2,
  nodes: RoadNode[],
  segments: RoadSegment[],
  sidewalkSide: 1 | -1 = 1,
  terrainEdits?: TerrainEdit[],
): NavWaypoint[] {
  if (segments.length === 0 || nodes.length === 0) {
    return [
      {
        x: goal.x,
        y: terrainHeightAt(goal.x, goal.z, terrainEdits) + 0.12,
        z: goal.z,
        isBridge: false,
      },
    ];
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const startSnap = findNearestSegmentProj(start, segments, nodeMap);
  const goalSnap = findNearestSegmentProj(goal, segments, nodeMap);

  if (!startSnap || !goalSnap) {
    return [
      {
        x: goal.x,
        y: terrainHeightAt(goal.x, goal.z, terrainEdits) + 0.12,
        z: goal.z,
        isBridge: false,
      },
    ];
  }

  // Same segment shortcut: walk cleanly along its sidewalk
  if (startSnap.seg.id === goalSnap.seg.id) {
    const a = nodeMap.get(startSnap.seg.nodeA)!;
    const b = nodeMap.get(startSnap.seg.nodeB)!;
    const off = computeSidewalkOffset(a, b, startSnap.seg, sidewalkSide);
    const p1 = { x: startSnap.proj.x + off.x, z: startSnap.proj.z + off.z };
    const p2 = { x: goalSnap.proj.x + off.x, z: goalSnap.proj.z + off.z };
    return [
      {
        x: p1.x,
        y: roadElevationAt(p1.x, p1.z, startSnap.seg.isBridge, terrainEdits),
        z: p1.z,
        isBridge: startSnap.seg.isBridge,
      },
      {
        x: p2.x,
        y: roadElevationAt(p2.x, p2.z, startSnap.seg.isBridge, terrainEdits),
        z: p2.z,
        isBridge: startSnap.seg.isBridge,
      },
      {
        x: goal.x,
        y: terrainHeightAt(goal.x, goal.z, terrainEdits) + 0.1,
        z: goal.z,
        isBridge: false,
      },
    ];
  }

  // Build weighted adjacency graph with virtual __start__ & __goal__ nodes
  type Edge = { to: string; cost: number; seg: RoadSegment };
  const adj = new Map<string, Edge[]>();
  const addEdge = (u: string, v: string, cost: number, seg: RoadSegment) => {
    let list = adj.get(u);
    if (!list) {
      list = [];
      adj.set(u, list);
    }
    list.push({ to: v, cost, seg });
  };

  for (const seg of segments) {
    const a = nodeMap.get(seg.nodeA);
    const b = nodeMap.get(seg.nodeB);
    if (!a || !b) continue;
    const cost = Math.max(0.5, dist2D(a, b));
    addEdge(seg.nodeA, seg.nodeB, cost, seg);
    addEdge(seg.nodeB, seg.nodeA, cost, seg);
  }

  const START_KEY = '__start__';
  const GOAL_KEY = '__goal__';
  const virtualPos = new Map<string, Vec2>();
  virtualPos.set(START_KEY, startSnap.proj);
  virtualPos.set(GOAL_KEY, goalSnap.proj);
  for (const n of nodes) virtualPos.set(n.id, n);

  const sA = nodeMap.get(startSnap.seg.nodeA);
  const sB = nodeMap.get(startSnap.seg.nodeB);
  if (sA && sB) {
    addEdge(START_KEY, sA.id, dist2D(startSnap.proj, sA), startSnap.seg);
    addEdge(START_KEY, sB.id, dist2D(startSnap.proj, sB), startSnap.seg);
  }
  const gA = nodeMap.get(goalSnap.seg.nodeA);
  const gB = nodeMap.get(goalSnap.seg.nodeB);
  if (gA && gB) {
    addEdge(gA.id, GOAL_KEY, dist2D(gA, goalSnap.proj), goalSnap.seg);
    addEdge(gB.id, GOAL_KEY, dist2D(gB, goalSnap.proj), goalSnap.seg);
  }

  // Dijkstra shortest road path
  const distMap = new Map<string, number>([[START_KEY, 0]]);
  const prevNode = new Map<string, { id: string; seg: RoadSegment }>();
  const visited = new Set<string>();
  const queue: string[] = [START_KEY];

  while (queue.length > 0) {
    let bestIdx = 0;
    let bestD = distMap.get(queue[0]) ?? Infinity;
    for (let i = 1; i < queue.length; i++) {
      const d = distMap.get(queue[i]) ?? Infinity;
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const curr = queue.splice(bestIdx, 1)[0];
    if (visited.has(curr)) continue;
    visited.add(curr);
    if (curr === GOAL_KEY) break;

    const edges = adj.get(curr) || [];
    for (const e of edges) {
      if (visited.has(e.to)) continue;
      const nd = bestD + e.cost;
      if (nd < (distMap.get(e.to) ?? Infinity)) {
        distMap.set(e.to, nd);
        prevNode.set(e.to, { id: curr, seg: e.seg });
        queue.push(e.to);
      }
    }
  }

  // Reconstruct chain
  if (!prevNode.has(GOAL_KEY)) {
    // Fallback when two road islands aren't linked yet: walk cleanly along start segment or directly on dry land
    if (isWaterAt((start.x + goal.x) * 0.5, (start.z + goal.z) * 0.5, terrainEdits)) {
      const altNode = sA || sB;
      if (altNode) {
        return [
          {
            x: altNode.x,
            y: roadElevationAt(altNode.x, altNode.z, altNode.isBridgeNode, terrainEdits),
            z: altNode.z,
            isBridge: altNode.isBridgeNode,
          },
        ];
      }
    }
    return [
      {
        x: goal.x,
        y: terrainHeightAt(goal.x, goal.z, terrainEdits) + 0.12,
        z: goal.z,
        isBridge: false,
      },
    ];
  }

  const chain: { id: string; seg: RoadSegment }[] = [];
  let cursor = GOAL_KEY;
  while (cursor !== START_KEY) {
    const p = prevNode.get(cursor);
    if (!p) break;
    chain.push({ id: cursor, seg: p.seg });
    cursor = p.id;
  }
  chain.reverse();

  const waypoints: NavWaypoint[] = [];
  let prevId = START_KEY;
  for (const step of chain) {
    const fromPt = virtualPos.get(prevId);
    const toPt = virtualPos.get(step.id);
    if (!fromPt || !toPt) {
      prevId = step.id;
      continue;
    }
    const off = computeSidewalkOffset(fromPt, toPt, step.seg, sidewalkSide);
    if (waypoints.length === 0) {
      const entryPt = { x: fromPt.x + off.x, z: fromPt.z + off.z };
      waypoints.push({
        x: entryPt.x,
        y: roadElevationAt(entryPt.x, entryPt.z, step.seg.isBridge, terrainEdits),
        z: entryPt.z,
        isBridge: step.seg.isBridge,
      });
    }
    const targetPt = { x: toPt.x + off.x, z: toPt.z + off.z };
    const roadNode = nodeMap.get(step.id);
    // Keep bridge elevation accurate when crossing water nodes
    const isBridgeStep = step.seg.isBridge || Boolean(roadNode?.isBridgeNode);
    waypoints.push({
      x: targetPt.x,
      y: roadElevationAt(targetPt.x, targetPt.z, isBridgeStep, terrainEdits),
      z: targetPt.z,
      isBridge: isBridgeStep,
    });
    prevId = step.id;
  }

  waypoints.push({
    x: goal.x,
    y: terrainHeightAt(goal.x, goal.z, terrainEdits) + 0.1,
    z: goal.z,
    isBridge: false,
  });

  return waypoints;
}

export function getBuildingEntrances(state: CityState): BuildingEntrance[] {
  const entrances: BuildingEntrance[] = [];
  const parcelMap = new Map(state.parcels.map((p) => [p.id, p]));
  const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));

  for (const b of state.buildings) {
    if (b.status === 'constructing') continue;
    const parcel = parcelMap.get(b.parcelId);
    let entranceX = b.x;
    let entranceZ = b.z;

    // Nudge 2.9m toward the adjacent road segment so avatars stand cleanly at the doorway step
    if (parcel) {
      const seg = state.segments.find((s) => s.id === parcel.segmentId);
      const a = seg ? nodeMap.get(seg.nodeA) : null;
      const bNode = seg ? nodeMap.get(seg.nodeB) : null;
      if (a && bNode) {
        const proj = projectPointToSegment({ x: b.x, z: b.z }, a, bNode);
        const dx = proj.point.x - b.x;
        const dz = proj.point.z - b.z;
        const d = Math.hypot(dx, dz) || 1;
        entranceX = b.x + (dx / d) * Math.min(2.9, d * 0.48);
        entranceZ = b.z + (dz / d) * Math.min(2.9, d * 0.48);
      }
    }

    const zoneTitle =
      b.zone === 'residential'
        ? '葡韻住宅大廈'
        : b.zone === 'commercial'
          ? '新口岸商貿中心'
          : b.zone === 'tourism'
            ? '路氹文旅綜合體'
            : '澳琴科創園區';

    entrances.push({
      buildingId: b.id,
      zone: b.zone,
      label: `${zoneTitle} Lv.${b.level}`,
      entrancePos: { x: entranceX, z: entranceZ },
      lookAtPos: { x: b.x, z: b.z },
      segmentId: parcel?.segmentId ?? null,
    });
  }

  for (const lm of state.landmarks) {
    const snap = findNearestSegmentProj({ x: lm.x, z: lm.z }, state.segments, nodeMap);
    let ex = lm.x;
    let ez = lm.z + 4.4;
    if (snap) {
      const dx = snap.proj.x - lm.x;
      const dz = snap.proj.z - lm.z;
      const d = Math.hypot(dx, dz) || 1;
      ex = lm.x + (dx / d) * Math.min(4.6, d * 0.6);
      ez = lm.z + (dz / d) * Math.min(4.6, d * 0.6);
    }
    entrances.push({
      buildingId: lm.id,
      zone: 'landmark',
      label: lm.name,
      entrancePos: { x: ex, z: ez },
      lookAtPos: { x: lm.x, z: lm.z },
      segmentId: snap?.seg.id ?? null,
    });
  }

  return entrances;
}

function interactionBubbleForZone(
  zone: Exclude<ZoneType, 'none'> | 'landmark',
  rng: () => number,
): string {
  switch (zone) {
    case 'residential':
      return rng() < 0.5 ? '🏠 返家歇息' : '👋 鄰里寒暄';
    case 'commercial':
      return rng() < 0.5 ? '🛍️ 採購消費' : '💼 商務洽談';
    case 'tourism':
      return rng() < 0.5 ? '🍜 品嚐美食' : '✨ 度假觀光';
    case 'industrial':
      return rng() < 0.5 ? '🔬 科創研發' : '📦 物流值班';
    case 'landmark':
      return rng() < 0.5 ? '📸 地標打卡' : '🌳 海濱散步';
  }
}

export function computeTargetNpcCount(state: CityState): number {
  return Math.min(30, Math.max(10, state.buildings.length * 3 + state.landmarks.length * 2));
}

function assignNewTrip(
  npc: NpcCitizen,
  state: CityState,
  entrances: BuildingEntrance[],
  sideSign: 1 | -1,
  rng: () => number,
): void {
  if (entrances.length >= 2) {
    const dest = entrances[Math.floor(rng() * entrances.length)];
    const path = findRoadPath(
      { x: npc.x, z: npc.z },
      dest.entrancePos,
      state.nodes,
      state.segments,
      sideSign,
      state.terrainEdits,
    );
    npc.originLabel = npc.destLabel || '澳門街區';
    npc.destLabel = dest.label;
    npc.destZone = dest.zone;
    npc.lookAtPos = dest.lookAtPos;
    npc.interactionText = interactionBubbleForZone(dest.zone, rng);
    npc.waypoints = path;
    npc.waypointIndex = 0;
    npc.state = 'walking';
    return;
  }

  // Fallback walk along road nodes if fewer than 2 active buildings
  if (state.nodes.length >= 2) {
    const n = state.nodes[Math.floor(rng() * state.nodes.length)];
    npc.waypoints = findRoadPath(
      { x: npc.x, z: npc.z },
      n,
      state.nodes,
      state.segments,
      sideSign,
      state.terrainEdits,
    );
    npc.waypointIndex = 0;
    npc.destLabel = '澳門街道';
    npc.destZone = 'landmark';
    npc.lookAtPos = { x: n.x, z: n.z };
    npc.interactionText = '🚶 漫步街區';
    npc.state = 'walking';
  }
}

export function createNpcCitizen(
  id: string,
  index: number,
  state: CityState,
  rng: () => number = Math.random,
): NpcCitizen {
  const entrances = getBuildingEntrances(state);
  const startEntrance =
    entrances.length > 0
      ? entrances[index % entrances.length]
      : null;
  const fallbackNode = state.nodes[index % Math.max(1, state.nodes.length)] || { x: 0, z: -30 };
  const startPt = startEntrance ? startEntrance.entrancePos : { x: fallbackNode.x, z: fallbackNode.z };

  const accessories: NpcCitizen['accessory'][] = ['bag', 'camera', 'briefcase', 'none'];
  const npc: NpcCitizen = {
    id,
    name: MACAU_CITIZEN_NAMES[index % MACAU_CITIZEN_NAMES.length],
    shirtColor: SHIRT_PALETTE[index % SHIRT_PALETTE.length],
    accessory: accessories[index % accessories.length],
    x: startPt.x,
    y: terrainHeightAt(startPt.x, startPt.z, state.terrainEdits) + 0.1,
    z: startPt.z,
    heading: 0,
    speed: 3.6 + (index % 5) * 0.38,
    walkPhase: index * 0.9,
    state: 'walking',
    interactTimer: 0,
    waypoints: [],
    waypointIndex: 0,
    originLabel: startEntrance?.label || '中區湖畔',
    destLabel: startEntrance?.label || '澳門街區',
    destZone: startEntrance?.zone || 'residential',
    interactionText: '🚶 漫步澳門',
    lookAtPos: startEntrance?.lookAtPos || { x: 0, z: -30 },
  };

  assignNewTrip(npc, state, entrances, index % 2 === 0 ? 1 : -1, rng);
  // Pre-advance partway along the first path so at t=0 the city streets already have pedestrians mid-stride
  if (npc.waypoints.length >= 2) {
    const segIdx = index % (npc.waypoints.length - 1);
    const a = npc.waypoints[segIdx];
    const b = npc.waypoints[segIdx + 1];
    const blend = 0.2 + (index % 4) * 0.18;
    npc.x = a.x + (b.x - a.x) * blend;
    npc.y = a.y + (b.y - a.y) * blend;
    npc.z = a.z + (b.z - a.z) * blend;
    npc.heading = Math.atan2(b.x - a.x, b.z - a.z);
    npc.waypointIndex = segIdx + 1;
  }

  return npc;
}

export function stepNpcCitizens(
  npcs: NpcCitizen[],
  state: CityState,
  dt: number,
  rng: () => number = Math.random,
  entrancesCache?: BuildingEntrance[],
): void {
  if (state.simSpeed === 0) return;
  const speedMul = state.simSpeed === 1 ? 1 : state.simSpeed === 2 ? 1.65 : 2.35;
  const stepDt = dt * speedMul;
  const entrances = entrancesCache ?? getBuildingEntrances(state);

  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    if (npc.state === 'interacting') {
      npc.interactTimer -= stepDt;
      // Face the building/landmark smoothly while interacting
      const targetAngle = Math.atan2(npc.lookAtPos.x - npc.x, npc.lookAtPos.z - npc.z);
      const diff = Math.atan2(Math.sin(targetAngle - npc.heading), Math.cos(targetAngle - npc.heading));
      npc.heading += diff * Math.min(1, stepDt * 7);

      if (npc.interactTimer <= 0) {
        assignNewTrip(npc, state, entrances, i % 2 === 0 ? 1 : -1, rng);
      }
      continue;
    }

    // Walking along navigation waypoints
    const target = npc.waypoints[npc.waypointIndex];
    if (!target) {
      npc.state = 'interacting';
      npc.interactTimer = 2.4 + rng() * 2.2;
      continue;
    }

    const dx = target.x - npc.x;
    const dz = target.z - npc.z;
    const dist = Math.hypot(dx, dz);
    const moveStep = npc.speed * stepDt;

    if (dist <= moveStep + 0.18) {
      npc.x = target.x;
      npc.y = target.y;
      npc.z = target.z;
      npc.waypointIndex += 1;
      if (npc.waypointIndex >= npc.waypoints.length) {
        npc.state = 'interacting';
        npc.interactTimer = 2.6 + rng() * 2.4;
      }
    } else {
      const ratio = moveStep / dist;
      npc.x += dx * ratio;
      npc.y += (target.y - npc.y) * Math.min(1, ratio * 2.2);
      npc.z += dz * ratio;
      const targetHeading = Math.atan2(dx, dz);
      const diff = Math.atan2(Math.sin(targetHeading - npc.heading), Math.cos(targetHeading - npc.heading));
      npc.heading += diff * Math.min(1, stepDt * 11);
      npc.walkPhase += moveStep * 2.5;
    }
  }
}
