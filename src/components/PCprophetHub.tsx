import React, { useState, useMemo } from 'react';
import { PCprophetComplex, ProteinProfile, NormalizationMode } from '../types/sec';
import { ChromatogramViewer, OverlayProfile } from './ChromatogramViewer';
import { calculatePearsonR } from '../utils/statistics';
import { downloadFile } from '../utils/export';
import { Layers, Search, Filter, Download, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';

interface PCprophetHubProps {
  complexes: PCprophetComplex[];
  profilesByGeneAndCond: Map<string, ProteinProfile>; // key: `${gene.toLowerCase()}__${condition}`
  allProfiles: ProteinProfile[];
  normMode: NormalizationMode;
  onSelectProtein: (gene: string) => void;
  initialSelectedComplexId?: string | null;
}

const SUBUNIT_PALETTE = [
  '#2dd4bf', '#fb7185', '#38bdf8', '#f59e0b', '#a78bfa',
  '#4ade80', '#ec4899', '#f43f5e', '#06b6d4', '#eab308'
];

export const PCprophetHub: React.FC<PCprophetHubProps> = ({
  complexes,
  profilesByGeneAndCond,
  allProfiles,
  normMode,
  onSelectProtein,
  initialSelectedComplexId
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [conditionFilter, setConditionFilter] = useState<string>('all');
  const [minRfScore, setMinRfScore] = useState<number>(0.5);
  const [selectedComplexId, setSelectedComplexId] = useState<string | null>(
    initialSelectedComplexId || (complexes[0]?.id || null)
  );

  // Available conditions in complexes
  const conditions = useMemo(() => {
    const set = new Set<string>();
    complexes.forEach(c => {
      if (c.condition) set.add(c.condition);
    });
    return Array.from(set);
  }, [complexes]);

  // Filter complexes
  const filteredComplexes = useMemo(() => {
    return complexes.filter(c => {
      if (conditionFilter !== 'all' && c.condition !== conditionFilter) return false;
      if (c.rf < minRfScore) return false;
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchId = c.id.toLowerCase().includes(term);
        const matchMembers = c.members.some(m => m.toLowerCase().includes(term));
        return matchId || matchMembers;
      }
      return true;
    });
  }, [complexes, conditionFilter, minRfScore, searchTerm]);

  // Active selected complex
  const activeComplex = useMemo(() => {
    if (!selectedComplexId) return filteredComplexes[0] || null;
    return complexes.find(c => c.id === selectedComplexId) || filteredComplexes[0] || null;
  }, [selectedComplexId, complexes, filteredComplexes]);

  // Subunit profiles for the active complex
  const complexSubunitProfiles = useMemo(() => {
    if (!activeComplex) return [];

    const list: { gene: string; profile: ProteinProfile | null; color: string }[] = [];
    activeComplex.members.forEach((m, idx) => {
      const keyExact = `${m.toLowerCase()}__${activeComplex.condition}`;
      let profile = profilesByGeneAndCond.get(keyExact) || null;

      // Fallback: look for this gene in any condition if not found under exact condition name
      if (!profile) {
        const alt = allProfiles.find(p => p.gene.toLowerCase() === m.toLowerCase());
        if (alt) profile = alt;
      }

      list.push({
        gene: m,
        profile,
        color: SUBUNIT_PALETTE[idx % SUBUNIT_PALETTE.length]
      });
    });

    return list;
  }, [activeComplex, profilesByGeneAndCond, allProfiles]);

  // Format profiles for ChromatogramViewer
  const primarySubunit = complexSubunitProfiles[0]?.profile;
  const overlaySubunits: OverlayProfile[] = useMemo(() => {
    return complexSubunitProfiles
      .slice(1)
      .filter((s): s is { gene: string; profile: ProteinProfile; color: string } => s.profile !== null)
      .map(s => ({
        profile: s.profile,
        color: s.color,
        label: s.gene,
        pearsonR: primarySubunit ? calculatePearsonR(primarySubunit.values, s.profile.values) : undefined
      }));
  }, [complexSubunitProfiles, primarySubunit]);

  const handleExportCSV = () => {
    const headers = ['ComplexID', 'Condition', 'RF_Probability', 'ApexFraction', 'MolecularWeight_kDa', 'Stoichiometry', 'SubunitCount', 'Members'];
    const rows = filteredComplexes.map(c => [
      c.id,
      c.condition,
      c.rf.toFixed(3),
      c.peak !== null && c.peak !== undefined ? c.peak : '',
      c.mw !== null && c.mw !== undefined ? c.mw : '',
      `"${c.stoich || ''}"`,
      c.members.length,
      `"${c.members.join(';')}"`
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csv, `pcprophet_complexes_${conditionFilter}.csv`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
                <Layers className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-white">PCprophet Complex Discovery</h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20 font-semibold">
                {filteredComplexes.length} Complexes
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Browse machine-learning verified protein complexes, validate subunit co-migration curves, and analyze stability.
            </p>
          </div>

          {/* Filter Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Condition Filter */}
            {conditions.length > 0 && (
              <div className="flex items-center space-x-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
                <span className="text-slate-400">Condition:</span>
                <select
                  value={conditionFilter}
                  onChange={(e) => setConditionFilter(e.target.value)}
                  className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="all">All Conditions</option>
                  {conditions.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Min RF Probability Slider */}
            <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400">Min RF Score:</span>
              <input
                type="range"
                min="0.1"
                max="0.99"
                step="0.05"
                value={minRfScore}
                onChange={(e) => setMinRfScore(parseFloat(e.target.value))}
                className="w-20 accent-teal-500 cursor-pointer"
              />
              <span className="font-mono text-teal-400 font-bold">{minRfScore.toFixed(2)}</span>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search complex ID or subunit..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500 w-52 sm:w-64"
              />
            </div>

            {/* Export */}
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

      {/* Main Grid: Complex List + Subunit Chromatogram Plot */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Complex Selection Table (5 columns) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col h-[600px]">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
            Predicted Complexes ({filteredComplexes.length})
          </div>

          <div className="overflow-y-auto flex-1 divide-y divide-slate-800/80 pr-1">
            {filteredComplexes.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                No complexes found matching your filters.
              </div>
            ) : (
              filteredComplexes.map((c) => {
                const isSelected = activeComplex?.id === c.id;
                return (
                  <div
                    key={`${c.id}_${c.condition}`}
                    onClick={() => setSelectedComplexId(c.id)}
                    className={`p-3 rounded-xl cursor-pointer transition text-xs ${
                      isSelected
                        ? 'bg-teal-950/40 border border-teal-500/40 text-white'
                        : 'hover:bg-slate-800/50 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold font-mono text-teal-400">{c.id}</span>
                      <div className="flex items-center space-x-1.5">
                        <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-300">
                          {c.condition}
                        </span>
                        <span className={`px-1.5 py-0.2 rounded font-mono font-bold text-[10px] ${
                          c.rf >= 0.8
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-teal-500/20 text-teal-400'
                        }`}>
                          RF {c.rf.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.members.map((m) => (
                        <span
                          key={m}
                          className="px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800 text-[10px] font-medium text-slate-300"
                        >
                          {m}
                        </span>
                      ))}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                      <span>{c.members.length} Subunits</span>
                      {c.peak !== null && c.peak !== undefined && (
                        <span>Apex Peak: F{c.peak}</span>
                      )}
                      {c.mw && <span>MW: {c.mw} kDa</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Subunit Co-Migration Chromatogram & Subunit Details (7 columns) */}
        <div className="lg:col-span-7 space-y-4">
          {activeComplex ? (
            <>
              {/* Co-Migration Chromatogram Viewer */}
              <ChromatogramViewer
                primaryProfiles={primarySubunit ? [primarySubunit] : []}
                overlayProfiles={overlaySubunits}
                normMode={normMode}
                selectedFraction={activeComplex.peak || null}
                onSelectFraction={() => {}}
                title={`Subunit Co-Elution Profile: ${activeComplex.id}`}
                subtitle={`Condition: ${activeComplex.condition} | RF Prob: ${activeComplex.rf.toFixed(3)}`}
              />

              {/* Subunits Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <h4 className="text-sm font-bold text-white mb-3 flex items-center justify-between">
                  <span>Complex Subunit Details & Pairwise Correlation</span>
                  {activeComplex.stoich && (
                    <span className="text-xs text-slate-400 font-normal">
                      Stoichiometry: <span className="text-teal-400 font-mono">{activeComplex.stoich}</span>
                    </span>
                  )}
                </h4>

                <div className="space-y-2">
                  {complexSubunitProfiles.map((s, idx) => {
                    const rWithFirst = primarySubunit && s.profile
                      ? calculatePearsonR(primarySubunit.values, s.profile.values)
                      : null;

                    return (
                      <div
                        key={s.gene}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs"
                      >
                        <div className="flex items-center space-x-3">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: s.color }}
                          />
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-white text-sm">{s.gene}</span>
                              {s.profile?.uniprot && (
                                <span className="font-mono text-slate-400 text-[11px]">
                                  {s.profile.uniprot}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate max-w-sm">
                              {s.profile?.description || 'Subunit'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-3">
                          {s.profile ? (
                            <>
                              <span className="font-mono text-slate-300">
                                Apex: F{s.profile.apexFraction}
                              </span>
                              {rWithFirst !== null && idx > 0 && (
                                <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${
                                  rWithFirst >= 0.8 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-teal-500/20 text-teal-400'
                                }`}>
                                  R = {rWithFirst.toFixed(2)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-500 text-[11px] italic">Not detected in run</span>
                          )}

                          <button
                            onClick={() => onSelectProtein(s.gene)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-teal-500 hover:text-slate-950 text-slate-200 rounded-lg font-medium transition"
                          >
                            Inspect
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
              Select a complex from the left panel to inspect its co-migration profile.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
