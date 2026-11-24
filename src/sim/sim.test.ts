import test from 'node:test';
import assert from 'node:assert/strict';
import { findRoadSnap } from './geometry';
import {
  applyClientAction,
  assignPlayerRole,
  createInitialCityState,
  createSimPlayer,
  recomputeLandValuesAndTraffic,
  stepCitySimulation,
  stepMerchants,
  stepSimPlayers,
} from './economy';

test('road snapping aligns to endpoints, T-junction segments, and 90-degree angles', () => {
  const state = createInitialCityState('test-room');

  // 1. Endpoint snap near n_1 (-32, -30)
  const nodeSnap = findRoadSnap(
    { x: -30.8, z: -28.9 },
    null,
    null,
    state.nodes,
    state.segments,
    true,
    state.mapTiles,
  );
  assert.equal(nodeSnap.kind, 'node');
  assert.equal(nodeSnap.snappedNodeId, 'n_1');
  assert.equal(nodeSnap.pos.x, -32);
  assert.equal(nodeSnap.pos.z, -30);

  // 2. Segment T-junction snap near middle of s_1 (-16, -30)
  const segSnap = findRoadSnap(
    { x: -16, z: -28.5 },
    { x: -16, z: -40 },
    null,
    state.nodes,
    state.segments,
    true,
    state.mapTiles,
  );
  assert.equal(segSnap.kind, 'segment');
  assert.equal(segSnap.snappedSegmentId, 's_1');
  assert.ok(Math.abs(segSnap.pos.z - -30) < 0.01);

  // 3. 90-degree angle snap from start node n_1 (-32, -30) heading north
  const angleSnap = findRoadSnap(
    { x: -30.5, z: -40.2 },
    { x: -32, z: -30 },
    'n_1',
    state.nodes,
    state.segments,
    true,
    state.mapTiles,
  );
  assert.ok(angleSnap.kind === 'angle' || angleSnap.kind === 'parallel');
  assert.equal(Math.round(angleSnap.angleDeg || 0), 270);
});

test('building a road splits T-junctions and generates non-overlapping roadside parcels', () => {
  const state = createInitialCityState('test-room');
  const initialRoads = state.segments.length;
  const initialParcels = state.parcels.length;

  const res = applyClientAction(state, 'p1', {
    type: 'build_road',
    startPos: { x: 8, z: 28 },
    endPos: { x: -30, z: 36 },
    splitSegmentA: 's_6',
    tier: 'avenue',
  });

  assert.equal(res.ok, true);
  // s_6 splits into 2 + new segment = +2 total segments
  assert.equal(state.segments.length, initialRoads + 2);
  assert.ok(state.parcels.length > initialParcels);
});

test('traffic upgrades (roundabout & bus lane) relieve road congestion', () => {
  const state = createInitialCityState('test-room');
  // Add many buildings to stress segment s_1
  for (let i = 0; i < 14; i++) {
    state.buildings.push({
      id: `test_b_${i}`,
      parcelId: state.parcels[0].id,
      x: -20 + i,
      z: -30,
      angle: 0,
      zone: 'commercial',
      level: 2,
      styleVariant: 0,
      status: 'active',
      buildProgress: 1,
      residents: 0,
      jobs: 80,
      taxYield: 300,
      ownerMerchantId: 'm_namvan',
      builtAtTick: 0,
    });
  }
  recomputeLandValuesAndTraffic(state);
  const segBefore = state.segments.find((s) => s.id === 's_1')!;
  const loadBefore = segBefore.trafficLoad;

  // Upgrade node n_1 to roundabout and segment s_1 to bus_avenue
  const r1 = applyClientAction(state, 'p1', { type: 'upgrade_roundabout', nodeId: 'n_1' });
  const r2 = applyClientAction(state, 'p1', { type: 'upgrade_bus', segmentId: 's_1' });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);

  const segAfter = state.segments.find((s) => s.id === 's_1')!;
  assert.ok(segAfter.trafficLoad < loadBefore);
  assert.equal(segAfter.tier, 'bus_avenue');
});

test('autonomous merchants buy zoned parcels, pay tax, construct buildings, and flip land', () => {
  const state = createInitialCityState('test-room');
  // Zone empty parcels
  const unzonedIds = state.parcels.filter((p) => p.zone === 'none').slice(0, 6).map((p) => p.id);
  applyClientAction(state, 'p1', { type: 'paint_zone', parcelIds: unzonedIds, zone: 'tourism' });

  const buildingsBefore = state.buildings.length;
  const txBefore = state.transactions.length;

  // Step simulation deterministically with fixed rng favoring purchases/builds
  for (let i = 0; i < 12; i++) {
    state.stats.tick += 1;
    stepMerchants(state, () => 0.1);
  }

  assert.ok(state.transactions.length > txBefore, 'Merchants should record transactions');
  assert.ok(state.buildings.length > buildingsBefore, 'Merchants should construct buildings on zoned land');
  const activeBuilt = state.buildings.filter((b) => b.status === 'active');
  assert.ok(activeBuilt.length > 0, 'Constructed buildings should progress to active');
});

test('Sims citizen actions update needs, wallet, career XP, personal land trading, and multiplayer social', () => {
  const state = createInitialCityState('test-room');
  state.players['sim_1'] = createSimPlayer('sim_1', '小美', '#38bdf8', 'citizen');
  state.players['sim_2'] = createSimPlayer('sim_2', '阿強', '#f59e0b', 'citizen');
  // Place sim_2 right next to sim_1
  state.players['sim_2'].x = state.players['sim_1'].x + 2;
  state.players['sim_2'].z = state.players['sim_1'].z + 1;
  state.players['sim_1'].needs.social = 50;

  // Step players -> social should rise due to proximity
  stepSimPlayers(state, 1.0);
  assert.ok(state.players['sim_1'].needs.social > 50);

  // Work & dine & buy parcel
  const walletStart = state.players['sim_1'].wallet;
  const workRes = applyClientAction(state, 'sim_1', { type: 'sim_action', kind: 'work' });
  assert.equal(workRes.ok, true);
  assert.ok(state.players['sim_1'].wallet > walletStart);
  assert.ok(state.players['sim_1'].career.xp > 0);

  // Zone a free parcel and let Sim buy & sell it personally
  const freeParcel = state.parcels.find((p) => p.zone === 'none')!;
  applyClientAction(state, 'mayor_p', { type: 'paint_zone', parcelIds: [freeParcel.id], zone: 'residential' });
  const buyRes = applyClientAction(state, 'sim_1', {
    type: 'sim_action',
    kind: 'buy_parcel',
    targetId: freeParcel.id,
  });
  assert.equal(buyRes.ok, true);
  assert.equal(state.players['sim_1'].ownedParcelIds.includes(freeParcel.id), true);

  const sellRes = applyClientAction(state, 'sim_1', {
    type: 'sim_action',
    kind: 'sell_parcel',
    targetId: freeParcel.id,
  });
  assert.equal(sellRes.ok, true);
  assert.equal(state.players['sim_1'].ownedParcelIds.includes(freeParcel.id), false);
});

test('city events and milestones resolve and update treasury', () => {
  const state = createInitialCityState('test-room');
  // Advance until an event triggers (tick 14)
  for (let i = 0; i < 15; i++) {
    stepCitySimulation(state, () => 0.15);
  }
  assert.ok(state.activeEvent !== null, 'Random city event should trigger');

  const treasuryBefore = state.stats.treasury;
  const firstChoice = state.activeEvent!.choices[0];
  const res = applyClientAction(state, 'p1', { type: 'resolve_event', choiceId: firstChoice.id });
  assert.equal(res.ok, true);
  assert.equal(state.activeEvent, null);
  assert.equal(state.stats.treasury, treasuryBefore + firstChoice.treasuryDelta);
});

test('progressive full Macau 5x5 map tiles enforce adjacency, population, and unlock expansion building', () => {
  const state = createInitialCityState('test-room');
  assert.equal(state.stats.unlockedTileCount, 1);
  assert.equal(state.mapTiles.length, 25);
  assert.equal(state.mapTiles.find((t) => t.id === 'tile_2_2')?.unlocked, true);

  // Building a road north into locked tile_2_1 (Ruins of St. Paul / Guia Hill) should fail initially
  const blockedRoad = applyClientAction(state, 'p1', {
    type: 'build_road',
    startPos: { x: 0, z: -30 },
    endPos: { x: 0, z: -64 },
    startNodeId: 'n_2',
    tier: 'avenue',
  });
  assert.equal(blockedRoad.ok, false);

  // Non-adjacent corner tile_0_0 (Ilha Verde) cannot be unlocked directly
  const nonAdj = applyClientAction(state, 'p1', { type: 'unlock_tile', tileId: 'tile_0_0' });
  assert.equal(nonAdj.ok, false);

  // Adjacent tile_2_3 (Old Taipa / Cotai North) requires 240 population initially (starter pop is 190)
  const lowPop = applyClientAction(state, 'p1', { type: 'unlock_tile', tileId: 'tile_2_3' });
  assert.equal(lowPop.ok, false);

  // Adjacent tile_2_1 (Ruins of St. Paul's & Guia Hill) requires 0 minPopulation -> unlocks cleanly
  const treasuryBefore = state.stats.treasury;
  const unlockNorth = applyClientAction(state, 'p1', { type: 'unlock_tile', tileId: 'tile_2_1' });
  assert.equal(unlockNorth.ok, true);
  assert.equal(state.stats.unlockedTileCount, 2);
  assert.ok(state.stats.treasury < treasuryBefore);

  // Now building north into tile_2_1 (around x=-26 so it avoids steep Guia peak) succeeds and generates parcels!
  const parcelsBefore = state.parcels.length;
  const allowedRoad = applyClientAction(state, 'p1', {
    type: 'build_road',
    startPos: { x: -26, z: -30 },
    endPos: { x: -26, z: -68 },
    tier: 'avenue',
  });
  assert.equal(allowedRoad.ok, true);
  assert.ok(state.parcels.length > parcelsBefore);
});

test('multiplayer assigns 1 Mayor and Citizen roles and enforces role boundaries', () => {
  const state = createInitialCityState('test-room');

  // First player gets Mayor
  const r1 = assignPlayerRole(state, 'p_mayor', 'mayor');
  assert.equal(r1.role, 'mayor');
  state.players['p_mayor'] = createSimPlayer('p_mayor', '林市長', '#38bdf8', r1.role);

  // Second player requesting Mayor automatically becomes Citizen with notice
  const r2 = assignPlayerRole(state, 'p_citizen', 'mayor');
  assert.equal(r2.role, 'citizen');
  assert.ok(r2.notice);
  state.players['p_citizen'] = createSimPlayer('p_citizen', '陳市民', '#10b981', r2.role);

  // Citizen cannot execute municipal Mayor actions
  const citizenBuild = applyClientAction(state, 'p_citizen', {
    type: 'unlock_tile',
    tileId: 'tile_2_1',
  });
  assert.equal(citizenBuild.ok, false);

  // Mayor cannot execute Citizen Sims actions
  const mayorSimWork = applyClientAction(state, 'p_mayor', {
    type: 'sim_action',
    kind: 'work',
  });
  assert.equal(mayorSimWork.ok, false);

  // Citizen cannot steal Mayor seat while Mayor is active
  const stealRes = applyClientAction(state, 'p_citizen', {
    type: 'switch_role',
    role: 'mayor',
  });
  assert.equal(stealRes.ok, false);

  // Once Mayor steps down to Citizen, the other player can become Mayor!
  const stepDown = applyClientAction(state, 'p_mayor', {
    type: 'switch_role',
    role: 'citizen',
  });
  assert.equal(stepDown.ok, true);
  assert.equal(state.players['p_mayor'].role, 'citizen');

  const claimMayor = applyClientAction(state, 'p_citizen', {
    type: 'switch_role',
    role: 'mayor',
  });
  assert.equal(claimMayor.ok, true);
  assert.equal(state.players['p_citizen'].role, 'mayor');
});

test('budget accounting tracks recurring zone tax, upkeep breakdown, stamp taxes, and capital spending', async () => {
  const { computeCurrentBudgetSummary } = await import('./economy');
  const state = createInitialCityState('test-room');

  assert.ok(state.budgetHistory.length >= 5, 'Starter state should seed opening budget snapshots');
  const initialSummary = computeCurrentBudgetSummary(state);
  assert.ok(initialSummary.residentialTax > 0);
  assert.ok(initialSummary.commercialTax > 0);
  assert.ok(initialSummary.tourismTax > 0);
  assert.ok(initialSummary.bridgeUpkeep > 0, 'Starter bridge upkeep should be tracked separately');
  assert.ok(initialSummary.landmarkUpkeep === 140, 'Starter park landmark upkeep should equal $140');
  assert.equal(
    initialSummary.streetUpkeep +
      initialSummary.avenueUpkeep +
      initialSummary.busUpkeep +
      initialSummary.bridgeUpkeep +
      initialSummary.landmarkUpkeep,
    initialSummary.recurringUpkeep,
  );

  // Mayor unlocks adjacent district & Citizens pay consumption tax -> should accumulate into pendingBudget then flush on tick
  state.players['p_mayor'] = createSimPlayer('p_mayor', '林市長', '#38bdf8', 'mayor');
  state.players['p_cit'] = createSimPlayer('p_cit', '小陳', '#10b981', 'citizen');
  const unlockRes = applyClientAction(state, 'p_mayor', { type: 'unlock_tile', tileId: 'tile_2_1' });
  assert.equal(unlockRes.ok, true);
  const dineRes = applyClientAction(state, 'p_cit', { type: 'sim_action', kind: 'dine' });
  assert.equal(dineRes.ok, true);

  const midSummary = computeCurrentBudgetSummary(state);
  assert.ok(midSummary.pendingCapitalSpending > 0, 'Tile unlock should record pending capital spending');
  assert.equal(midSummary.pendingStampAndSalesTax, 18, 'Citizen dining should record consumption tax');

  const historyBefore = state.budgetHistory.length;
  stepCitySimulation(state, () => 0.9);
  assert.equal(state.budgetHistory.length, historyBefore + 1);
  const latest = state.budgetHistory[state.budgetHistory.length - 1];
  assert.ok(latest.capitalSpending >= 4800);
  assert.ok(latest.stampAndSalesTax >= 18);
  assert.equal(latest.netBalance, latest.totalRevenue - latest.totalSpending);
  assert.equal(state.pendingBudget.capitalSpending, 0, 'Pending accumulators should reset after tick');
});

test('citizen navigation system pathfinds along Macau roads/bridges and interacts with buildings', async () => {
  const {
    computeTargetNpcCount,
    createNpcCitizen,
    findRoadPath,
    getBuildingEntrances,
    stepNpcCitizens,
  } = await import('./navigation');
  const state = createInitialCityState('test-room');

  // 1. Multi-segment road + cross-harbor bridge pathfinding from Peninsula (-32, -16) to Taipa (32, 28)
  const bridgeRoute = findRoadPath(
    { x: -32, z: -16 },
    { x: 32, z: 28 },
    state.nodes,
    state.segments,
    1,
  );
  assert.ok(bridgeRoute.length >= 4, 'Route across peninsula and bridge should traverse multiple road waypoints');
  assert.ok(
    bridgeRoute.some((wp) => wp.isBridge && wp.y > 2.0),
    'Route crossing cross-harbor bridge should elevate waypoints above water onto bridge deck',
  );

  // 2. Building entrance extraction pulls doorway positions toward the adjacent street
  const entrances = getBuildingEntrances(state);
  assert.ok(entrances.length >= 4, 'Starter city should expose active buildings and landmark entrances');

  // 3. NPC Citizen spawns, walks along waypoints, and enters interacting state upon reaching building entrance
  const targetCount = computeTargetNpcCount(state);
  assert.ok(targetCount >= 10);
  const npc = createNpcCitizen('npc_test', 0, state, () => 0.5);
  assert.ok(npc.waypoints.length >= 1);

  let reachedInteraction = false;
  for (let step = 0; step < 260; step++) {
    stepNpcCitizens([npc], state, 0.2, () => 0.5, entrances);
    if (npc.state === 'interacting') {
      reachedInteraction = true;
      break;
    }
  }
  assert.equal(reachedInteraction, true, 'Walking NPC citizen should reach building entrance and interact');

  // 4. Multiplayer SimPlayer also populates road waypoints when executing work/move actions
  state.players['cit_nav'] = createSimPlayer('cit_nav', '阿偉', '#38bdf8', 'citizen');
  state.players['cit_nav'].x = -32;
  state.players['cit_nav'].z = -16;
  const workRes = applyClientAction(state, 'cit_nav', { type: 'sim_action', kind: 'work' });
  assert.equal(workRes.ok, true);
  assert.ok((state.players['cit_nav'].waypoints?.length || 0) >= 2, 'SimPlayer action should assign road waypoints');
});

test('D3 traffic density mapping maps cityState road trafficLoad from green to saturated red', async () => {
  const {
    computeNodeTrafficLoad,
    getTrafficDensityGradientStops,
    mapTrafficLoadToD3Style,
    summarizeTrafficDensity,
  } = await import('./trafficOverlay');

  const freeStyle = mapTrafficLoadToD3Style(0.1);
  const moderateStyle = mapTrafficLoadToD3Style(0.65);
  const heavyStyle = mapTrafficLoadToD3Style(0.95);
  const congestedStyle = mapTrafficLoadToD3Style(1.4);

  // Hue moves from green (~130+) -> yellow/amber (~40-60) -> orange/red (<25) -> pure red (0)
  assert.ok(freeStyle.hue > 115, `Free-flow hue should be green, got ${freeStyle.hue}`);
  assert.ok(moderateStyle.hue > 35 && moderateStyle.hue < 75, `Moderate hue should be amber/yellow, got ${moderateStyle.hue}`);
  assert.ok(heavyStyle.hue < 28, `Heavy hue should approach red, got ${heavyStyle.hue}`);
  assert.ok(congestedStyle.hue <= 2, `Congested hue should reach pure red, got ${congestedStyle.hue}`);

  // Saturation increases monotonically as traffic congestion intensifies
  assert.ok(freeStyle.saturation < moderateStyle.saturation);
  assert.ok(moderateStyle.saturation < heavyStyle.saturation);
  assert.ok(heavyStyle.saturation <= congestedStyle.saturation);
  assert.equal(congestedStyle.saturation, 1);

  // Boundary clamping & gradient stops
  assert.equal(mapTrafficLoadToD3Style(-0.5).hex, mapTrafficLoadToD3Style(0).hex);
  assert.equal(mapTrafficLoadToD3Style(2.5).hex, mapTrafficLoadToD3Style(1.5).hex);
  const stops = getTrafficDensityGradientStops(5);
  assert.equal(stops.length, 5);
  assert.equal(stops[0].offsetPct, 0);
  assert.equal(stops[4].offsetPct, 100);

  // CityState aggregation & bottleneck ranking
  const state = createInitialCityState('test-room');
  state.segments[0].trafficLoad = 1.28;
  state.segments[1].trafficLoad = 0.85;
  const nodeAvg = computeNodeTrafficLoad('n_2', state.segments);
  assert.ok(nodeAvg > 0.4 && nodeAvg < 1.3);

  const summary = summarizeTrafficDensity(state);
  assert.equal(summary.totalSegments, state.segments.length);
  assert.equal(summary.buckets.congested >= 1, true);
  assert.equal(summary.buckets.heavy >= 1, true);
  assert.equal(summary.busiestSegments[0].id, state.segments[0].id);
  assert.equal(summary.busiestSegments[0].loadPct, 128);
});

test('full Macau geography models Peninsula, Zone A, HZMB Island, Taipa, Airport, UM Hengqin, Cotai, and Coloane', async () => {
  const { isWaterAt, MAP_HALF_SIZE, terrainHeightAt } = await import('./geometry');

  assert.equal(MAP_HALF_SIZE, 210);
  // Real land points across all major regions of Macau
  assert.equal(isWaterAt(-80, -175), false, 'Barrier Gate / North Peninsula should be land');
  assert.equal(isWaterAt(-150, -162), false, 'Ilha Verde headland should be land');
  assert.equal(isWaterAt(114, -102), false, 'New Urban Zone A should be reclaimed land');
  assert.equal(isWaterAt(172, -86), false, 'HZMB Frontier Port Artificial Island should be land');
  assert.equal(isWaterAt(-166, 96), false, 'University of Macau Hengqin Campus should be land');
  assert.equal(isWaterAt(165, 75), false, 'Macau International Airport Runway Island should be land');
  assert.equal(isWaterAt(0, 102), false, 'Cotai Strip reclaimed isthmus should be land');
  assert.equal(isWaterAt(-14, 158), false, 'Coloane Alto de Coloane peak should be land');
  assert.equal(isWaterAt(136, 164), false, 'Coloane Ka Ho Port headland should be land');

  // Authentic Macau water features
  assert.equal(isWaterAt(-21, -24), true, 'Sai Van Lake should be water');
  assert.equal(isWaterAt(20, -23), true, 'Nam Van Lake should be water');
  assert.equal(isWaterAt(0, 4), true, 'Macau-Taipa Harbor Strait should be water');
  assert.equal(isWaterAt(-105, 95), true, 'Shizimen Lotus Canal between Cotai and UM Hengqin should be water');
  assert.equal(isWaterAt(132, 68), true, 'Airport sea channel between runway taxiways should be water');
  assert.equal(isWaterAt(62, 189), true, 'Hac Sa Beach bay should carve into SE Coloane');

  // Authentic terrain elevations
  assert.ok(terrainHeightAt(-14, 158) > terrainHeightAt(-12, -74), 'Alto de Coloane should be Macau highest summit');
  assert.ok(terrainHeightAt(-12, -74) > 5.0, 'Guia Hill should rise prominently on Macau Peninsula');
});

test('gameplay logic guards enforce walkable bounds, multi-crossing road splits, parcel protection, merchant credit, and orphan node cleanup', async () => {
  const { isWalkablePosition } = await import('./geometry');
  const state = createInitialCityState('test-room');

  // 1. Citizen walkability: dry unlocked land OK, open harbor water blocked, bridge deck OK, locked tile blocked
  assert.equal(isWalkablePosition({ x: -2, z: -16 }, state.nodes, state.segments, state.mapTiles), true);
  assert.equal(isWalkablePosition({ x: 35, z: 4 }, state.nodes, state.segments, state.mapTiles), false, 'Open harbor water is not walkable');
  assert.equal(isWalkablePosition({ x: 0, z: 4 }, state.nodes, state.segments, state.mapTiles), true, 'Cross-harbor bridge deck IS walkable');
  assert.equal(isWalkablePosition({ x: -166, z: 96 }, state.nodes, state.segments, state.mapTiles), false, 'Locked district is not walkable');

  // 2. Citizens cannot sim_move into open water or locked districts
  state.players['cit_1'] = createSimPlayer('cit_1', '阿明', '#38bdf8', 'citizen');
  const waterMove = applyClientAction(state, 'cit_1', { type: 'sim_move', x: 35, z: 4 });
  assert.equal(waterMove.ok, false);
  const lockedMove = applyClientAction(state, 'cit_1', { type: 'sim_move', x: -166, z: 96 });
  assert.equal(lockedMove.ok, false);

  // 3. Multi-intersection road building splits ALL crossed segments in sequence
  // Starter s_1 (-32,-30)->(0,-30) and s_2 (0,-30)->(32,-30) vs s_3 (-32,-16)->(0,-16) etc.
  // Build two vertical roads then cross BOTH with one horizontal road inside starter Peninsula
  const b1 = applyClientAction(state, 'mayor_1', {
    type: 'build_road',
    startPos: { x: -20, z: -38 },
    endPos: { x: -20, z: -8 },
    tier: 'street',
  });
  const b2 = applyClientAction(state, 'mayor_1', {
    type: 'build_road',
    startPos: { x: 20, z: -38 },
    endPos: { x: 20, z: -8 },
    tier: 'street',
  });
  assert.equal(b1.ok, true);
  assert.equal(b2.ok, true);
  const segCountBeforeCross = state.segments.length;
  const crossBoth = applyClientAction(state, 'mayor_1', {
    type: 'build_road',
    startPos: { x: -28, z: -22 },
    endPos: { x: 28, z: -22 },
    tier: 'street',
  });
  assert.equal(crossBoth.ok, true);
  // Crossing 2 segments splits 2 into 4 (+2) AND splits the new crossing road into 3 (+3) => +5 segments
  assert.ok(state.segments.length >= segCountBeforeCross + 4, 'Crossing multiple segments should split all intersections');

  // 4. Paint zone refuses overwriting a built parcel directly
  const builtParcel = state.parcels.find((p) => p.buildingId !== null)!;
  const origZone = builtParcel.zone;
  const paintBuilt = applyClientAction(state, 'mayor_1', {
    type: 'paint_zone',
    parcelIds: [builtParcel.id],
    zone: origZone === 'residential' ? 'commercial' : 'residential',
  });
  assert.equal(paintBuilt.ok, false);
  assert.equal(builtParcel.zone, origZone);

  // 5. Merchant-owned unbuilt parcel purchase credits merchant capital & updates holdingsCount
  const merchant = state.merchants[0];
  const emptyParcel = state.parcels.find((p) => !p.buildingId && !p.ownerPlayerId)!;
  emptyParcel.ownerMerchantId = merchant.id;
  merchant.holdingsCount += 1;
  const capBefore = merchant.capital;
  const holdingsBefore = merchant.holdingsCount;
  const buyFromMerchant = applyClientAction(state, 'cit_1', {
    type: 'sim_action',
    kind: 'buy_parcel',
    targetId: emptyParcel.id,
  });
  assert.equal(buyFromMerchant.ok, true);
  assert.ok(merchant.capital > capBefore, 'Previous owning merchant should receive sale proceeds');
  assert.equal(merchant.holdingsCount, holdingsBefore - 1);

  // 6. Bulldozing a standalone road segment prunes its orphaned nodes cleanly
  const isolatedRes = applyClientAction(state, 'mayor_1', {
    type: 'build_road',
    startPos: { x: -38, z: -36 },
    endPos: { x: -38, z: -26 },
    tier: 'street',
  });
  assert.equal(isolatedRes.ok, true);
  const newestSeg = state.segments[state.segments.length - 1];
  const nodesBeforeBulldoze = state.nodes.length;
  const bzRes = applyClientAction(state, 'mayor_1', {
    type: 'bulldoze',
    kind: 'segment',
    id: newestSeg.id,
  });
  assert.equal(bzRes.ok, true);
  assert.ok(state.nodes.length <= nodesBeforeBulldoze - 2, 'Orphaned road endpoints should be pruned');

  // 7. Overlapping landmark placement within 8m is rejected
  const lm1 = state.landmarks[0];
  const lmOverlap = applyClientAction(state, 'mayor_1', {
    type: 'place_landmark',
    landmarkType: 'lotus_plaza',
    x: lm1.x + 2,
    z: lm1.z + 2,
  });
  assert.equal(lmOverlap.ok, false);
});

test('24-hour populationHistory rolling window and D3 sparkline path math stay synchronized', async () => {
  const {
    buildPopulationD3Paths,
    computePopulationTrendStats,
    normalizePopulationSeries,
    POPULATION_WINDOW_HOURS,
  } = await import('./populationTrend');

  const state = createInitialCityState('pop-trend-room');
  assert.equal(state.populationHistory.length, POPULATION_WINDOW_HOURS);
  assert.equal(state.populationHistory[0].hourLabel, '-23h');
  assert.equal(state.populationHistory[23].hourLabel, '現在');
  assert.equal(state.populationHistory[23].population, state.stats.population);

  for (let i = 0; i < 30; i++) {
    stepCitySimulation(state);
  }
  assert.equal(state.populationHistory.length, POPULATION_WINDOW_HOURS);
  assert.equal(state.populationHistory[0].hourLabel, '-23h');
  assert.equal(state.populationHistory[23].hourLabel, '現在');
  assert.equal(state.populationHistory[23].population, state.stats.population);

  const normalized = normalizePopulationSeries(state.populationHistory, state.stats.population);
  assert.equal(normalized.length, 24);
  const stats = computePopulationTrendStats(normalized);
  assert.equal(stats.current, state.stats.population);
  assert.ok(stats.max >= stats.min);

  const geom = buildPopulationD3Paths(normalized, 248, 68);
  assert.ok(geom.linePath.startsWith('M'));
  assert.ok(geom.areaPath.startsWith('M'));
  assert.equal(geom.points.length, 24);

  // Legacy empty/partial backfill safety
  const backfilled = normalizePopulationSeries([], 420);
  assert.equal(backfilled.length, 24);
  assert.equal(backfilled[23].population, 420);
  assert.equal(computePopulationTrendStats(backfilled).direction, 'flat');
});

test('AI City Director anchors 3D dynamic elements safely, tracks dynamic quests, grants rewards, and enforces Mayor role', async () => {
  const {
    applyAiDirectorBundleToState,
    getActiveDynamicModifiers,
    stepDynamicWorldElementsAndQuests,
  } = await import('./aiDirector');

  const state = createInitialCityState('ai-director-room');
  state.players['mayor_1'] = createSimPlayer('mayor_1', '濠江市長', '#38bdf8', 'mayor');
  state.players['cit_1'] = createSimPlayer('cit_1', '小民', '#10b981', 'citizen');

  // Role guard on toggle_ai_director
  const denied = applyClientAction(state, 'cit_1', { type: 'toggle_ai_director', enabled: true });
  assert.equal(denied.ok, false);
  const allowed = applyClientAction(state, 'mayor_1', { type: 'toggle_ai_director', enabled: true });
  assert.equal(allowed.ok, true);
  assert.equal(state.aiAutoDirector, true);

  // Apply structured bundle for parade_float + reach_population quest + event
  const res = applyAiDirectorBundleToState(state, {
    headline: '南灣花車大巡遊今晚登場！',
    dynamicElement: {
      kind: 'parade_float',
      title: '格蘭披治花車巡遊',
      districtName: '中區・南灣西灣・橋頭',
      description: '繽紛花車沿澳門主幹道巡遊',
      accentColor: '#f59e0b',
      durationTicks: 12,
      happinessBonus: 6,
      tourismBonus: 14,
    },
    quest: {
      title: '拓展濱海人口',
      description: '吸引新住民遷入南灣區',
      goalType: 'reach_population',
      targetDeltaOrFloor: 40,
      rewardTreasury: 4500,
      rewardHappiness: 5,
      durationTicks: 16,
    },
    event: {
      title: '夜間燈光匯演測試',
      category: 'festival',
      description: '南灣湖上空舉行試燈活動',
      choiceALabel: '全面開放賞燈區',
      choiceAEffectSummary: '滿意度 +6 · 帶動文旅',
      choiceATreasuryDelta: -1200,
      choiceAHappinessDelta: 6,
      choiceATrafficRelief: 0,
      choiceATourismBoost: true,
      choiceBLabel: '收取觀景平台費',
      choiceBEffectSummary: '庫房 +$2,400',
      choiceBTreasuryDelta: 2400,
      choiceBHappinessDelta: 1,
      choiceBTrafficRelief: 0,
      choiceBLandBoom: true,
    },
  });

  assert.equal(res.element.kind, 'parade_float');
  assert.ok(res.element.segmentId, 'Parade float should snap onto an unlocked road segment');
  assert.equal(state.dynamicElements.length, 1);
  assert.equal(state.aiQuests.length, 1);
  assert.equal(res.eventApplied, true);
  assert.ok(state.activeEvent?.title.includes('夜間燈光匯演測試'));

  const mods = getActiveDynamicModifiers(state);
  assert.equal(mods.happinessBonus, 6);
  assert.equal(mods.tourismBonus, 14);

  // Satisfy quest goal and verify automatic reward payout
  const treasuryBefore = state.stats.treasury;
  state.stats.population = state.aiQuests[0].targetValue + 10;
  stepDynamicWorldElementsAndQuests(state);
  assert.equal(state.aiQuests[0].completed, true);
  assert.equal(state.stats.treasury, treasuryBefore + 4500);
  assert.equal(state.dynamicElements[0].remainingTicks, 11);
});

test('real Macau cartographic coastline includes harbor channels, Peninsula coves, Coloane bays, and island silhouettes', async () => {
  const { isWaterAt, terrainHeightAt } = await import('./geometry');

  // Channels separating Peninsula, Zone A, and HZMB Artificial Island
  assert.equal(isWaterAt(90, -108), true, 'Harbor channel between Peninsula and Zone A should be water');
  assert.equal(isWaterAt(139, -86), true, 'Sea channel between Zone A and HZMB Island should be water');
  // Ka Ho Bay deep cove on NE Coloane & Lai Chi Vun NW cape
  assert.equal(isWaterAt(105, 134), true, 'Ka Ho Bay indentation should carve into NE Coloane');
  assert.equal(isWaterAt(-105, 154), false, 'Lai Chi Vun / Coloane Village NW headland should be dry land');
  // Long Chao Kok headland east of Hac Sa Bay
  assert.equal(isWaterAt(98, 176), false, 'Long Chao Kok headland should border Hac Sa Bay');
  // Penha Hill, Mong Ha Hill, Taipa Grande elevation coherence
  assert.ok(terrainHeightAt(54, 48) > 5.0, 'Taipa Grande Hill should rise prominently on East Taipa');
  assert.ok(terrainHeightAt(-64, -20) > 4.0, 'Penha Hill should rise on SW Peninsula');
});

test('terraforming ops modify height/water state, enable land reclamation road building, and enforce building/road guards', async () => {
  const { isWaterAt, terrainHeightAt } = await import('./geometry');
  const state = createInitialCityState('terraform-room');
  state.players['mayor_1'] = createSimPlayer('mayor_1', '林市長', '#38bdf8', 'mayor');

  // 1. Reclaim harbor water at (22, 4) inside unlocked starter tile_2_2 -> becomes dry land
  assert.equal(isWaterAt(22, 4, state.terrainEdits), true);
  const reclaimRes = applyClientAction(state, 'mayor_1', {
    type: 'terraform',
    kind: 'reclaim',
    x: 22,
    z: 4,
  });
  assert.equal(reclaimRes.ok, true);
  assert.equal(isWaterAt(22, 4, state.terrainEdits), false, 'Reclaimed harbor patch should become dry land');
  assert.ok(terrainHeightAt(22, 4, state.terrainEdits) > 0.25);

  // 2. Build a non-bridge road directly across the newly reclaimed land
  const roadOnReclaimed = applyClientAction(state, 'mayor_1', {
    type: 'build_road',
    startPos: { x: 16, z: 4 },
    endPos: { x: 28, z: 4 },
    tier: 'street',
  });
  assert.equal(roadOnReclaimed.ok, true);
  const newSeg = state.segments[state.segments.length - 1];
  assert.equal(newSeg.isBridge, false, 'Road on reclaimed land should be grounded street rather than harbor bridge');

  // 3. Raise, flatten, and lower dry unlocked ground at (-38, -36)
  const hInit = terrainHeightAt(-38, -36, state.terrainEdits);
  const raiseRes = applyClientAction(state, 'mayor_1', {
    type: 'terraform',
    kind: 'raise',
    x: -38,
    z: -36,
  });
  assert.equal(raiseRes.ok, true);
  assert.ok(terrainHeightAt(-38, -36, state.terrainEdits) > hInit + 1.0);

  const flattenRes = applyClientAction(state, 'mayor_1', {
    type: 'terraform',
    kind: 'flatten',
    x: -38,
    z: -36,
  });
  assert.equal(flattenRes.ok, true);

  const lowerRes = applyClientAction(state, 'mayor_1', {
    type: 'terraform',
    kind: 'lower',
    x: -38,
    z: -36,
  });
  assert.equal(lowerRes.ok, true);

  // 4. Digging a canal directly on an occupied building should be rejected safely
  const b = state.buildings[0];
  const canalOnBuilding = applyClientAction(state, 'mayor_1', {
    type: 'terraform',
    kind: 'canal',
    x: b.x,
    z: b.z,
  });
  assert.equal(canalOnBuilding.ok, false);
});

test('direct parcel construction, building upgrade Lv.1->Lv.3, and expanded 10-landmark catalog work end-to-end', async () => {
  const { computeCurrentBudgetSummary, LANDMARK_SPECS } = await import('./economy');
  const state = createInitialCityState('build-catalog-room');
  state.players['mayor_1'] = createSimPlayer('mayor_1', '林市長', '#38bdf8', 'mayor');
  state.players['cit_1'] = createSimPlayer('cit_1', '小美', '#10b981', 'citizen');

  assert.equal(Object.keys(LANDMARK_SPECS).length, 10, 'Catalog should expose 10 municipal/landmark structures');

  // 1. Citizen denied direct construct
  const targetParcel = state.parcels.find((p) => !p.buildingId)!;
  const citDenied = applyClientAction(state, 'cit_1', {
    type: 'construct_building',
    parcelId: targetParcel.id,
    zone: 'commercial',
  });
  assert.equal(citDenied.ok, false);

  // 2. Mayor directly constructs commercial building on parcel & upgrades it Lv.1 -> Lv.2 -> Lv.3
  const buildRes = applyClientAction(state, 'mayor_1', {
    type: 'construct_building',
    parcelId: targetParcel.id,
    zone: 'commercial',
  });
  assert.equal(buildRes.ok, true);
  assert.equal(targetParcel.zone, 'commercial');
  assert.ok(targetParcel.buildingId);
  const built = state.buildings.find((item) => item.id === targetParcel.buildingId)!;
  assert.equal(built.level, 1);

  const up2 = applyClientAction(state, 'mayor_1', {
    type: 'upgrade_building',
    buildingId: built.id,
  });
  assert.equal(up2.ok, true);
  assert.equal(built.level, 2);

  const up3 = applyClientAction(state, 'mayor_1', {
    type: 'upgrade_building',
    buildingId: built.id,
  });
  assert.equal(up3.ok, true);
  assert.equal(built.level, 3);

  const up4 = applyClientAction(state, 'mayor_1', {
    type: 'upgrade_building',
    buildingId: built.id,
  });
  assert.equal(up4.ok, false, 'Max level 3 building cannot upgrade further');

  // 3. Place Grand Casino Resort on Peninsula dry land -> raises tourism tax in budget summary
  const summaryBefore = computeCurrentBudgetSummary(state);
  const resortRes = applyClientAction(state, 'mayor_1', {
    type: 'place_landmark',
    landmarkType: 'grand_casino_resort',
    x: -38,
    z: -36,
  });
  assert.equal(resortRes.ok, true);
  const summaryAfter = computeCurrentBudgetSummary(state);
  assert.ok(summaryAfter.tourismTax >= summaryBefore.tourismTax + 520);

  // 4. Ferry Terminal allowed on waterfront shoreline & relieves road congestion
  const ferryRes = applyClientAction(state, 'mayor_1', {
    type: 'place_landmark',
    landmarkType: 'ferry_terminal',
    x: 12,
    z: -10,
  });
  assert.equal(ferryRes.ok, true);
});

