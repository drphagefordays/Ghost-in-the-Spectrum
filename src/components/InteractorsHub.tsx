import React, { useState, useMemo, useEffect } from 'react';
import { PCprophetPPI, ProteinProfile, NormalizationMode } from '../types/sec';
import { ChromatogramViewer, OverlayProfile } from './ChromatogramViewer';
import { calculatePearsonR } from '../utils/statistics';
import { downloadFile } from '../utils/export';
import { Share2, Search, Download, Layers, Network, Sparkles } from 'lucide-react';
import { ComplexSourceMode } from './PCprophetHub';

interface InteractorsHubProps {
  ppis: PCprophetPPI[];
  profilesByGene: Map<string, ProteinProfile[]>;
  allProteinsList: string[];
  normMode: NormalizationMode;
  selectedGene: string;
  onSelectGene: (gene: string) => void;
  onInspectComplex?: (complexId: string) => void;
  complexSource?: ComplexSourceMode;
}

const INTERACTOR_COLORS = [
  '#fb7185', '#38bdf8', '#f59e0b', '#a78bfa', '#4ade80',
  '#ec4899', '#06b6d4', '#eab308', '#2dd4bf', '#818cf8'
];

function shortNodeLabel(label: string, maxLen: number): string {
  if (label.length <= maxLen) return label;
  return label.slice(0, maxLen - 1) + '…';
}

export const InteractorsHub: React.FC<InteractorsHubProps> = ({
  ppis,
  profilesByGene,
  allProteinsList,
  normMode,
  selectedGene,
  onSelectGene,
  onInspectComplex,
  complexSource = 'preset'
}) => {
  const [searchInput, setSearchInput] = useState<string>('');
  const [conditionFilter, setConditionFilter] = useState<string>('all');
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);

  const conditions = useMemo(() => {
    const set = new Set<string>();
    ppis.forEach(p => {
      if (p.condition) set.add(p.condition);
    });
    return Array.from(set);
  }, [ppis]);

  useEffect(() => {
    if (conditionFilter !== 'all' && !conditions.includes(conditionFilter)) {
      setConditionFilter('all');
    }
  }, [conditions, conditionFilter]);

  // Top connected hub proteins in the active PPI network (helpful quick-picks if selectedGene has 0 partners)
  const topHubProteins = useMemo(() => {
    const counts = new Map<string, { gene: string; degree: number }>();
    for (const p of ppis) {
      const aKey = p.geneA.toLowerCase();
      const bKey = p.geneB.toLowerCase();
      const ea = counts.get(aKey) || { gene: p.geneA, degree: 0 };
      ea.degree += 1;
      counts.set(aKey, ea);
      const eb = counts.get(bKey) || { gene: p.geneB, degree: 0 };
      eb.degree += 1;
      counts.set(bKey, eb);
    }
    return Array.from(counts.values())
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 6);
  }, [ppis]);

  // Autocomplete suggestions (searches gene, accession, and description!)
  const searchSuggestions = useMemo(() => {
    if (!searchInput.trim() || searchInput.length < 2) return [];
    const term = searchInput.toLowerCase();
    const matches: { gene: string; desc: string }[] = [];
    for (const g of allProteinsList) {
      const prof = profilesByGene.get(g.toLowerCase())?.[0];
      if (
        g.toLowerCase().includes(term) ||
        (prof?.uniprot && prof.uniprot.toLowerCase().includes(term)) ||
        (prof?.description && prof.description.toLowerCase().includes(term))
      ) {
        matches.push({ gene: g, desc: prof?.description || '' });
        if (matches.length >= 8) break;
      }
    }
    return matches;
  }, [searchInput, allProteinsList, profilesByGene]);

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
      if (cleanKey === target) return;
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

  // Query protein profiles
  const targetProfiles = useMemo(() => {
    return profilesByGene.get(selectedGene.toLowerCase()) || [];
  }, [profilesByGene, selectedGene]);

  const primaryProfile = targetProfiles[0] || null;

  // Interactor profiles with computed correlations, sorted strongest first
  const partnerProfilesWithStats = useMemo(() => {
    return partnersList
      .map(p => {
        const pProfiles = profilesByGene.get(p.gene.toLowerCase()) || [];
        const bestProfile =
          (primaryProfile && pProfiles.find(item => item.condition === primaryProfile.condition)) ||
          pProfiles[0] ||
          null;

        let pearsonR: number | undefined = undefined;
        if (primaryProfile && bestProfile) {
          pearsonR = calculatePearsonR(primaryProfile.values, bestProfile.values);
        }

        return {
          ...p,
          profile: bestProfile,
          pearsonR
        };
      })
      .sort((a, b) => (b.pearsonR ?? -1) - (a.pearsonR ?? -1))
      .map((item, idx) => ({
        ...item,
        color: INTERACTOR_COLORS[idx % INTERACTOR_COLORS.length]
      }));
  }, [partnersList, profilesByGene, primaryProfile]);

  // Limit radial graph to top 16 partners for visual clarity
  const graphPartners = useMemo(() => {
    return partnerProfilesWithStats.slice(0, 16);
  }, [partnerProfilesWithStats]);

  // Overlays for Chromatogram (top 10 strongest partners so chart remains crisp)
  const overlayProfiles: OverlayProfile[] = useMemo(() => {
    return partnerProfilesWithStats
      .slice(0, 10)
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
      `"${selectedGene.replace(/"/g, '""')}"`,
      `"${p.gene.replace(/"/g, '""')}"`,
      `"${p.conditions.join(';')}"`,
      `"${p.complexIds.join(';')}"`,
      p.profile ? `F${p.profile.apexFraction}` : 'N/A',
      p.pearsonR !== undefined ? p.pearsonR.toFixed(3) : 'N/A'
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csv, `interactors_${selectedGene.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}.csv`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Search */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
                <Share2 className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-white">Protein Interaction Network (PPI)</h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20 font-semibold max-w-xs truncate" title={selectedGene}>
                {partnersList.length} Interactors for {shortNodeLabel(selectedGene, 24)}
              </span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border flex items-center space-x-1 ${
                  complexSource === 'discovered'
                    ? 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                    : complexSource === 'imported'
                    ? 'bg-purple-500/10 text-purple-300 border-purple-500/20'
                    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>
                  {complexSource === 'discovered'
                    ? 'De Novo Co-Elution Network'
                    : complexSource === 'imported'
                    ? 'Imported PCprophet PPIs'
                    : 'PCprophet Pre-Loaded'}
                </span>
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Search any target protein to inspect its co-eluting interaction partners, complex memberships, and co-migration curves.
            </p>
          </div>

          {/* Search & Condition Controls */}
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              {conditions.length > 1 && (
                <div className="flex items-center space-x-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs">
                  <span className="text-slate-400">Cond:</span>
                  <select
                    value={conditionFilter}
                    onChange={(e) => setConditionFilter(e.target.value)}
                    className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value="all" className="bg-slate-900">All</option>
                    {conditions.map(c => (
                      <option key={c} value={c} className="bg-slate-900">{c}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search protein or description..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500 w-56 sm:w-64"
                />
                {searchSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl z-20 overflow-hidden divide-y divide-slate-800/80">
                    {searchSuggestions.map(s => (
                      <div
                        key={s.gene}
                        onClick={() => {
                          onSelectGene(s.gene);
                          setSearchInput('');
                        }}
                        className="px-3 py-2 text-xs text-slate-300 hover:bg-teal-950/40 hover:text-teal-400 cursor-pointer"
                      >
                        <div className="font-bold truncate">{s.gene}</div>
                        {s.desc && <div className="text-[10px] text-slate-500 truncate">{s.desc}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
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
            <div className="flex items-center justify-between mb-2 gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center min-w-0">
                <Network className="w-4 h-4 mr-1 text-teal-400 shrink-0" />
                <span className="truncate" title={selectedGene}>
                  Interaction Graph: {shortNodeLabel(selectedGene, 28)}
                </span>
              </span>
              <span className="text-[11px] text-slate-500 shrink-0">
                {partnerProfilesWithStats.length > 16
                  ? `Top 16 of ${partnerProfilesWithStats.length} partners`
                  : 'Edge thickness = Pearson R'}
              </span>
            </div>

            <div className="relative flex items-center justify-center p-2 bg-slate-950/80 rounded-xl border border-slate-800/80">
              <svg viewBox="0 0 420 320" className="w-full h-64 select-none">
                {(() => {
                  const cx = 210;
                  const cy = 160;
                  const radius = 112;
                  const count = graphPartners.length;

                  return (
                    <g>
                      {/* Interaction Edges */}
                      {graphPartners.map((p, idx) => {
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
                      {graphPartners.map((p, idx) => {
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
                            <title>
                              {p.gene}
                              {p.profile?.description ? ` — ${p.profile.description}` : ''}
                              {p.pearsonR !== undefined ? ` (R = ${p.pearsonR.toFixed(2)})` : ''}
                            </title>
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
                              fontSize={8.5}
                              fontWeight="bold"
                              fill="#f1f5f9"
                            >
                              {shortNodeLabel(p.gene, 8)}
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
                        <title>{selectedGene}</title>
                        <circle
                          cx={cx}
                          cy={cy}
                          r={30}
                          fill="#0d9488"
                          stroke="#ffffff"
                          strokeWidth={2.5}
                          className="shadow-lg"
                        />
                        <text
                          x={cx}
                          y={cy + 4}
                          textAnchor="middle"
                          fontSize={10}
                          fontWeight="bold"
                          fill="#ffffff"
                        >
                          {shortNodeLabel(selectedGene, 10)}
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
                <div className="text-center py-6 text-slate-400 space-y-3 px-2">
                  <div>
                    No high-confidence co-eluting PPIs recorded for{' '}
                    <span className="text-white font-semibold">{selectedGene}</span>.
                  </div>
                  {topHubProteins.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] text-slate-500">Try a well-connected hub in this dataset:</div>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {topHubProteins.map(h => (
                          <button
                            key={h.gene}
                            type="button"
                            onClick={() => onSelectGene(h.gene)}
                            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-teal-500/20 hover:text-teal-300 text-slate-200 border border-slate-700 text-[11px] font-medium max-w-[180px] truncate transition"
                            title={`${h.gene} (${h.degree} partners)`}
                          >
                            {shortNodeLabel(h.gene, 20)} ({h.degree})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                partnerProfilesWithStats.map(p => (
                  <div
                    key={p.gene}
                    className="p-2.5 rounded-xl hover:bg-slate-800/50 flex items-center justify-between gap-2 transition"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <div className="min-w-0">
                        <div className="font-bold text-white flex items-center space-x-1.5">
                          <span className="truncate max-w-[200px]" title={p.gene}>{p.gene}</span>
                          {p.complexIds.length > 0 && p.complexIds[0].startsWith('cmplx__') && (
                            <button
                              type="button"
                              onClick={() => onInspectComplex && onInspectComplex(p.complexIds[0])}
                              className="text-[10px] px-1 py-0.2 rounded bg-slate-800 hover:bg-teal-500/20 text-teal-400 font-mono shrink-0 transition"
                              title="Inspect complex in PCprophet Hub"
                            >
                              {p.complexIds[0]}
                            </button>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-xs" title={p.profile?.description || ''}>
                          {p.profile?.description || 'Co-eluting interactor'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0">
                      {p.pearsonR !== undefined && (
                        <span
                          className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${
                            p.pearsonR >= 0.8
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : p.pearsonR >= 0.6
                              ? 'bg-teal-500/20 text-teal-400'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          R = {p.pearsonR.toFixed(2)}
                        </span>
                      )}

                      <button
                        type="button"
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
            title={`Co-Migration Chromatogram: ${selectedGene}`}
            subtitle={`Validating physical complex interaction via SEC profile overlap`}
          />

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl text-xs text-slate-300">
            <h4 className="font-bold text-white mb-2 flex items-center space-x-1.5">
              <Layers className="w-4 h-4 text-teal-400" />
              <span>How Co-Elution &amp; PCprophet Interactors Work</span>
            </h4>
            <p className="leading-relaxed text-slate-400">
              Physical protein complexes co-migrate across Size-Exclusion Chromatography fractions. High Pearson correlation (<span className="text-emerald-400 font-semibold">R &gt; 0.8</span>) coupled with matching elution apex fractions and peak shape similarity indicates stable complex assembly. For uploaded datasets without an external PCprophet report, interactions are automatically inferred de novo and can be tuned in the PCprophet Complexes tab.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
