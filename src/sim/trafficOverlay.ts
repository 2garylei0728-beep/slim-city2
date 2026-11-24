import { hsl, scaleLinear } from 'd3';
import type { CityState, RoadSegment, RoadTier } from './types';

export type TrafficDensityStatus = 'free' | 'moderate' | 'heavy' | 'congested';

export interface TrafficColorMapping {
  load: number;
  hex: string;
  colorInt: number;
  hue: number;
  saturation: number;
  lightness: number;
  status: TrafficDensityStatus;
  label: string;
}

export interface TrafficGradientStop {
  offsetPct: number;
  load: number;
  hex: string;
}

export interface TrafficSegmentSummary {
  id: string;
  label: string;
  tier: RoadTier;
  tierLabel: string;
  isBridge: boolean;
  trafficLoad: number;
  loadPct: number;
  hex: string;
  saturationPct: number;
  status: TrafficDensityStatus;
}

export interface TrafficDensitySummary {
  totalSegments: number;
  avgLoad: number;
  avgLoadPct: number;
  peakLoad: number;
  peakLoadPct: number;
  flowPct: number;
  buckets: {
    free: number;
    moderate: number;
    heavy: number;
    congested: number;
  };
  busiestSegments: TrafficSegmentSummary[];
}

export const TRAFFIC_MAX_DOMAIN = 1.4;

// D3 continuous multi-stop scales mapping road trafficLoad (0..1.4) to HSL hue, saturation & lightness
const hueScale = scaleLinear<number>()
  .domain([0, 0.42, 0.78, 1.05, TRAFFIC_MAX_DOMAIN])
  .range([142, 92, 44, 14, 0])
  .clamp(true);

const saturationScale = scaleLinear<number>()
  .domain([0, 0.45, 0.85, TRAFFIC_MAX_DOMAIN])
  .range([0.54, 0.72, 0.9, 1.0])
  .clamp(true);

const lightnessScale = scaleLinear<number>()
  .domain([0, 0.65, 1.05, TRAFFIC_MAX_DOMAIN])
  .range([0.48, 0.51, 0.5, 0.46])
  .clamp(true);

export function classifyTrafficLoad(trafficLoad: number): {
  status: TrafficDensityStatus;
  label: string;
} {
  if (trafficLoad < 0.45) {
    return { status: 'free', label: '暢通' };
  }
  if (trafficLoad < 0.78) {
    return { status: 'moderate', label: '繁忙' };
  }
  if (trafficLoad < 1.0) {
    return { status: 'heavy', label: '接近飽和' };
  }
  return { status: 'congested', label: '壅塞' };
}

/**
 * Uses D3 linear scales and HSL color space to map a road segment's trafficLoad
 * into a green-to-red color whose saturation intensifies with congestion.
 */
export function mapTrafficLoadToD3Style(trafficLoad: number): TrafficColorMapping {
  const safeLoad = Number.isFinite(trafficLoad) ? Math.max(0, Math.min(1.5, trafficLoad)) : 0;
  const h = hueScale(safeLoad);
  const s = saturationScale(safeLoad);
  const l = lightnessScale(safeLoad);

  const color = hsl(h, s, l);
  const rgbColor = color.rgb();
  const r = Math.max(0, Math.min(255, Math.round(rgbColor.r)));
  const g = Math.max(0, Math.min(255, Math.round(rgbColor.g)));
  const b = Math.max(0, Math.min(255, Math.round(rgbColor.b)));
  const hex = color.formatHex();
  const colorInt = (r << 16) | (g << 8) | b;
  const { status, label } = classifyTrafficLoad(safeLoad);

  return {
    load: safeLoad,
    hex,
    colorInt,
    hue: h,
    saturation: s,
    lightness: l,
    status,
    label,
  };
}

export function computeNodeTrafficLoad(nodeId: string, segments: RoadSegment[]): number {
  let sum = 0;
  let count = 0;
  for (const seg of segments) {
    if (seg.nodeA === nodeId || seg.nodeB === nodeId) {
      sum += seg.trafficLoad;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0.2;
}

export function getTrafficDensityGradientStops(steps = 9): TrafficGradientStop[] {
  const count = Math.max(2, steps);
  const stops: TrafficGradientStop[] = [];
  for (let i = 0; i < count; i++) {
    const ratio = i / (count - 1);
    const load = ratio * TRAFFIC_MAX_DOMAIN;
    const mapped = mapTrafficLoadToD3Style(load);
    stops.push({
      offsetPct: Math.round(ratio * 100),
      load,
      hex: mapped.hex,
    });
  }
  return stops;
}

function getTierLabel(tier: RoadTier, isBridge: boolean): string {
  if (isBridge) return '跨海大橋';
  if (tier === 'bus_avenue') return '巴士專線';
  if (tier === 'avenue') return '四線大道';
  return '二線街道';
}

export function summarizeTrafficDensity(cityState: CityState): TrafficDensitySummary {
  const segs = cityState.segments;
  const buckets = { free: 0, moderate: 0, heavy: 0, congested: 0 };

  if (segs.length === 0) {
    return {
      totalSegments: 0,
      avgLoad: 0,
      avgLoadPct: 0,
      peakLoad: 0,
      peakLoadPct: 0,
      flowPct: cityState.stats.trafficFlowPct,
      buckets,
      busiestSegments: [],
    };
  }

  let sumLoad = 0;
  let peakLoad = 0;
  const summaries: TrafficSegmentSummary[] = segs.map((seg, idx) => {
    const mapped = mapTrafficLoadToD3Style(seg.trafficLoad);
    sumLoad += seg.trafficLoad;
    if (seg.trafficLoad > peakLoad) peakLoad = seg.trafficLoad;
    buckets[mapped.status] += 1;

    const tierLabel = getTierLabel(seg.tier, seg.isBridge);
    return {
      id: seg.id,
      label: seg.isBridge ? `跨海大橋 #${idx + 1}` : `${tierLabel} #${idx + 1}`,
      tier: seg.tier,
      tierLabel,
      isBridge: seg.isBridge,
      trafficLoad: seg.trafficLoad,
      loadPct: Math.round(seg.trafficLoad * 100),
      hex: mapped.hex,
      saturationPct: Math.round(mapped.saturation * 100),
      status: mapped.status,
    };
  });

  summaries.sort((a, b) => b.trafficLoad - a.trafficLoad);
  const avgLoad = sumLoad / segs.length;

  return {
    totalSegments: segs.length,
    avgLoad,
    avgLoadPct: Math.round(avgLoad * 100),
    peakLoad,
    peakLoadPct: Math.round(peakLoad * 100),
    flowPct: cityState.stats.trafficFlowPct,
    buckets,
    busiestSegments: summaries.slice(0, 3),
  };
}
