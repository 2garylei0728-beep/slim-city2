import type { MapTile, RoadNode, RoadSegment, SnapResult, TerrainEdit, Vec2, ZoneParcel } from './types';

export const MAP_GRID_COLS = 5;
export const MAP_GRID_ROWS = 5;
export const TILE_SIZE = 84;
export const MAP_HALF_SIZE = (MAP_GRID_COLS * TILE_SIZE) / 2; // 210m -> 420m x 420m full real Macau map (5x5 districts)
export const PARCEL_WIDTH = 7.2;
export const PARCEL_DEPTH = 7.2;
export const ROAD_CLEARANCE = 5.4;

/**
 * Authentic Cartographic Real-Map Macau Coastline & Topography
 * (North = -Z, South = +Z, West = -X, East = +X, 420m x 420m [-210..+210])
 *
 * Modeled from the real geographic silhouette of Macau SAR:
 * - Macau Peninsula: SW-NE diagonal tilt, Ilha Verde (青洲) & Canal dos Patos (鴨涌河),
 *   Fai Chi Kei (筷子基), Barrier Gate arch (關閘), Areia Preta (黑沙環),
 *   curved Inner Harbor piers (內港), Barra Point (媽閣咀), Penha & Sai Van/Nam Van crescent lakes,
 *   Macau Tower promontory, NAPE & Outer Harbor bay (外港).
 * - East Peninsula Reclamation: tilted New Urban Zone A (新城A區) & HZMB Frontier Port Island (港珠澳大橋人工島).
 * - West Cross-Canal: University of Macau Hengqin Campus (澳門大學橫琴校區) curved along Shizimen Canal.
 * - Taipa Island (氹仔島): authentic dumbbell silhouette (小潭山 / 官也街 / 大潭山 / 北安角).
 * - Macau International Airport (澳門國際機場): NNW-SSE angled runway island + twin oblique taxiways.
 * - Cotai Strip (路氹金光大道): reclaimed isthmus linking Taipa and Coloane.
 * - Coloane Island (路環島): Lai Chi Vun NW cape, deep Ka Ho Bay (九澳灣) + Ka Ho Point,
 *   Alto de Coloane massif (疊石塘山), crescent Hac Sa Beach bay (黑沙海灘), and Cheoc Van bay (竹灣).
 */

type Poly = ReadonlyArray<readonly [number, number]>;

function chaikinSmooth(poly: Poly, iterations = 3): Array<[number, number]> {
  let pts: Array<[number, number]> = poly.map(([x, z]) => [x, z]);
  for (let it = 0; it < iterations; it++) {
    const next: Array<[number, number]> = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % n];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    pts = next;
  }
  return pts;
}

function pointInPoly(x: number, z: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect =
      zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// 1. Macau Peninsula (澳門半島) real silhouette
const MACAU_PENINSULA_POLY = chaikinSmooth(
  [
    // NW Ilha Verde (青洲) & Canal dos Patos (鴨涌河) notch
    [-168, -162],
    [-156, -182],
    [-132, -184],
    [-124, -172],
    [-112, -186],
    // Barrier Gate northern arch (關閘・台山)
    [-82, -193],
    [-34, -195],
    [18, -191],
    // Areia Preta / Oriental Pearl (黑沙環・東方明珠)
    [66, -182],
    [87, -166],
    [85, -138],
    // Outer Harbor bay & Reservoir bend (外港水庫灣)
    [72, -118],
    [76, -92],
    [88, -68],
    // Outer Harbor Ferry & NAPE bulge (外港碼頭・皇朝區・觀音蓮花苑)
    [76, -46],
    [54, -36],
    [40, -24],
    [22, -14],
    // Macau Tower promontory (澳門觀光塔岬角)
    [5, -9],
    [0, -4],
    [-7, -9],
    // Sai Van / Penha curve to Barra Point (西灣・媽閣咀)
    [-34, -11],
    [-64, -12],
    [-88, -14],
    [-98, -24],
    // Inner Harbor piers & Patane S-curve (內港・十六浦・沙梨頭)
    [-114, -40],
    [-128, -58],
    [-124, -74],
    [-136, -92],
    [-142, -116],
    // Fai Chi Kei cove (筷子基灣)
    [-134, -134],
    [-152, -142],
    [-166, -150],
  ],
  3,
);

// Sai Van Lake (西灣湖) & Nam Van Lake (南灣湖) organic crescent shapes
const SAI_VAN_LAKE_POLY = chaikinSmooth(
  [
    [-30, -25],
    [-25, -31],
    [-14, -30],
    [-11, -23],
    [-15, -17],
    [-26, -18],
  ],
  3,
);

const NAM_VAN_LAKE_POLY = chaikinSmooth(
  [
    [9, -24],
    [14, -30],
    [26, -29],
    [31, -22],
    [26, -16],
    [14, -17],
  ],
  3,
);

// 2. New Urban Zone A (新城A區) tilted polygonal reclaimed island
const ZONE_A_POLY = chaikinSmooth(
  [
    [102, -156],
    [129, -148],
    [133, -112],
    [128, -74],
    [117, -60],
    [99, -68],
    [94, -104],
    [95, -138],
  ],
  2,
);

// 3. HZMB Macau Frontier Port Artificial Island (港珠澳大橋人工島)
const HZMB_ISLAND_POLY = chaikinSmooth(
  [
    [154, -126],
    [186, -122],
    [197, -100],
    [196, -64],
    [184, -48],
    [154, -49],
    [145, -76],
    [147, -104],
  ],
  2,
);

// 4. University of Macau Hengqin Campus (澳門大學橫琴校區) curved along Shizimen Canal
const UM_HENGQIN_POLY = chaikinSmooth(
  [
    [-202, 52],
    [-148, 52],
    [-134, 70],
    [-132, 98],
    [-139, 124],
    [-154, 140],
    [-202, 140],
  ],
  3,
);

// 5. Macau International Airport Runway Island + Twin Oblique Taxiways (澳門國際機場跑道島)
const AIRPORT_RUNWAY_POLY = chaikinSmooth(
  [
    [153, 27],
    [176, 28],
    [183, 121],
    [160, 122],
  ],
  2,
);

const AIRPORT_NORTH_TAXIWAY_POLY: Poly = [
  [104, 42],
  [158, 41],
  [159, 50],
  [104, 51],
];

const AIRPORT_SOUTH_TAXIWAY_POLY: Poly = [
  [104, 86],
  [163, 86],
  [164, 95],
  [104, 95],
];

// 6. Taipa + Cotai Strip + Coloane authentic butterfly/hourglass silhouette
const TAIPA_COTAI_COLOANE_POLY = chaikinSmooth(
  [
    // Taipa West (海洋花園・小潭山・賽馬會)
    [-98, 25],
    [-74, 17],
    [-40, 17],
    // Old Taipa Neck & Bridges approach (舊城區・橋南口)
    [-10, 19],
    [22, 18],
    [52, 16],
    // Pac On Ferry Promontory (北安碼頭岬角)
    [82, 12],
    [102, 15],
    [112, 32],
    [114, 54],
    [92, 69],
    // East Cotai Isthmus waist (路氹東側連島海灣)
    [72, 82],
    [68, 104],
    [76, 128],
    // Ka Ho Bay deep cove (九澳灣深凹港灣)
    [94, 144],
    [116, 144],
    // Ka Ho Point & Deepwater Port Peninsula (九澳港・九澳燈塔東岬)
    [134, 138],
    [162, 144],
    [166, 166],
    [146, 176],
    [118, 178],
    // Long Chao Kok headland & Hac Sa Beach crescent indentation (龍爪角・黑沙海灘彎月灣)
    [98, 184],
    [86, 178],
    [62, 173],
    [38, 178],
    [24, 186],
    // South Coloane & Cheoc Van crescent bay (南岸山岬・竹灣海灘)
    [6, 186],
    [-18, 179],
    [-40, 187],
    [-64, 188],
    // Coloane West & Lai Chi Vun fishing village cape (路環市區・荔枝碗船廠)
    [-96, 176],
    [-116, 160],
    [-112, 140],
    [-82, 126],
    // West Cotai Strip waist facing Shizimen Canal (路氹西側十字門水道岸線)
    [-66, 104],
    [-68, 82],
    [-88, 70],
    [-104, 54],
    [-104, 38],
  ],
  3,
);

const COAST_GRID_RES = 280; // 1.5m cell spacing across [-210, +210]
const COAST_GRID_STEP = (MAP_HALF_SIZE * 2) / COAST_GRID_RES;
const BASE_LAND_MASK = new Uint8Array((COAST_GRID_RES + 1) * (COAST_GRID_RES + 1));
const BASE_RECLAIMED_MASK = new Uint8Array((COAST_GRID_RES + 1) * (COAST_GRID_RES + 1));
const BASE_HEIGHT_GRID = new Float32Array((COAST_GRID_RES + 1) * (COAST_GRID_RES + 1));

function rawHillHeight(x: number, z: number): number {
  let h = 0.36;

  // Penha Hill (西望洋山 - Southwest Peninsula)
  const r2Penha = (x + 64) ** 2 + (z + 20) ** 2;
  if (r2Penha < 780) h += Math.exp(-r2Penha / 240) * 5.2;

  // Guia Hill (東望洋山 / 松山 - Central East Peninsula)
  const r2Guia = (x + 12) ** 2 + (z + 74) ** 2;
  if (r2Guia < 980) h += Math.exp(-r2Guia / 310) * 6.8;

  // Mong Ha Hill (望廈山 - North Central Peninsula)
  const r2Mong = (x + 68) ** 2 + (z + 116) ** 2;
  if (r2Mong < 780) h += Math.exp(-r2Mong / 260) * 4.8;

  // Ilha Verde Hill (青洲山 - NW Corner Peninsula)
  const r2Ilha = (x + 146) ** 2 + (z + 160) ** 2;
  if (r2Ilha < 520) h += Math.exp(-r2Ilha / 180) * 4.1;

  // Taipa Pequena Hill (小潭山 - West Taipa)
  const r2TPeq = (x + 56) ** 2 + (z - 44) ** 2;
  if (r2TPeq < 820) h += Math.exp(-r2TPeq / 270) * 5.6;

  // Taipa Grande Hill (大潭山 - East Taipa overlooking Airport)
  const r2TGra = (x - 54) ** 2 + (z - 48) ** 2;
  if (r2TGra < 1100) h += Math.exp(-r2TGra / 360) * 7.1;

  // Alto de Coloane (路環疊石塘山 - Macau's highest summit)
  const r2Alto = (x + 14) ** 2 + (z - 158) ** 2;
  if (r2Alto < 1550) h += Math.exp(-r2Alto / 480) * 8.6;

  // Ka Ho Hill (九澳山 - East Coloane)
  const r2KaHo = (x - 102) ** 2 + (z - 162) ** 2;
  if (r2KaHo < 850) h += Math.exp(-r2KaHo / 280) * 5.4;

  return h;
}

// Pre-rasterize Macau coastline & smooth coastal shelf once at startup for O(1) runtime lookups
(() => {
  const N = COAST_GRID_RES + 1;
  for (let iz = 0; iz < N; iz++) {
    const z = -MAP_HALF_SIZE + iz * COAST_GRID_STEP;
    for (let ix = 0; ix < N; ix++) {
      const x = -MAP_HALF_SIZE + ix * COAST_GRID_STEP;
      const idx = iz * N + ix;
      if (Math.abs(x) > MAP_HALF_SIZE - 2 || Math.abs(z) > MAP_HALF_SIZE - 2) continue;

      const inLake = pointInPoly(x, z, SAI_VAN_LAKE_POLY) || pointInPoly(x, z, NAM_VAN_LAKE_POLY);
      const inPeninsula = !inLake && pointInPoly(x, z, MACAU_PENINSULA_POLY);
      const inZoneA = pointInPoly(x, z, ZONE_A_POLY);
      const inHZMB = pointInPoly(x, z, HZMB_ISLAND_POLY);
      const inUM = pointInPoly(x, z, UM_HENGQIN_POLY);
      const inAirport =
        pointInPoly(x, z, AIRPORT_RUNWAY_POLY) ||
        pointInPoly(x, z, AIRPORT_NORTH_TAXIWAY_POLY) ||
        pointInPoly(x, z, AIRPORT_SOUTH_TAXIWAY_POLY);
      const inSouth = pointInPoly(x, z, TAIPA_COTAI_COLOANE_POLY);

      if (inPeninsula || inZoneA || inHZMB || inUM || inAirport || inSouth) {
        BASE_LAND_MASK[idx] = 1;
        BASE_HEIGHT_GRID[idx] = rawHillHeight(x, z);
        if (inZoneA || inHZMB || inUM || inAirport) {
          BASE_RECLAIMED_MASK[idx] = 1;
        }
      } else {
        BASE_HEIGHT_GRID[idx] = -1.55;
      }
    }
  }

  // Smooth shallow coastal shelf (-1.55m deep -> -0.58m littoral shelf -> shore)
  for (let iz = 2; iz < N - 2; iz++) {
    for (let ix = 2; ix < N - 2; ix++) {
      const idx = iz * N + ix;
      if (BASE_LAND_MASK[idx] === 1) continue;
      let near1 = false;
      let near2 = false;
      for (let dz = -2; dz <= 2 && !near1; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (BASE_LAND_MASK[(iz + dz) * N + (ix + dx)] === 1) {
            if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
              near1 = true;
              break;
            }
            near2 = true;
          }
        }
      }
      if (near1) BASE_HEIGHT_GRID[idx] = -0.35;
      else if (near2) BASE_HEIGHT_GRID[idx] = -0.92;
    }
  }
})();

function sampleMaskAt(mask: Uint8Array, x: number, z: number): boolean {
  if (Math.abs(x) >= MAP_HALF_SIZE - 2 || Math.abs(z) >= MAP_HALF_SIZE - 2) return false;
  const fx = (x + MAP_HALF_SIZE) / COAST_GRID_STEP;
  const fz = (z + MAP_HALF_SIZE) / COAST_GRID_STEP;
  const ix = Math.max(0, Math.min(COAST_GRID_RES, Math.round(fx)));
  const iz = Math.max(0, Math.min(COAST_GRID_RES, Math.round(fz)));
  return mask[iz * (COAST_GRID_RES + 1) + ix] === 1;
}

export function isInSaiVanOrNamVanLake(x: number, z: number): boolean {
  return pointInPoly(x, z, SAI_VAN_LAKE_POLY) || pointInPoly(x, z, NAM_VAN_LAKE_POLY);
}

export function isHacSaBeachCoast(x: number, z: number): boolean {
  const dx = (x - 62) / 28;
  const dz = (z - 175) / 10;
  return dx * dx + dz * dz < 1.0;
}

export function isCheocVanBeachCoast(x: number, z: number): boolean {
  const dx = (x + 18) / 22;
  const dz = (z - 181) / 8;
  return dx * dx + dz * dz < 1.0;
}

export function isReclaimedZoneSurface(
  x: number,
  z: number,
  terrainEdits?: TerrainEdit[],
): boolean {
  if (sampleMaskAt(BASE_RECLAIMED_MASK, x, z)) {
    return true;
  }
  if (terrainEdits && terrainEdits.length > 0 && baseIsWaterAt(x, z)) {
    for (const ed of terrainEdits) {
      if (ed.kind === 'reclaim' && Math.hypot(x - ed.x, z - ed.z) < ed.radius * 0.88) {
        return terrainHeightAt(x, z, terrainEdits) > 0.08;
      }
    }
  }
  return false;
}

export function isLandMacauPeninsula(x: number, z: number): boolean {
  return (
    pointInPoly(x, z, MACAU_PENINSULA_POLY) &&
    !pointInPoly(x, z, SAI_VAN_LAKE_POLY) &&
    !pointInPoly(x, z, NAM_VAN_LAKE_POLY)
  );
}

export function isLandZoneA(x: number, z: number): boolean {
  return pointInPoly(x, z, ZONE_A_POLY);
}

export function isLandHZMBIsland(x: number, z: number): boolean {
  return pointInPoly(x, z, HZMB_ISLAND_POLY);
}

export function isLandUniversityOfMacau(x: number, z: number): boolean {
  return pointInPoly(x, z, UM_HENGQIN_POLY);
}

export function isLandAirportRunway(x: number, z: number): boolean {
  return (
    pointInPoly(x, z, AIRPORT_RUNWAY_POLY) ||
    pointInPoly(x, z, AIRPORT_NORTH_TAXIWAY_POLY) ||
    pointInPoly(x, z, AIRPORT_SOUTH_TAXIWAY_POLY)
  );
}

export function isLandTaipaCotaiColoane(x: number, z: number): boolean {
  return pointInPoly(x, z, TAIPA_COTAI_COLOANE_POLY);
}

function baseIsWaterAt(x: number, z: number): boolean {
  return !sampleMaskAt(BASE_LAND_MASK, x, z);
}

function baseTerrainHeightAt(x: number, z: number): number {
  if (Math.abs(x) >= MAP_HALF_SIZE || Math.abs(z) >= MAP_HALF_SIZE) {
    return -1.55;
  }
  const N = COAST_GRID_RES + 1;
  const fx = (x + MAP_HALF_SIZE) / COAST_GRID_STEP;
  const fz = (z + MAP_HALF_SIZE) / COAST_GRID_STEP;
  const ix0 = Math.max(0, Math.min(COAST_GRID_RES - 1, Math.floor(fx)));
  const iz0 = Math.max(0, Math.min(COAST_GRID_RES - 1, Math.floor(fz)));
  const tx = fx - ix0;
  const tz = fz - iz0;

  const h00 = BASE_HEIGHT_GRID[iz0 * N + ix0];
  const h10 = BASE_HEIGHT_GRID[iz0 * N + ix0 + 1];
  const h01 = BASE_HEIGHT_GRID[(iz0 + 1) * N + ix0];
  const h11 = BASE_HEIGHT_GRID[(iz0 + 1) * N + ix0 + 1];

  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

export function isWaterAt(x: number, z: number, terrainEdits?: TerrainEdit[]): boolean {
  if (Math.abs(x) > MAP_HALF_SIZE - 2 || Math.abs(z) > MAP_HALF_SIZE - 2) return true;
  const baseWater = baseIsWaterAt(x, z);
  if (!terrainEdits || terrainEdits.length === 0) return baseWater;
  const h = terrainHeightAt(x, z, terrainEdits);
  if (baseWater) return h <= 0.08;
  return h <= 0.02;
}

export function terrainHeightAt(x: number, z: number, terrainEdits?: TerrainEdit[]): number {
  let h = baseTerrainHeightAt(x, z);
  if (!terrainEdits || terrainEdits.length === 0) {
    return h;
  }

  for (let i = 0; i < terrainEdits.length; i++) {
    const ed = terrainEdits[i];
    const dx = x - ed.x;
    const dz = z - ed.z;
    const rSq = ed.radius * ed.radius;
    const dSq = dx * dx + dz * dz;
    if (dSq >= rSq) continue;

    const d = Math.sqrt(dSq);
    const u = 1 - d / ed.radius;
    const w = u * u * (3 - 2 * u);

    if (ed.kind === 'raise') {
      h = Math.min(15.5, h + ed.delta * w);
    } else if (ed.kind === 'lower') {
      h = Math.max(-2.4, h + ed.delta * w);
    } else if (ed.kind === 'flatten') {
      const target = ed.targetHeight ?? 0.55;
      const fw = Math.min(1, w * 1.45);
      h = h + (target - h) * fw;
    } else if (ed.kind === 'reclaim') {
      const target = ed.targetHeight ?? 0.48;
      if (h < target) {
        const fw = Math.min(1, w * 1.65);
        h = h + (target - h) * fw;
      }
    } else if (ed.kind === 'canal') {
      const target = ed.targetHeight ?? -1.65;
      if (h > target) {
        const fw = Math.min(1, w * 1.65);
        h = h + (target - h) * fw;
      }
    }
  }

  return h;
}

/**
 * 5x5 Progressive Full Macau District Tiles (-210..+210, each 84m x 84m = 25 regions).
 * Starts at central Macau Nam Van / Sai Van (2, 2) covering [-42, 42] x [-42, 42]
 * and unlocks across the entire Macau Peninsula, Zone A, HZMB Island, Taipa, Airport,
 * UM Hengqin, Cotai Strip & Coloane!
 */
export function createMacauMapTiles(): MapTile[] {
  const defs: Array<{
    col: number;
    row: number;
    name: string;
    subtitle: string;
    unlocked: boolean;
    unlockCost: number;
    minPopulation: number;
    bonusDescription: string;
  }> = [
    // ROW 0 (North Peninsula & Border)
    {
      col: 0,
      row: 0,
      name: '青洲・跨境工業區',
      subtitle: '青洲山與鴨涌河西岸口岸走廊',
      unlocked: false,
      unlockCost: 9200,
      minPopulation: 950,
      bonusDescription: '解鎖西北青洲科創與宜居住宅帶',
    },
    {
      col: 1,
      row: 0,
      name: '關閘・台山北區',
      subtitle: '關閘口岸廣場與高密度民生社區',
      unlocked: false,
      unlockCost: 8500,
      minPopulation: 700,
      bonusDescription: '大幅提升北區人口承載力',
    },
    {
      col: 2,
      row: 0,
      name: '祐漢・黑沙環海濱',
      subtitle: '東方明珠與半島東北濱海走廊',
      unlocked: false,
      unlockCost: 7800,
      minPopulation: 500,
      bonusDescription: '貫通北區與新城填海樞紐',
    },
    {
      col: 3,
      row: 0,
      name: '新城 A 區・東北岸',
      subtitle: '現代填海社區與港珠澳北接駁',
      unlocked: false,
      unlockCost: 10500,
      minPopulation: 850,
      bonusDescription: '解鎖廣闊平地大型住宅與商業地塊',
    },
    {
      col: 4,
      row: 0,
      name: '港珠澳北堤・海上走廊',
      subtitle: '東北部跨海引橋與口岸北門戶',
      unlocked: false,
      unlockCost: 11500,
      minPopulation: 1200,
      bonusDescription: '打通灣區東向高快速交通幹線',
    },

    // ROW 1 (Core Peninsula & Outer Harbor / HZMB)
    {
      col: 0,
      row: 1,
      name: '筷子基・林茂塘海港',
      subtitle: '北灣水岸住宅與內港遊艇碼頭',
      unlocked: false,
      unlockCost: 7600,
      minPopulation: 580,
      bonusDescription: '拓展內港北岸優質水景地產',
    },
    {
      col: 1,
      row: 1,
      name: '紅街市・三盞燈・望廈',
      subtitle: '望廈山傳統街區與市井美食商圈',
      unlocked: false,
      unlockCost: 6200,
      minPopulation: 240,
      bonusDescription: '帶動老城商業與住宅穩定稅收',
    },
    {
      col: 2,
      row: 1,
      name: '大三巴・東望洋松山',
      subtitle: '東望洋燈塔、塔石廣場與世遺核心',
      unlocked: false,
      unlockCost: 4800,
      minPopulation: 0,
      bonusDescription: '立即向半島北部推進的核心歷史區',
    },
    {
      col: 3,
      row: 1,
      name: '外港碼頭・皇朝區',
      subtitle: '新口岸金蓮花、商貿大廈與客運港',
      unlocked: false,
      unlockCost: 6800,
      minPopulation: 280,
      bonusDescription: '解鎖高地價商務與外港樞紐地塊',
    },
    {
      col: 4,
      row: 1,
      name: '港珠澳口岸人工島',
      subtitle: '三地口岸旅檢大樓與超級物流門戶',
      unlocked: false,
      unlockCost: 12000,
      minPopulation: 800,
      bonusDescription: '吸引大量跨境觀光與高商業地價',
    },

    // ROW 2 (Peninsula South Tip, Nam Van / Sai Van, Bridges)
    {
      col: 0,
      row: 2,
      name: '內港碼頭・十六浦下環',
      subtitle: '百年海上商埠與傳統街巷復興',
      unlocked: false,
      unlockCost: 7400,
      minPopulation: 520,
      bonusDescription: '解鎖西岸港口商貿與住宅',
    },
    {
      col: 1,
      row: 2,
      name: '媽閣廟・西望洋山',
      subtitle: '媽閣海角、主教山與西灣橋北口',
      unlocked: false,
      unlockCost: 5800,
      minPopulation: 160,
      bonusDescription: '打通西灣大橋前往氹仔西岸',
    },
    {
      col: 2,
      row: 2,
      name: '中區・南灣西灣・橋頭',
      subtitle: '起始核心 · 南西灣雙湖與澳氹中軸',
      unlocked: true,
      unlockCost: 0,
      minPopulation: 0,
      bonusDescription: '澳門都市規劃起點核心樞紐',
    },
    {
      col: 3,
      row: 2,
      name: '新口岸南・友誼大橋',
      subtitle: '東岸濱海走廊與友誼跨海幹道',
      unlocked: false,
      unlockCost: 6500,
      minPopulation: 220,
      bonusDescription: '直連皇朝區、外港與氹仔北安',
    },
    {
      col: 4,
      row: 2,
      name: '北安・澳門大橋東廊',
      subtitle: '新城 E 區與東部跨海快線通道',
      unlocked: false,
      unlockCost: 11200,
      minPopulation: 780,
      bonusDescription: '銜接港珠澳島與澳門國際機場',
    },

    // ROW 3 (Taipa, Airport, Cotai North & UM Hengqin)
    {
      col: 0,
      row: 3,
      name: '澳門大學橫琴校區',
      subtitle: '十字門水道西岸大學城與科創島',
      unlocked: false,
      unlockCost: 11800,
      minPopulation: 1100,
      bonusDescription: '解鎖高素質研發教育與宜居新城',
    },
    {
      col: 1,
      row: 3,
      name: '海洋花園・小潭山',
      subtitle: '西灣大橋南端、賽馬場與蓮花口岸',
      unlocked: false,
      unlockCost: 8200,
      minPopulation: 480,
      bonusDescription: '高地價濱海住宅並可跨橋通往澳大',
    },
    {
      col: 2,
      row: 3,
      name: '氹仔官也街・金光大道北',
      subtitle: '龍環葡韻、舊城區與路氹度假集群',
      unlocked: false,
      unlockCost: 7200,
      minPopulation: 240,
      bonusDescription: '開拓氹仔核心商圈與路氹娛樂城',
    },
    {
      col: 3,
      row: 3,
      name: '大潭山・北安客運碼頭',
      subtitle: '大潭山郊野公園與氹仔東部樞紐',
      unlocked: false,
      unlockCost: 8800,
      minPopulation: 550,
      bonusDescription: '接駁國際機場與東部跨海大橋',
    },
    {
      col: 4,
      row: 3,
      name: '澳門國際機場跑道島',
      subtitle: '填海國際機場跑道與航空商旅區',
      unlocked: false,
      unlockCost: 14500,
      minPopulation: 1050,
      bonusDescription: '激活國際航空港文旅與商務紅利',
    },

    // ROW 4 (Cotai South & Full Coloane Island)
    {
      col: 0,
      row: 4,
      name: '橫琴岸・石排灣西灘',
      subtitle: '十字門南口與路環西岸生態水域',
      unlocked: false,
      unlockCost: 12500,
      minPopulation: 1500,
      bonusDescription: '連結澳大橫琴校區與路環西緣',
    },
    {
      col: 1,
      row: 4,
      name: '石排灣・路環市區',
      subtitle: '大熊貓館、荔枝碗船廠與譚公廟',
      unlocked: false,
      unlockCost: 10800,
      minPopulation: 950,
      bonusDescription: '解鎖路環人文古村與森林社區',
    },
    {
      col: 2,
      row: 4,
      name: '金光大道南・疊石塘・竹灣',
      subtitle: '路環最高峰媽祖像與竹灣海灘度假區',
      unlocked: false,
      unlockCost: 11200,
      minPopulation: 900,
      bonusDescription: '貫通整個路氹至路環南海海岸線',
    },
    {
      col: 3,
      row: 4,
      name: '黑沙海灘・高爾夫灣',
      subtitle: '澳門標誌性黑沙灣與濱海康體區',
      unlocked: false,
      unlockCost: 13200,
      minPopulation: 1350,
      bonusDescription: '打造世界級海濱生態度假勝地',
    },
    {
      col: 4,
      row: 4,
      name: '九澳深水港・聖母村',
      subtitle: '九澳燈塔、貨運深水港與能源基地',
      unlocked: false,
      unlockCost: 15500,
      minPopulation: 1750,
      bonusDescription: '解鎖澳門東南端深水海港物流區',
    },
  ];

  return defs.map((d) => {
    const minX = -MAP_HALF_SIZE + d.col * TILE_SIZE;
    const maxX = minX + TILE_SIZE;
    const minZ = -MAP_HALF_SIZE + d.row * TILE_SIZE;
    const maxZ = minZ + TILE_SIZE;
    return {
      id: `tile_${d.col}_${d.row}`,
      ...d,
      minX,
      maxX,
      minZ,
      maxZ,
    };
  });
}

export function getTileAt(x: number, z: number, tiles: MapTile[]): MapTile | null {
  for (const t of tiles) {
    if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ) {
      return t;
    }
  }
  return null;
}

export function isTileUnlockedAt(x: number, z: number, tiles?: MapTile[]): boolean {
  if (!tiles || tiles.length === 0) return true;
  const tile = getTileAt(x, z, tiles);
  return tile ? tile.unlocked : false;
}

export function isTileAdjacentToUnlocked(tile: MapTile, tiles: MapTile[]): boolean {
  if (tile.unlocked) return false;
  return tiles.some(
    (other) =>
      other.unlocked &&
      Math.abs(other.col - tile.col) + Math.abs(other.row - tile.row) === 1,
  );
}

export function dist2D(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function clampToMap(p: Vec2): Vec2 {
  const limit = MAP_HALF_SIZE - 4;
  return {
    x: Math.max(-limit, Math.min(limit, p.x)),
    z: Math.max(-limit, Math.min(limit, p.z)),
  };
}

export function projectPointToSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { point: Vec2; t: number; dist: number } {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const lenSq = vx * vx + vz * vz;
  if (lenSq < 1e-6) {
    return { point: { x: a.x, z: a.z }, t: 0, dist: dist2D(p, a) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / lenSq));
  const proj = { x: a.x + vx * t, z: a.z + vz * t };
  return { point: proj, t, dist: dist2D(p, proj) };
}

export function isWalkablePosition(
  p: Vec2,
  nodes: RoadNode[],
  segments: RoadSegment[],
  mapTiles?: MapTile[],
  terrainEdits?: TerrainEdit[],
): boolean {
  if (Math.abs(p.x) > MAP_HALF_SIZE - 4 || Math.abs(p.z) > MAP_HALF_SIZE - 4) return false;
  if (!isTileUnlockedAt(p.x, p.z, mapTiles)) return false;
  if (!isWaterAt(p.x, p.z, terrainEdits)) return true;

  // Over water, only allow walking when staying on a road/cross-harbor bridge deck
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const seg of segments) {
    const a = nodeMap.get(seg.nodeA);
    const b = nodeMap.get(seg.nodeB);
    if (!a || !b) continue;
    const halfW = seg.tier === 'street' ? 2.8 : 3.6;
    if (projectPointToSegment(p, a, b).dist <= halfW) {
      return true;
    }
  }
  return false;
}

export function segmentsIntersect(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): Vec2 | null {
  const dax = a2.x - a1.x;
  const daz = a2.z - a1.z;
  const dbx = b2.x - b1.x;
  const dbz = b2.z - b1.z;

  const denom = dax * dbz - daz * dbx;
  if (Math.abs(denom) < 1e-5) return null;

  const dx = b1.x - a1.x;
  const dz = b1.z - a1.z;

  const t = (dx * dbz - dz * dbx) / denom;
  const u = (dx * daz - dz * dax) / denom;

  if (t > 0.04 && t < 0.96 && u > 0.04 && u < 0.96) {
    return {
      x: a1.x + dax * t,
      z: a1.z + daz * t,
    };
  }
  return null;
}

/**
 * Cities: Skylines 2 style Real Road Alignment & Snapping with Macau Tile Lock check
 */
export function findRoadSnap(
  rawPos: Vec2,
  startPos: Vec2 | null,
  startNodeId: string | null,
  nodes: RoadNode[],
  segments: RoadSegment[],
  snapEnabled = true,
  mapTiles?: MapTile[],
  terrainEdits?: TerrainEdit[],
): SnapResult {
  const clamped = clampToMap(rawPos);
  const nodeMap = new Map<string, RoadNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const checkUnlocked = (pos: Vec2): boolean => {
    if (!isTileUnlockedAt(pos.x, pos.z, mapTiles)) return false;
    if (startPos) {
      for (const t of [0.25, 0.5, 0.75]) {
        const sample = {
          x: startPos.x + (pos.x - startPos.x) * t,
          z: startPos.z + (pos.z - startPos.z) * t,
        };
        if (!isTileUnlockedAt(sample.x, sample.z, mapTiles)) return false;
      }
    }
    return true;
  };

  if (!snapEnabled) {
    const lengthM = startPos ? dist2D(startPos, clamped) : undefined;
    const angleDeg = startPos
      ? ((Math.atan2(clamped.z - startPos.z, clamped.x - startPos.x) * 180) / Math.PI + 360) % 360
      : undefined;
    const unlocked = checkUnlocked(clamped);
    return {
      pos: clamped,
      kind: 'free',
      lengthM,
      angleDeg,
      isBridge: startPos
        ? segmentCrossesWater(startPos, clamped, terrainEdits)
        : isWaterAt(clamped.x, clamped.z, terrainEdits),
      valid: unlocked && (!startPos || (lengthM !== undefined && lengthM >= 7)),
      reason: !unlocked ? '此澳門分區尚未解鎖 (請先於「擴展地圖」解鎖)' : undefined,
    };
  }

  // 1. Endpoint Node Snap
  let bestNode: RoadNode | null = null;
  let bestNodeDist = 4.4;
  for (const n of nodes) {
    if (n.id === startNodeId) continue;
    const d = dist2D(clamped, n);
    if (d < bestNodeDist) {
      bestNodeDist = d;
      bestNode = n;
    }
  }

  if (bestNode) {
    const pos = { x: bestNode.x, z: bestNode.z };
    const lengthM = startPos ? dist2D(startPos, pos) : undefined;
    const angleDeg = startPos
      ? ((Math.atan2(pos.z - startPos.z, pos.x - startPos.x) * 180) / Math.PI + 360) % 360
      : undefined;
    const unlocked = checkUnlocked(pos);
    return {
      pos,
      kind: 'node',
      snappedNodeId: bestNode.id,
      lengthM,
      angleDeg,
      isBridge: startPos
        ? segmentCrossesWater(startPos, pos, terrainEdits)
        : isWaterAt(pos.x, pos.z, terrainEdits),
      valid: unlocked && (!startPos || (lengthM !== undefined && lengthM >= 6)),
      reason: !unlocked ? '此澳門分區尚未解鎖' : undefined,
    };
  }

  // 2. Existing Segment Snap (T-Junction)
  let bestSeg: RoadSegment | null = null;
  let bestSegPoint: Vec2 | null = null;
  let bestSegDist = 3.8;

  for (const seg of segments) {
    const a = nodeMap.get(seg.nodeA);
    const b = nodeMap.get(seg.nodeB);
    if (!a || !b) continue;
    if (startNodeId && (seg.nodeA === startNodeId || seg.nodeB === startNodeId)) continue;

    const proj = projectPointToSegment(clamped, a, b);
    if (proj.t > 0.08 && proj.t < 0.92 && proj.dist < bestSegDist) {
      bestSegDist = proj.dist;
      bestSeg = seg;
      bestSegPoint = proj.point;
    }
  }

  if (bestSeg && bestSegPoint) {
    const lengthM = startPos ? dist2D(startPos, bestSegPoint) : undefined;
    const angleDeg = startPos
      ? ((Math.atan2(bestSegPoint.z - startPos.z, bestSegPoint.x - startPos.x) * 180) / Math.PI +
          360) %
        360
      : undefined;
    const unlocked = checkUnlocked(bestSegPoint);
    return {
      pos: bestSegPoint,
      kind: 'segment',
      snappedSegmentId: bestSeg.id,
      lengthM,
      angleDeg,
      isBridge: startPos
        ? segmentCrossesWater(startPos, bestSegPoint, terrainEdits)
        : isWaterAt(bestSegPoint.x, bestSegPoint.z, terrainEdits),
      valid: unlocked && (!startPos || (lengthM !== undefined && lengthM >= 6)),
      reason: !unlocked ? '此澳門分區尚未解鎖' : undefined,
    };
  }

  // 3. Angle Snap + Parallel Alignment
  if (startPos) {
    const rawDx = clamped.x - startPos.x;
    const rawDz = clamped.z - startPos.z;
    const rawLen = Math.hypot(rawDx, rawDz);
    if (rawLen < 0.5) {
      return { pos: clamped, kind: 'free', lengthM: 0, angleDeg: 0, valid: false };
    }

    const rawAngle = Math.atan2(rawDz, rawDx);
    const refAngles: number[] = [0, Math.PI / 2];
    if (startNodeId) {
      for (const seg of segments) {
        if (seg.nodeA === startNodeId || seg.nodeB === startNodeId) {
          const otherId = seg.nodeA === startNodeId ? seg.nodeB : seg.nodeA;
          const other = nodeMap.get(otherId);
          if (other) {
            refAngles.push(Math.atan2(other.z - startPos.z, other.x - startPos.x));
          }
        }
      }
    }

    let snappedAngle = rawAngle;
    let bestAngleDiff = (8.5 * Math.PI) / 180;
    let didAngleSnap = false;

    for (const base of refAngles) {
      for (let k = 0; k < 8; k++) {
        const candidate = base + (k * Math.PI) / 4;
        const diff = Math.abs(Math.atan2(Math.sin(rawAngle - candidate), Math.cos(rawAngle - candidate)));
        if (diff < bestAngleDiff) {
          bestAngleDiff = diff;
          snappedAngle = candidate;
          didAngleSnap = true;
        }
      }
    }

    const snappedLen = didAngleSnap ? Math.max(8, Math.round(rawLen / 2) * 2) : rawLen;
    let finalPos: Vec2 = clampToMap({
      x: startPos.x + Math.cos(snappedAngle) * snappedLen,
      z: startPos.z + Math.sin(snappedAngle) * snappedLen,
    });

    let secondaryGuideLine: { from: Vec2; to: Vec2 } | undefined;
    let kind: SnapResult['kind'] = didAngleSnap ? 'angle' : 'free';

    for (const n of nodes) {
      if (n.id === startNodeId) continue;
      if (Math.abs(finalPos.x - n.x) < 2.2 && Math.abs(finalPos.z - n.z) > 8) {
        finalPos = { ...finalPos, x: n.x };
        secondaryGuideLine = { from: { x: n.x, z: n.z }, to: finalPos };
        kind = 'parallel';
        break;
      }
      if (Math.abs(finalPos.z - n.z) < 2.2 && Math.abs(finalPos.x - n.x) > 8) {
        finalPos = { ...finalPos, z: n.z };
        secondaryGuideLine = { from: { x: n.x, z: n.z }, to: finalPos };
        kind = 'parallel';
        break;
      }
    }

    const finalLen = dist2D(startPos, finalPos);
    const angleDeg =
      ((Math.atan2(finalPos.z - startPos.z, finalPos.x - startPos.x) * 180) / Math.PI + 360) % 360;
    const unlocked = checkUnlocked(finalPos);

    return {
      pos: finalPos,
      kind,
      guideLine: didAngleSnap
        ? {
            from: startPos,
            to: {
              x: startPos.x + Math.cos(snappedAngle) * (finalLen + 18),
              z: startPos.z + Math.sin(snappedAngle) * (finalLen + 18),
            },
          }
        : undefined,
      secondaryGuideLine,
      angleDeg,
      lengthM: finalLen,
      isBridge: segmentCrossesWater(startPos, finalPos, terrainEdits),
      valid: unlocked && finalLen >= 7 && finalLen <= 120,
      reason: !unlocked
        ? '此澳門分區尚未解鎖 (請先於「擴展地圖」解鎖)'
        : finalLen < 7
          ? '道路太短 (最少 7m)'
          : finalLen > 120
            ? '單段過長 (上限 120m)'
            : undefined,
    };
  }

  // 4. High-resolution 2m grid snap
  const gridPos: Vec2 = {
    x: Math.round(clamped.x / 2) * 2,
    z: Math.round(clamped.z / 2) * 2,
  };
  const unlocked = isTileUnlockedAt(gridPos.x, gridPos.z, mapTiles);
  const inWater = isWaterAt(gridPos.x, gridPos.z, terrainEdits);
  return {
    pos: gridPos,
    kind: 'grid',
    isBridge: inWater,
    valid: unlocked && !inWater,
    reason: !unlocked
      ? '此澳門分區尚未解鎖 (請先於「擴展地圖」解鎖)'
      : inWater
        ? '起點不可設於水域中央'
        : undefined,
  };
}

export function segmentCrossesWater(
  a: Vec2,
  b: Vec2,
  terrainEdits?: TerrainEdit[],
): boolean {
  const steps = Math.max(4, Math.ceil(dist2D(a, b) / 4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (isWaterAt(x, z, terrainEdits)) return true;
  }
  return false;
}

export function generateParcelsForSegment(
  seg: RoadSegment,
  nodeMap: Map<string, RoadNode>,
  allSegments: RoadSegment[],
  existingParcels: ZoneParcel[],
  idFactory: () => string,
  mapTiles?: MapTile[],
  terrainEdits?: TerrainEdit[],
): ZoneParcel[] {
  if (seg.isBridge) return [];
  const a = nodeMap.get(seg.nodeA);
  const b = nodeMap.get(seg.nodeB);
  if (!a || !b) return [];

  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 10) return [];

  const dirX = dx / len;
  const dirZ = dz / len;
  const normX = -dirZ;
  const normZ = dirX;
  const roadAngle = Math.atan2(dz, dx);

  const roadHalfWidth = seg.tier === 'street' ? 2.1 : 2.9;
  const offsetDist = roadHalfWidth + PARCEL_DEPTH * 0.5 + 0.55;

  const created: ZoneParcel[] = [];
  const margin = 4.6;
  const usable = len - margin * 2;
  const slotCount = Math.floor(usable / (PARCEL_WIDTH + 0.7));
  if (slotCount <= 0) return [];

  const step = usable / slotCount;

  for (let i = 0; i < slotCount; i++) {
    const along = margin + step * (i + 0.5);
    const baseX = a.x + dirX * along;
    const baseZ = a.z + dirZ * along;

    for (const side of [-1, 1]) {
      const px = baseX + normX * offsetDist * side;
      const pz = baseZ + normZ * offsetDist * side;

      if (Math.abs(px) > MAP_HALF_SIZE - 8 || Math.abs(pz) > MAP_HALF_SIZE - 8) continue;
      if (!isTileUnlockedAt(px, pz, mapTiles)) continue;
      if (
        isWaterAt(px, pz, terrainEdits) ||
        isWaterAt(px + normX * 2.5 * side, pz + normZ * 2.5 * side, terrainEdits)
      ) {
        continue;
      }
      if (terrainHeightAt(px, pz, terrainEdits) > 4.2) continue;

      let tooCloseToRoad = false;
      for (const otherSeg of allSegments) {
        const oa = nodeMap.get(otherSeg.nodeA);
        const ob = nodeMap.get(otherSeg.nodeB);
        if (!oa || !ob) continue;
        const proj = projectPointToSegment({ x: px, z: pz }, oa, ob);
        if (proj.dist < ROAD_CLEARANCE) {
          tooCloseToRoad = true;
          break;
        }
      }
      if (tooCloseToRoad) continue;

      let overlapsParcel = false;
      for (const ep of existingParcels) {
        if (Math.hypot(ep.x - px, ep.z - pz) < PARCEL_WIDTH * 0.88) {
          overlapsParcel = true;
          break;
        }
      }
      if (!overlapsParcel) {
        for (const cp of created) {
          if (Math.hypot(cp.x - px, cp.z - pz) < PARCEL_WIDTH * 0.88) {
            overlapsParcel = true;
            break;
          }
        }
      }
      if (overlapsParcel) continue;

      created.push({
        id: idFactory(),
        segmentId: seg.id,
        x: px,
        z: pz,
        angle: side === 1 ? roadAngle + Math.PI / 2 : roadAngle - Math.PI / 2,
        width: PARCEL_WIDTH - 0.5,
        depth: PARCEL_DEPTH - 0.5,
        zone: 'none',
        landValue: 35,
        ownerMerchantId: null,
        ownerPlayerId: null,
        purchasePrice: 0,
        buildingId: null,
        tradeCount: 0,
        forSale: false,
      });
    }
  }

  return created;
}
