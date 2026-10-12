import React, { useState, useMemo } from 'react';
import { PCprophetPPI, ProteinProfile, NormalizationMode } from '../types/sec';
import { ChromatogramViewer, OverlayProfile } from './ChromatogramViewer';
import { calculatePearsonR } from '../utils/statistics';
import { downloadFile } from '../utils/export';
import { Share2, Search, Download, Layers, Eye, Network, CheckCircle2 } from 'lucide-react';

interface InteractorsHubProps {
  ppis: PCprophetPPI[];
  profilesByGene: Map<string, ProteinProfile[]>;
  allProteinsList: string[];
  normMode: NormalizationMode;
  selectedGene: string;
  onSelectGene: (gene: string) => void;
  onInspectComplex?: (complexId: string) => void;
}

const INTERACTOR_COLORS = [
  '#fb7185', '#38bdf8', '#f59e0b', '#a78bfa', '#4ade80',
  '#ec4899', '#06b6d4', '#eab308', '#2dd4bf', '#818cf8'
];

export const InteractorsHub: React.FC<InteractorsHubProps> = ({
  ppis,
  profilesByGene,
  allProteinsList,
  normMode,
  selectedGene,
  onSelectGene,
  onInspectComplex
}) => {
  const [searchInput, setSearchInput] = useState<string>('');
  const [conditionFilter, setConditionFilter] = useState<string>('all');
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);

  // Autocomplete suggestions
  const searchSuggestions = useMemo(() => {
    if (!searchInput.trim() || searchInput.length < 2) return [];
    const term = searchInput.toLowerCase();
    return allProteinsList.filter(g => g.toLowerCase().includes(term)).slice(0, 8);
  }, [searchInput, allProteinsList]);

  // Find all PPIs for the selected gene
  const genePPIs = useMemo(() => {
    if (!selectedGene) return [];
    const target = selectedGene.toLowerCase();

    return ppis.filter(p => {
      const matchA = p.geneA.toLowerCase() === target;
      const matchB = p.geneB.toLowerCase() === target;
      if (!matchA && !matchB) return false;
      if (conditionFilter !== 'all' && p.condition !== conditionFilter) return false;
      return true;
    });
  }, [ppis, selectedGene, conditionFilter]);

  // Unique partner genes
  const partnersList = useMemo(() => {
    const target = selectedGene.toLowerCase();
    const map = new Map<string, { gene: string; complexIds: Set<string>; conditions: Set<string> }>();

    genePPIs.forEach(p => {
      const partner = p.geneA.toLowerCase() === target ? p.geneB : p.geneA;
      const cleanKey = partner.toLowerCase();
      if (!map.has(cleanKey)) {
        map.set(cleanKey, { gene: partner, complexIds: new Set(), conditions: new Set() });
      }
      const entry = map.get(cleanKey)!;
      if (p.complex_id) entry.complexIds.add(p.complex_id);
      if (p.condition) entry.conditions.add(p.condition);
    });

    return Array.from(map.values()).map(v => ({
      gene: v.gene,
      complexIds: Array.from(v.complexIds),
      conditions: Array.from(v.conditions)
    }));
  }, [genePPIs, selectedGene]);

  // Query protein profiles (e.g. 60min, 120min)
  const targetProfiles = useMemo(() => {
    return profilesByGene.get(selectedGene.toLowerCase()) || [];
  }, [profilesByGene, selectedGene]);

  const primaryProfile = targetProfiles[0] || null;

  // Interactor profiles with computed correlations
  const partnerProfilesWithStats = useMemo(() => {
    return partnersList.map((p, idx) => {
      const pProfiles = profilesByGene.get(p.gene.toLowerCase()) || [];
      const bestProfile = pProfiles[0] || null;

      let pearsonR: number | undefined = undefined;
      if (primaryProfile && bestProfile) {
        pearsonR = calculatePearsonR(primaryProfile.values, bestProfile.values);
      }

      return {
        ...p,
        profile: bestProfile,
        color: INTERACTOR_COLORS[idx % INTERACTOR_COLORS.length],
        pearsonR
      };
    });
  }, [partnersList, profilesByGene, primaryProfile]);

  // Overlays for Chromatogram
  const overlayProfiles: OverlayProfile[] = useMemo(() => {
    return partnerProfilesWithStats
      .filter((p): p is typeof p & { profile: ProteinProfile } => p.profile !== null)
      .map(p => ({
        profile: p.profile,
        color: p.color,
        label: p.gene,
        pearsonR: p.pearsonR
      }));
  }, [partnerProfilesWithStats]);

  const handleExportCSV = () => {
    const headers = ['QueryGene', 'PartnerGene', 'Conditions', 'ComplexIDs', 'PartnerApex', 'PearsonR_vs_Query'];
    const rows = partnerProfilesWithStats.map(p => [
      selectedGene,
      p.gene,
      `"${p.conditions.join(';')}"`,
      `"${p.complexIds.join(';')}"`,
      p.profile ? `F${p.profile.apexFraction}` : 'N/A',
      p.pearsonR !== undefined ? p.pearsonR.toFixed(3) : 'N/A'
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csv, `interactors_${selectedGene}.csv`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Search */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
                <Share2 className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-white">Protein Interaction Network (PPI)</h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20 font-semibold">
                {partnersList.length} Interactors for {selectedGene}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Search any target protein to reveal its PCprophet physical interaction partners, complex memberships, and co-migration curves.
            </p>
          </div>

          {/* Search Box */}
          <div className="relative">
            <div className="flex items-center space-x-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search protein (e.g. dnaN, recF)..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500 w-56 sm:w-64"
                />
                {searchSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl z-20 overflow-hidden divide-y divide-slate-800/80">
                    {searchSuggestions.map(s => (
                      <div
                        key={s}
                        onClick={() => {
                          onSelectGene(s);
                          setSearchInput('');
                        }}
                        className="px-3 py-2 text-xs text-slate-300 hover:bg-teal-950/40 hover:text-teal-400 cursor-pointer font-bold"
                      >
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleExportCSV}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
              >
                <Download className="w-3.5 h-3.5 text-teal-400" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Interactive Network Graph + Chromatogram Overlay */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: SVG Network Graph & Partners Table (6 columns) */}
        <div className="lg:col-span-6 space-y-4">
          {/* Radial Network Diagram */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center">
                <Network className="w-4 h-4 mr-1 text-teal-400" /> Interaction Graph: {selectedGene}
              </span>
              <span className="text-[11px] text-slate-500">Node line = co-elution correlation</span>
            </div>

            <div className="relative flex items-center justify-center p-2 bg-slate-950/80 rounded-xl border border-slate-800/80">
              <svg viewBox="0 0 420 320" className="w-full h-64 select-none">
                {/* Center Coordinates */}
                {(() => {
                  const cx = 210;
                  const cy = 160;
                  const radius = 110;
                  const count = partnerProfilesWithStats.length;

                  return (
                    <g>
                      {/* Interaction Edges */}
                      {partnerProfilesWithStats.map((p, idx) => {
                        const angle = (idx / (count || 1)) * 2 * Math.PI - Math.PI / 2;
                        const nx = cx + radius * Math.cos(angle);
                        const ny = cy + radius * Math.sin(angle);
                        const r = p.pearsonR ?? 0.5;
                        const strokeW = Math.max(1, r * 3.5);

                        return (
                          <line
                            key={`edge_${p.gene}`}
                            x1={cx}
                            y1={cy}
                            x2={nx}
                            y2={ny}
                            stroke={r >= 0.7 ? '#10b981' : r >= 0.4 ? '#14b8a6' : '#475569'}
                            strokeWidth={strokeW}
                            strokeDasharray={r < 0.4 ? '4 4' : 'none'}
                            opacity={0.8}
                          />
                        );
                      })}

                      {/* Surrounding Nodes (Interacting Partners) */}
                      {partnerProfilesWithStats.map((p, idx) => {
                        const angle = (idx / (count || 1)) * 2 * Math.PI - Math.PI / 2;
                        const nx = cx + radius * Math.cos(angle);
                        const ny = cy + radius * Math.sin(angle);
                        const isHovered = selectedPartner === p.gene;

                        return (
                          <g
                            key={`node_${p.gene}`}
                            className="cursor-pointer"
                            onClick={() => onSelectGene(p.gene)}
                            onMouseEnter={() => setSelectedPartner(p.gene)}
                            onMouseLeave={() => setSelectedPartner(null)}
                          >
                            <circle
                              cx={nx}
                              cy={ny}
                              r={isHovered ? 20 : 16}
                              fill="#0f172a"
                              stroke={p.color}
                              strokeWidth={isHovered ? 3 : 2}
                              className="transition-all"
                            />
                            <text
                              x={nx}
                              y={ny + 3.5}
                              textAnchor="middle"
                              fontSize={9}
                              fontWeight="bold"
                              fill="#f1f5f9"
                            >
                              {p.gene.length > 7 ? p.gene.slice(0, 6) + '..' : p.gene}
                            </text>
                            {p.pearsonR !== undefined && (
                              <text
                                x={nx}
                                y={ny + 24}
                                textAnchor="middle"
                                fontSize={8}
                                fill={p.pearsonR >= 0.7 ? '#34d399' : '#94a3b8'}
                                fontWeight="bold"
                              >
                                R {p.pearsonR.toFixed(2)}
                              </text>
                            )}
                          </g>
                        );
                      })}

                      {/* Center Query Node */}
                      <g className="cursor-pointer">
                        <circle
                          cx={cx}
                          cy={cy}
                          r={28}
                          fill="#0d9488"
                          stroke="#ffffff"
                          strokeWidth={2.5}
                          className="shadow-lg"
                        />
                        <text
                          x={cx}
                          y={cy + 4.5}
                          textAnchor="middle"
                          fontSize={11}
                          fontWeight="bold"
                          fill="#ffffff"
                        >
                          {selectedGene}
                        </text>
                      </g>
                    </g>
                  );
                })()}
              </svg>
            </div>
          </div>

          {/* Interactors Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
              Interacting Partners List ({partnerProfilesWithStats.length})
            </div>

            <div className="overflow-y-auto max-h-64 divide-y divide-slate-800/80 pr-1 text-xs">
              {partnerProfilesWithStats.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  No direct PCprophet PPIs recorded for {selectedGene}. Try searching another protein (e.g. dnaN, recF, gyrB).
                </div>
              ) : (
                partnerProfilesWithStats.map((p) => (
                  <div
                    key={p.gene}
                    className="p-2.5 rounded-xl hover:bg-slate-800/50 flex items-center justify-between transition"
                  >
                    <div className="flex items-center space-x-2.5">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <div>
                        <div className="font-bold text-white flex items-center space-x-1.5">
                          <span>{p.gene}</span>
                          {p.complexIds.length > 0 && (
                            <span className="text-[10px] px-1 py-0.2 rounded bg-slate-800 text-teal-400 font-mono">
                              {p.complexIds[0]}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {p.profile?.description || 'Detected interactor'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      {p.pearsonR !== undefined && (
                        <span className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${
                          p.pearsonR >= 0.8
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : p.pearsonR >= 0.6
                            ? 'bg-teal-500/20 text-teal-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          R = {p.pearsonR.toFixed(2)}
                        </span>
                      )}

                      <button
                        onClick={() => onSelectGene(p.gene)}
                        className="px-2 py-1 bg-slate-800 hover:bg-teal-500 hover:text-slate-950 text-slate-200 rounded font-medium transition"
                      >
                        Inspect
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right: Simultaneous Chromatogram Overlay of Query & Interactors (6 columns) */}
        <div className="lg:col-span-6 space-y-4">
          <ChromatogramViewer
            primaryProfiles={targetProfiles}
            overlayProfiles={overlayProfiles}
            normMode={normMode}
            selectedFraction={primaryProfile?.apexFraction || null}
            onSelectFraction={() => {}}
            title={`Co-Migration Chromatogram: ${selectedGene} & Interactors`}
            subtitle={`Validating physical complex interaction via SEC profile overlap`}
          />

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl text-xs text-slate-300">
            <h4 className="font-bold text-white mb-2 flex items-center space-x-1.5">
              <Layers className="w-4 h-4 text-teal-400" />
              <span>How PCprophet Interactors Work</span>
            </h4>
            <p className="leading-relaxed text-slate-400">
              PCprophet assesses whether two proteins physically associate by evaluating their SEC co-fractionation profiles across sequential fractions. High Pearson correlation (<span className="text-emerald-400 font-semibold">R &gt; 0.8</span>) coupled with matching elution apex fractions indicates stable complex membership. Peak shifts between timepoints (e.g. 60min vs 120min) reflect dynamic assembly, remodeling, or disassembly.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
