import React, { useEffect, useMemo, useRef } from 'react';
import { axisBottom, scaleLinear, select } from 'd3';
import { Activity, X } from 'lucide-react';
import {
  getTrafficDensityGradientStops,
  mapTrafficLoadToD3Style,
  summarizeTrafficDensity,
  TRAFFIC_MAX_DOMAIN,
} from '../sim/trafficOverlay';
import type { CityState } from '../sim/types';

interface TrafficDensityOverlayProps {
  cityState: CityState;
  onClose: () => void;
}

export const TrafficDensityOverlay: React.FC<TrafficDensityOverlayProps> = ({
  cityState,
  onClose,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const summary = useMemo(() => summarizeTrafficDensity(cityState), [cityState]);
  const gradientStops = useMemo(() => getTrafficDensityGradientStops(11), []);

  // Render D3 SVG color-saturation legend, axis ticks, and live average/peak markers
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const width = 248;
    const padLeft = 10;
    const padRight = 10;
    const barW = width - padLeft - padRight;
    const barY = 12;
    const barH = 11;

    const svg = select(svgEl);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const grad = defs
      .append('linearGradient')
      .attr('id', 'macau-traffic-d3-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '100%')
      .attr('y2', '0%');

    grad
      .selectAll('stop')
      .data(gradientStops)
      .enter()
      .append('stop')
      .attr('offset', (d) => `${d.offsetPct}%`)
      .attr('stop-color', (d) => d.hex);

    const xScale = scaleLinear()
      .domain([0, TRAFFIC_MAX_DOMAIN])
      .range([padLeft, padLeft + barW])
      .clamp(true);

    // Spectrum bar
    svg
      .append('rect')
      .attr('x', padLeft)
      .attr('y', barY)
      .attr('width', barW)
      .attr('height', barH)
      .attr('rx', 4)
      .attr('fill', 'url(#macau-traffic-d3-grad)')
      .attr('stroke', 'rgba(255,255,255,0.2)')
      .attr('stroke-width', 1);

    // Average road load marker triangle
    const avgX = xScale(summary.avgLoad);
    svg
      .append('polygon')
      .attr('points', `${avgX},${barY - 2} ${avgX - 4},${barY - 9} ${avgX + 4},${barY - 9}`)
      .attr('fill', '#f8fafc');

    // Peak road load vertical tick
    if (summary.peakLoad > 0) {
      const peakX = xScale(summary.peakLoad);
      svg
        .append('line')
        .attr('x1', peakX)
        .attr('x2', peakX)
        .attr('y1', barY - 2)
        .attr('y2', barY + barH + 2)
        .attr('stroke', '#f8fafc')
        .attr('stroke-width', 1.75)
        .attr('stroke-dasharray', '2,1');
    }

    // D3 bottom axis ticks
    const axis = axisBottom(xScale)
      .tickValues([0, 0.45, 0.78, 1.0, TRAFFIC_MAX_DOMAIN])
      .tickSize(4)
      .tickFormat((v) => `${Math.round(Number(v) * 100)}%`);

    const axisGroup = svg
      .append('g')
      .attr('transform', `translate(0, ${barY + barH + 1})`)
      .call(axis);

    axisGroup.select('.domain').attr('stroke', 'rgba(148, 163, 184, 0.35)');
    axisGroup.selectAll('.tick line').attr('stroke', 'rgba(148, 163, 184, 0.45)');
    axisGroup
      .selectAll('.tick text')
      .attr('fill', '#cbd5e1')
      .attr('font-size', '9.5px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
  }, [gradientStops, summary.avgLoad, summary.peakLoad]);

  const bucketItems = [
    { label: '暢通', count: summary.buckets.free, color: mapTrafficLoadToD3Style(0.18).hex },
    { label: '繁忙', count: summary.buckets.moderate, color: mapTrafficLoadToD3Style(0.6).hex },
    { label: '飽和', count: summary.buckets.heavy, color: mapTrafficLoadToD3Style(0.88).hex },
    { label: '壅塞', count: summary.buckets.congested, color: mapTrafficLoadToD3Style(1.25).hex },
  ];

  return (
    <section
      data-testid="traffic-density-overlay"
      aria-label="交通密度圖層"
      className="w-72 rounded-xl border border-amber-400/35 bg-slate-950/92 p-3.5 shadow-2xl space-y-2.5"
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/20 text-amber-300 border border-amber-400/30">
            <Activity className="h-3.5 w-3.5" />
          </span>
          <div>
            <h2 className="text-xs font-semibold text-white">交通密度疊加圖層</h2>
            <p className="text-[10px] text-slate-400">D3 路網負荷綠→紅飽和度映射</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="關閉交通密度圖層"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* D3 Generated Color Saturation Scale */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] text-slate-300">
          <span>
            平均負荷 <strong className="font-mono-num text-white">{summary.avgLoadPct}%</strong>
          </span>
          <span>
            最高路段 <strong className="font-mono-num text-amber-300">{summary.peakLoadPct}%</strong>
          </span>
        </div>
        <svg
          ref={svgRef}
          data-testid="traffic-d3-legend-svg"
          viewBox="0 0 248 46"
          className="w-full h-[46px] overflow-visible"
        />
      </div>

      {/* Segment Count Breakdown */}
      <div className="grid grid-cols-4 gap-1.5">
        {bucketItems.map((b) => (
          <div
            key={b.label}
            className="rounded-lg border border-slate-800 bg-slate-900/90 px-1.5 py-1.5 text-center"
          >
            <div className="flex items-center justify-center gap-1 text-[10px] text-slate-300">
              <span
                className="inline-block h-2 w-2 rounded-xs"
                style={{ backgroundColor: b.color }}
              />
              {b.label}
            </div>
            <div className="mt-0.5 text-xs font-bold font-mono-num text-white">{b.count}</div>
          </div>
        ))}
      </div>

      {/* Top Busiest Segments */}
      {summary.busiestSegments.length > 0 && (
        <div className="border-t border-slate-800 pt-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>重點車流路段 ({summary.totalSegments} 條)</span>
            <span>流暢度 {summary.flowPct}%</span>
          </div>
          <div className="space-y-1">
            {summary.busiestSegments.map((seg) => (
              <div
                key={seg.id}
                className="flex items-center justify-between rounded bg-slate-900/80 px-2 py-1 text-[11px]"
              >
                <span className="flex items-center gap-1.5 text-slate-200 truncate">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-xs border border-white/20"
                    style={{ backgroundColor: seg.hex }}
                  />
                  <span className="truncate">{seg.label}</span>
                </span>
                <span className="font-mono-num text-[10px] text-slate-300 shrink-0 ml-2">
                  {seg.loadPct}% · S{seg.saturationPct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
