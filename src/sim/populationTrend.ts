import { area, curveMonotoneX, extent, line, scaleLinear } from 'd3';
import type { PopulationPoint } from './types';

export interface NormalizedPopulationPoint {
  index: number;
  hoursAgo: number;
  hourLabel: string;
  tick: number;
  population: number;
}

export interface PopulationTrendStats {
  current: number;
  start: number;
  delta: number;
  deltaPct: number;
  min: number;
  max: number;
  direction: 'up' | 'down' | 'flat';
}

export interface PopulationChartGeometry {
  linePath: string;
  areaPath: string;
  points: Array<{
    index: number;
    x: number;
    y: number;
    population: number;
    hourLabel: string;
  }>;
  yMin: number;
  yMax: number;
  xTickIndices: number[];
}

export const POPULATION_WINDOW_HOURS = 24;

/**
 * Produces a normalized 24-hour rolling window ending at the current live population.
 * Backfills leading samples safely if a legacy/partial state arrives with < 24 samples.
 */
export function normalizePopulationSeries(
  history: PopulationPoint[] | undefined,
  currentPopulation: number,
): NormalizedPopulationPoint[] {
  const safeCurrent = Math.max(0, Math.round(currentPopulation));
  const raw = Array.isArray(history) ? history.slice(-POPULATION_WINDOW_HOURS) : [];

  const values: Array<{ tick: number; population: number }> = [];
  if (raw.length === 0) {
    for (let i = 0; i < POPULATION_WINDOW_HOURS; i++) {
      values.push({ tick: i - (POPULATION_WINDOW_HOURS - 1), population: safeCurrent });
    }
  } else if (raw.length < POPULATION_WINDOW_HOURS) {
    const first = raw[0];
    const padCount = POPULATION_WINDOW_HOURS - raw.length;
    for (let i = 0; i < padCount; i++) {
      values.push({
        tick: first.tick - (padCount - i),
        population: Math.max(0, Math.round(first.population)),
      });
    }
    for (const pt of raw) {
      values.push({ tick: pt.tick, population: Math.max(0, Math.round(pt.population)) });
    }
  } else {
    for (const pt of raw) {
      values.push({ tick: pt.tick, population: Math.max(0, Math.round(pt.population)) });
    }
  }

  // Keep the latest point synchronized with live stats.population
  values[values.length - 1] = {
    tick: values[values.length - 1].tick,
    population: safeCurrent,
  };

  return values.map((v, index) => {
    const hoursAgo = POPULATION_WINDOW_HOURS - 1 - index;
    return {
      index,
      hoursAgo,
      hourLabel: hoursAgo === 0 ? '現在' : `-${hoursAgo}h`,
      tick: v.tick,
      population: v.population,
    };
  });
}

export function computePopulationTrendStats(
  series: NormalizedPopulationPoint[],
): PopulationTrendStats {
  if (series.length === 0) {
    return { current: 0, start: 0, delta: 0, deltaPct: 0, min: 0, max: 0, direction: 'flat' };
  }
  const start = series[0].population;
  const current = series[series.length - 1].population;
  const delta = current - start;
  const deltaPct = start > 0 ? Math.round((delta / start) * 1000) / 10 : delta > 0 ? 100 : 0;
  let min = series[0].population;
  let max = series[0].population;
  for (const pt of series) {
    if (pt.population < min) min = pt.population;
    if (pt.population > max) max = pt.population;
  }
  return {
    current,
    start,
    delta,
    deltaPct,
    min,
    max,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  };
}

export function buildPopulationD3Paths(
  series: NormalizedPopulationPoint[],
  width = 248,
  height = 66,
  margin = { top: 8, right: 8, bottom: 18, left: 32 },
): PopulationChartGeometry {
  const innerRight = width - margin.right;
  const innerBottom = height - margin.bottom;

  const xScale = scaleLinear()
    .domain([0, Math.max(1, series.length - 1)])
    .range([margin.left, innerRight]);

  const [rawMin = 0, rawMax = 100] = extent(series, (d) => d.population);
  const span = Math.max(12, rawMax - rawMin);
  const pad = Math.max(6, Math.round(span * 0.16));
  const yMin = Math.max(0, rawMin - pad);
  const yMax = rawMax + pad;

  const yScale = scaleLinear()
    .domain([yMin, yMax])
    .range([innerBottom, margin.top]);

  const lineGenerator = line<NormalizedPopulationPoint>()
    .x((d) => xScale(d.index))
    .y((d) => yScale(d.population))
    .curve(curveMonotoneX);

  const areaGenerator = area<NormalizedPopulationPoint>()
    .x((d) => xScale(d.index))
    .y0(innerBottom)
    .y1((d) => yScale(d.population))
    .curve(curveMonotoneX);

  return {
    linePath: lineGenerator(series) || '',
    areaPath: areaGenerator(series) || '',
    points: series.map((d) => ({
      index: d.index,
      x: xScale(d.index),
      y: yScale(d.population),
      population: d.population,
      hourLabel: d.hourLabel,
    })),
    yMin,
    yMax,
    xTickIndices: [0, 11, series.length - 1],
  };
}
