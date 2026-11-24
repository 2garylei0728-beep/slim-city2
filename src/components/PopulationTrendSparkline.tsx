import React, { useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3';
import { ChevronDown, ChevronUp, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  buildPopulationD3Paths,
  computePopulationTrendStats,
  normalizePopulationSeries,
} from '../sim/populationTrend';
import type { CityState } from '../sim/types';

interface PopulationTrendSparklineProps {
  cityState: CityState;
}

const SVG_W = 248;
const SVG_H = 68;
const MARGIN = { top: 8, right: 8, bottom: 18, left: 34 };

export const PopulationTrendSparkline: React.FC<PopulationTrendSparklineProps> = ({
  cityState,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const series = useMemo(
    () => normalizePopulationSeries(cityState.populationHistory, cityState.stats.population),
    [cityState.populationHistory, cityState.stats.population],
  );
  const trendStats = useMemo(() => computePopulationTrendStats(series), [series]);
  const chartGeom = useMemo(
    () => buildPopulationD3Paths(series, SVG_W, SVG_H, MARGIN),
    [series],
  );

  const hoveredPoint =
    hoverIndex !== null && chartGeom.points[hoverIndex]
      ? chartGeom.points[hoverIndex]
      : null;

  useEffect(() => {
    if (collapsed) return;
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const strokeHex =
      trendStats.direction === 'up'
        ? '#34d399'
        : trendStats.direction === 'down'
          ? '#fb7185'
          : '#38bdf8';

    const svg = select(svgEl);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const areaGrad = defs
      .append('linearGradient')
      .attr('id', 'macau-pop-d3-area-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    areaGrad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', strokeHex)
      .attr('stop-opacity', 0.34);

    areaGrad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', strokeHex)
      .attr('stop-opacity', 0.02);

    const innerBottom = SVG_H - MARGIN.bottom;
    const innerRight = SVG_W - MARGIN.right;

    // Subtle horizontal reference gridlines (top & bottom bounds)
    svg
      .append('line')
      .attr('x1', MARGIN.left)
      .attr('x2', innerRight)
      .attr('y1', MARGIN.top)
      .attr('y2', MARGIN.top)
      .attr('stroke', 'rgba(148, 163, 184, 0.16)')
      .attr('stroke-dasharray', '2,2');

    svg
      .append('line')
      .attr('x1', MARGIN.left)
      .attr('x2', innerRight)
      .attr('y1', innerBottom)
      .attr('y2', innerBottom)
      .attr('stroke', 'rgba(148, 163, 184, 0.28)');

    // Left Y-axis min / max labels
    svg
      .append('text')
      .attr('x', MARGIN.left - 4)
      .attr('y', MARGIN.top + 3)
      .attr('text-anchor', 'end')
      .attr('fill', '#94a3b8')
      .attr('font-size', '8.5px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text(chartGeom.yMax.toLocaleString());

    svg
      .append('text')
      .attr('x', MARGIN.left - 4)
      .attr('y', innerBottom + 1)
      .attr('text-anchor', 'end')
      .attr('fill', '#94a3b8')
      .attr('font-size', '8.5px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text(chartGeom.yMin.toLocaleString());

    // Bottom X-axis 24h markers (-23h, -12h, 現在)
    for (const idx of chartGeom.xTickIndices) {
      const pt = chartGeom.points[idx];
      if (!pt) continue;
      svg
        .append('text')
        .attr('x', pt.x)
        .attr('y', SVG_H - 3)
        .attr(
          'text-anchor',
          idx === 0 ? 'start' : idx === chartGeom.points.length - 1 ? 'end' : 'middle',
        )
        .attr('fill', idx === chartGeom.points.length - 1 ? '#e2e8f0' : '#94a3b8')
        .attr('font-size', '8.5px')
        .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
        .text(pt.hourLabel);
    }

    // D3 Area & Monotone Line Path
    svg
      .append('path')
      .attr('d', chartGeom.areaPath)
      .attr('fill', 'url(#macau-pop-d3-area-grad)');

    svg
      .append('path')
      .attr('data-testid', 'population-d3-line-path')
      .attr('d', chartGeom.linePath)
      .attr('fill', 'none')
      .attr('stroke', strokeHex)
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');

    // Hover guide or live current endpoint marker
    const activePt = hoveredPoint || chartGeom.points[chartGeom.points.length - 1];
    if (activePt) {
      if (hoveredPoint) {
        svg
          .append('line')
          .attr('x1', hoveredPoint.x)
          .attr('x2', hoveredPoint.x)
          .attr('y1', MARGIN.top)
          .attr('y2', innerBottom)
          .attr('stroke', 'rgba(226, 232, 240, 0.45)')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '2,2');
      }

      svg
        .append('circle')
        .attr('cx', activePt.x)
        .attr('cy', activePt.y)
        .attr('r', hoveredPoint ? 3.4 : 2.8)
        .attr('fill', strokeHex)
        .attr('stroke', '#020617')
        .attr('stroke-width', 1.4);
    }
  }, [chartGeom, collapsed, hoveredPoint, trendStats.direction]);

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * SVG_W;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (const pt of chartGeom.points) {
      const d = Math.abs(pt.x - svgX);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = pt.index;
      }
    }
    setHoverIndex(bestIdx);
  };

  const displayPop = hoveredPoint ? hoveredPoint.population : trendStats.current;
  const displayTimeLabel = hoveredPoint ? hoveredPoint.hourLabel : '24h';
  const deltaSign = trendStats.delta > 0 ? '+' : '';
  const TrendIcon =
    trendStats.direction === 'up'
      ? TrendingUp
      : trendStats.direction === 'down'
        ? TrendingDown
        : Minus;
  const deltaColor =
    trendStats.direction === 'up'
      ? 'text-emerald-300'
      : trendStats.direction === 'down'
        ? 'text-rose-300'
        : 'text-sky-300';

  return (
    <section
      data-testid="population-trend-card"
      aria-label="過去 24 小時人口增長趨勢"
      className="w-64 sm:w-72 rounded-xl border border-white/15 bg-slate-950/92 px-3 py-2.5 shadow-xl"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[11px] font-semibold text-white truncate">
              過去 24 小時人口趨勢
            </h2>
            <span className="text-[10px] font-mono-num text-slate-400 shrink-0">
              · {displayTimeLabel}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] font-mono-num">
            <span className="font-bold text-white">{displayPop.toLocaleString()} 人</span>
            <span className={`inline-flex items-center gap-0.5 font-medium ${deltaColor}`}>
              <TrendIcon className="h-3 w-3" aria-hidden="true" />
              {deltaSign}
              {trendStats.delta.toLocaleString()} ({deltaSign}
              {trendStats.deltaPct}%)
            </span>
          </div>
        </div>

        <button
          type="button"
          aria-label={collapsed ? '展開 24 小時人口趨勢圖' : '收合 24 小時人口趨勢圖'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
        >
          {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </div>

      {!collapsed && (
        <div className="mt-1.5">
          <svg
            ref={svgRef}
            data-testid="population-d3-svg"
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
            className="w-full h-[68px] overflow-visible cursor-crosshair"
            role="img"
            aria-label={`澳門過去 24 小時人口折線圖，目前 ${trendStats.current.toLocaleString()} 人`}
          />
        </div>
      )}
    </section>
  );
};
