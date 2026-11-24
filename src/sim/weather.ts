import { terrainHeightAt } from './geometry';
import type { CityState, WeatherPhase, WeatherState } from './types';

const TYPHOON_NAMES = [
  '強颱風「天鴿」',
  '超強颱風「山竹」',
  '強颱風「蘇拉」',
  '超強颱風「摩羯」',
  '強颱風「韋森特」',
  '熱帶氣旋「獅子山」',
];

export const BASE_SEA_LEVEL_Y = -0.3;

export function createInitialWeatherState(): WeatherState {
  return {
    phase: 'clear',
    typhoonSignal: 0,
    typhoonName: '南海副熱帶高壓',
    windSpeedKmh: 16,
    windAngleRad: 0.65,
    rainIntensity: 0,
    surgeLevel: 0,
    floodedRoadIds: [],
    floodedBuildingIds: [],
    drainageProtectionCount: 0,
    remainingTicks: 18,
    vortexX: 160,
    vortexZ: 140,
  };
}

export function isPointProtectedFromFlood(state: CityState, x: number, z: number): boolean {
  for (const lm of state.landmarks) {
    if (lm.type === 'water_purification_plant' || lm.type === 'fire_hospital_hub') {
      const shieldRadius = lm.type === 'water_purification_plant' ? 52 : 44;
      if (Math.hypot(x - lm.x, z - lm.z) <= shieldRadius) {
        return true;
      }
    }
  }
  return false;
}

export function computeFloodImpacts(state: CityState): void {
  const weather = state.weather;
  if (!weather) return;

  if (weather.surgeLevel <= 0.35) {
    weather.floodedRoadIds = [];
    weather.floodedBuildingIds = [];
    weather.drainageProtectionCount = 0;
    return;
  }

  const surgeWaterY = BASE_SEA_LEVEL_Y + weather.surgeLevel;
  const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));
  const floodedRoads: string[] = [];
  const floodedBuildings: string[] = [];
  let shielded = 0;

  for (const seg of state.segments) {
    if (seg.isBridge) continue;
    const a = nodeMap.get(seg.nodeA);
    const b = nodeMap.get(seg.nodeB);
    if (!a || !b) continue;
    const midX = (a.x + b.x) * 0.5;
    const midZ = (a.z + b.z) * 0.5;
    const groundY = terrainHeightAt(midX, midZ, state.terrainEdits);
    if (groundY < surgeWaterY - 0.02) {
      if (isPointProtectedFromFlood(state, midX, midZ)) {
        shielded++;
      } else {
        floodedRoads.push(seg.id);
      }
    }
  }

  for (const b of state.buildings) {
    if (b.status !== 'active') continue;
    const groundY = terrainHeightAt(b.x, b.z, state.terrainEdits);
    if (groundY < surgeWaterY - 0.04) {
      if (isPointProtectedFromFlood(state, b.x, b.z)) {
        shielded++;
      } else {
        floodedBuildings.push(b.id);
      }
    }
  }

  weather.floodedRoadIds = floodedRoads;
  weather.floodedBuildingIds = floodedBuildings;
  weather.drainageProtectionCount = shielded;
}

export function setWeatherPhase(
  state: CityState,
  phase: WeatherPhase,
  rng = Math.random,
): WeatherState {
  const pickName = TYPHOON_NAMES[Math.floor(rng() * TYPHOON_NAMES.length)];

  if (phase === 'clear') {
    state.weather = {
      phase: 'clear',
      typhoonSignal: 0,
      typhoonName: '南海季風微風',
      windSpeedKmh: 16,
      windAngleRad: 0.65,
      rainIntensity: 0,
      surgeLevel: 0,
      floodedRoadIds: [],
      floodedBuildingIds: [],
      drainageProtectionCount: 0,
      remainingTicks: 18,
      vortexX: 160,
      vortexZ: 140,
    };
  } else if (phase === 'monsoon_rain') {
    state.weather = {
      phase: 'monsoon_rain',
      typhoonSignal: 3,
      typhoonName: pickName,
      windSpeedKmh: 52,
      windAngleRad: 0.95,
      rainIntensity: 0.58,
      surgeLevel: 0.28,
      floodedRoadIds: [],
      floodedBuildingIds: [],
      drainageProtectionCount: 0,
      remainingTicks: 10,
      vortexX: 110,
      vortexZ: 85,
    };
  } else if (phase === 'typhoon_t8') {
    state.weather = {
      phase: 'typhoon_t8',
      typhoonSignal: 8,
      typhoonName: pickName,
      windSpeedKmh: 108,
      windAngleRad: 1.35,
      rainIntensity: 0.88,
      surgeLevel: 0.72,
      floodedRoadIds: [],
      floodedBuildingIds: [],
      drainageProtectionCount: 0,
      remainingTicks: 9,
      vortexX: 35,
      vortexZ: 28,
    };
  } else {
    state.weather = {
      phase: 'typhoon_t10',
      typhoonSignal: 10,
      typhoonName: pickName,
      windSpeedKmh: 168,
      windAngleRad: 1.75,
      rainIntensity: 1.0,
      surgeLevel: 1.15,
      floodedRoadIds: [],
      floodedBuildingIds: [],
      drainageProtectionCount: 0,
      remainingTicks: 8,
      vortexX: -12,
      vortexZ: -8,
    };
  }

  computeFloodImpacts(state);
  return state.weather;
}

export function stepCityWeather(state: CityState, rng = Math.random): void {
  if (!state.weather) {
    state.weather = createInitialWeatherState();
  }
  const w = state.weather;
  w.remainingTicks = Math.max(0, w.remainingTicks - 1);

  if (w.phase === 'typhoon_t8' || w.phase === 'typhoon_t10') {
    // Move typhoon vortex smoothly across Macau harbor toward NW Zhuhai
    w.vortexX -= 8.5;
    w.vortexZ -= 6.5;
    w.windAngleRad = (w.windAngleRad + 0.35) % (Math.PI * 2);
  }

  if (w.remainingTicks === 0) {
    if (w.phase === 'clear') {
      const roll = rng();
      if (roll < 0.24) {
        setWeatherPhase(state, 'typhoon_t8', rng);
      } else if (roll < 0.56) {
        setWeatherPhase(state, 'monsoon_rain', rng);
      } else {
        w.remainingTicks = 14;
      }
    } else if (w.phase === 'monsoon_rain') {
      if (rng() < 0.35) {
        setWeatherPhase(state, 'typhoon_t8', rng);
      } else {
        setWeatherPhase(state, 'clear', rng);
      }
    } else {
      // Storm subsides back to clear weather
      setWeatherPhase(state, 'clear', rng);
    }
  }

  computeFloodImpacts(state);
}
