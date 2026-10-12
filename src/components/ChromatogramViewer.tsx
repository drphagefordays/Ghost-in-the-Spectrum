import React, { useState, useRef } from 'react';
import { ProteinProfile, NormalizationMode } from '../types/sec';
import { normalizeProfile } from '../utils/statistics';
import { downloadSVG } from '../utils/export';
import { Download, ZoomIn, ZoomOut, Eye, Info } from 'lucide-react';

export interface OverlayProfile {
  profile: ProteinProfile;
  color: string;
  dashed?: boolean;
  label: string;
  pearsonR?: number;
}

interface ChromatogramViewerProps {
  primaryProfiles: ProteinProfile[]; // e.g. the queried protein in 60min and 120min
  overlayProfiles: OverlayProfile[]; // e.g. checked co-fractionating proteins or complex subunits
  normMode: NormalizationMode;
  selectedFraction: number | null;
  onSelectFraction: (fraction: number) => void;
  title?: string;
  subtitle?: string;
}

const CONDITION_COLORS: Record<string, string> = {
  '60min': '#2dd4bf',   // teal
  '120min': '#fb7185',  // rose
  '30min': '#38bdf8',   // sky
  'Ctrl': '#a78bfa',    // purple
  'Treat1': '#f59e0b',  // amber
  'Treat2': '#ec4899',  // pink
  'Default': '#10b981'  // emerald
};

export const ChromatogramViewer: React.FC<ChromatogramViewerProps> = ({
  primaryProfiles,
  overlayProfiles,
  normMode,
  selectedFraction,
  onSelectFraction,
  title,
  subtitle
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredFraction, setHoveredFraction] = useState<number | null>(null);
  const [isLogScale, setIsLogScale] = useState(false);

  // Combine all curves to render
  const allCurves: {
    key: string;
    label: string;
    color: string;
    dashed: boolean;
    values: number[];
    fractions: number[];
    apexFraction: number;
    rawApexIntensity: number;
    pearsonR?: number;
  }[] = [];

  // Primary profiles (conditions of the current protein)
  primaryProfiles.forEach((p, idx) => {
    const color = CONDITION_COLORS[p.condition] || (idx === 0 ? '#2dd4bf' : '#fb7185');
    allCurves.push({
      key: `primary_${p.id}`,
      label: `${p.gene} [${p.condition}${p.replicate ? ` ${p.replicate}` : ''}]`,
      color,
      dashed: false,
      values: normalizeProfile(p.values, normMode),
      fractions: p.fractions,
      apexFraction: p.apexFraction,
      rawApexIntensity: p.apexIntensity
    });
  });

  // Overlay profiles
  overlayProfiles.forEach((op) => {
    allCurves.push({
      key: `overlay_${op.profile.id}`,
      label: op.label,
      color: op.color,
      dashed: !!op.dashed,
      values: normalizeProfile(op.profile.values, normMode),
      fractions: op.profile.fractions,
      apexFraction: op.profile.apexFraction,
      rawApexIntensity: op.profile.apexIntensity,
      pearsonR: op.pearsonR
    });
  });

  // Compute common fraction range and max value
  const fractionSet = new Set<number>();
  allCurves.forEach(c => c.fractions.forEach(f => fractionSet.add(f)));
  const sortedFractions = Array.from(fractionSet).sort((a, b) => a - b);
  const minFrac = sortedFractions.length > 0 ? sortedFractions[0] : 1;
  const maxFrac = sortedFractions.length > 0 ? sortedFractions[sortedFractions.length - 1] : 70;

  // Global maximum for Y axis scaling
  let globalMax = 0;
  allCurves.forEach(c => {
    c.values.forEach(v => {
      const val = isLogScale ? (v > 0 ? Math.log10(v + 1) : 0) : v;
      if (val > globalMax) globalMax = val;
    });
  });
  if (globalMax <= 0) globalMax = 1;

  // Chart dimensions
  const width = 860;
  const height = 340;
  const margin = { top: 30, right: 30, bottom: 45, left: 65 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  // Scale functions
  const scaleX = (frac: number) => {
    const span = maxFrac - minFrac || 1;
    return margin.left + ((frac - minFrac) / span) * plotWidth;
  };

  const scaleY = (val: number) => {
    const effectiveVal = isLogScale ? (val > 0 ? Math.log10(val + 1) : 0) : val;
    return margin.top + plotHeight - (effectiveVal / globalMax) * plotHeight;
  };

  // Convert array to SVG path
  const generatePath = (fractions: number[], values: number[]): string => {
    if (fractions.length === 0) return '';
    const points = fractions.map((f, i) => `${scaleX(f)},${scaleY(values[i] || 0)}`);
    return `M ${points.join(' L ')}`;
  };

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(pct => {
    const val = globalMax * pct;
    return {
      y: scaleY(val),
      label: normMode === 'peak'
        ? val.toFixed(2)
        : normMode === 'area'
        ? `${val.toFixed(1)}%`
        : isLogScale
        ? `10^${val.toFixed(1)}`
        : val >= 1e6
        ? `${(val / 1e6).toFixed(1)}M`
        : val >= 1e3
        ? `${(val / 1e3).toFixed(0)}k`
        : val.toFixed(0)
    };
  });

  // X-axis ticks (every 5 or 10 fractions)
  const step = maxFrac > 50 ? 5 : 2;
  const xTicks = sortedFractions.filter(f => f % step === 0 || f === minFrac || f === maxFrac);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center space-x-2">
            <span>{title || 'Elution Chromatogram Profile'}</span>
            {subtitle && <span className="text-xs text-slate-400 font-normal">({subtitle})</span>}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Click anywhere along the gradient to inspect co-eluting proteins in that fraction slice.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Log scale toggle */}
          <button
            onClick={() => setIsLogScale(!isLogScale)}
            className={`px-2.5 py-1 rounded text-xs font-medium border transition ${
              isLogScale
                ? 'bg-teal-500/20 text-teal-400 border-teal-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            Log10 Scale
          </button>

          {/* SVG Export */}
          <button
            onClick={() => svgRef.current && downloadSVG(svgRef.current, `${title || 'sec_profile'}.svg`)}
            className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-xs border border-slate-700 transition"
            title="Download vector graphic (SVG) for publication"
          >
            <Download className="w-3.5 h-3.5 text-teal-400" />
            <span>Export SVG</span>
          </button>
        </div>
      </div>

      {/* SVG Plot */}
      <div className="relative overflow-x-auto select-none">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto cursor-crosshair bg-slate-950/60 rounded-xl border border-slate-800/80"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const frac = Math.round(minFrac + ((clickX - margin.left) / plotWidth) * (maxFrac - minFrac));
            if (frac >= minFrac && frac <= maxFrac) {
              setHoveredFraction(frac);
            }
          }}
          onMouseLeave={() => setHoveredFraction(null)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const frac = Math.round(minFrac + ((clickX - margin.left) / plotWidth) * (maxFrac - minFrac));
            if (frac >= minFrac && frac <= maxFrac) {
              onSelectFraction(frac);
            }
          }}
        >
          {/* Background Grid Lines */}
          {yTicks.map((tick, i) => (
            <line
              key={i}
              x1={margin.left}
              y1={tick.y}
              x2={width - margin.right}
              y2={tick.y}
              stroke="#1e293b"
              strokeDasharray="4 4"
            />
          ))}

          {xTicks.map((frac) => (
            <line
              key={frac}
              x1={scaleX(frac)}
              y1={margin.top}
              x2={scaleX(frac)}
              y2={height - margin.bottom}
              stroke="#1e293b"
              strokeDasharray="2 4"
            />
          ))}

          {/* Selected Fraction Vertical Highlight */}
          {selectedFraction !== null && (
            <g>
              <line
                x1={scaleX(selectedFraction)}
                y1={margin.top}
                x2={scaleX(selectedFraction)}
                y2={height - margin.bottom}
                stroke="#14b8a6"
                strokeWidth={2}
                strokeDasharray="3 3"
              />
              <rect
                x={scaleX(selectedFraction) - 20}
                y={margin.top - 20}
                width={40}
                height={18}
                rx={4}
                fill="#0f766e"
              />
              <text
                x={scaleX(selectedFraction)}
                y={margin.top - 8}
                textAnchor="middle"
                fontSize={10}
                fontWeight="bold"
                fill="#ffffff"
              >
                F{selectedFraction}
              </text>
            </g>
          )}

          {/* Hovered Fraction Vertical Guide */}
          {hoveredFraction !== null && hoveredFraction !== selectedFraction && (
            <line
              x1={scaleX(hoveredFraction)}
              y1={margin.top}
              x2={scaleX(hoveredFraction)}
              y2={height - margin.bottom}
              stroke="#64748b"
              strokeWidth={1.5}
              strokeDasharray="2 2"
            />
          )}

          {/* Elution Chromatogram Paths */}
          {allCurves.map((curve) => (
            <path
              key={curve.key}
              d={generatePath(curve.fractions, curve.values)}
              fill="none"
              stroke={curve.color}
              strokeWidth={curve.dashed ? 2 : 2.5}
              strokeDasharray={curve.dashed ? '5 4' : 'none'}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.9}
            />
          ))}

          {/* Peak Apex Dots */}
          {allCurves.map((curve) => {
            const apexIdx = curve.fractions.indexOf(curve.apexFraction);
            const apexY = apexIdx >= 0 ? scaleY(curve.values[apexIdx]) : margin.top;
            return (
              <g key={`apex_${curve.key}`}>
                <circle
                  cx={scaleX(curve.apexFraction)}
                  cy={apexY}
                  r={4.5}
                  fill={curve.color}
                  stroke="#0f172a"
                  strokeWidth={2}
                />
              </g>
            );
          })}

          {/* Y Axis Labels */}
          {yTicks.map((tick, i) => (
            <text
              key={i}
              x={margin.left - 10}
              y={tick.y + 4}
              textAnchor="end"
              fontSize={10}
              fill="#94a3b8"
            >
              {tick.label}
            </text>
          ))}

          {/* X Axis Labels */}
          {xTicks.map((frac) => (
            <text
              key={frac}
              x={scaleX(frac)}
              y={height - margin.bottom + 16}
              textAnchor="middle"
              fontSize={10}
              fill="#94a3b8"
            >
              {frac}
            </text>
          ))}

          {/* Axis Titles */}
          <text
            x={margin.left + plotWidth / 2}
            y={height - 8}
            textAnchor="middle"
            fontSize={11}
            fontWeight="bold"
            fill="#cbd5e1"
          >
            SEC Fraction Number (Elution Gradient)
          </text>

          <text
            transform={`rotate(-90) translate(-${margin.top + plotHeight / 2}, 18)`}
            textAnchor="middle"
            fontSize={11}
            fontWeight="bold"
            fill="#cbd5e1"
          >
            {normMode === 'peak' ? 'Peak Normalized Intensity (0 - 1)' : normMode === 'area' ? 'Area Percentage (%)' : 'Abundance / Intensity'}
          </text>
        </svg>
      </div>

      {/* Interactive Legend & Curve List */}
      <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-slate-800/80 text-xs">
        <span className="text-slate-400 font-semibold flex items-center">
          <Eye className="w-3.5 h-3.5 mr-1 text-slate-500" /> Traces:
        </span>
        {allCurves.map((curve) => (
          <div
            key={curve.key}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800"
          >
            <span
              className="w-3.5 h-1 rounded-full"
              style={{
                backgroundColor: curve.color,
                borderStyle: curve.dashed ? 'dashed' : 'solid'
              }}
            />
            <span className="font-medium text-slate-200">{curve.label}</span>
            <span className="text-[10px] text-slate-400 px-1 py-0.2 bg-slate-800 rounded">
              Apex: F{curve.apexFraction}
            </span>
            {curve.pearsonR !== undefined && (
              <span className={`text-[10px] font-bold px-1 rounded ${
                curve.pearsonR >= 0.8 ? 'text-emerald-400 bg-emerald-950/60' : 'text-teal-400 bg-teal-950/60'
              }`}>
                R = {curve.pearsonR.toFixed(2)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
