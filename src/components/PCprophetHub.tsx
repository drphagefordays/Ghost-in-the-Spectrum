import React, { useState, useMemo, useEffect, useRef } from 'react';
import { PCprophetComplex, ProteinProfile, NormalizationMode } from '../types/sec';
import { DiscoveryOptions } from '../utils/complexDiscovery';
import { ChromatogramViewer, OverlayProfile } from './ChromatogramViewer';
import { calculatePearsonR } from '../utils/statistics';
import { downloadFile } from '../utils/export';
import {
  Layers,
  Search,
  Download,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

export type ComplexSourceMode = 'preset' | 'discovered' | 'imported';

interface PCprophetHubProps {
  complexes: PCprophetComplex[];
  profilesByGeneAndCond: Map<string, ProteinProfile>; // key: `${gene.toLowerCase()}__${condition}`
  allProfiles: ProteinProfile[];
  normMode: NormalizationMode;
  onSelectProtein: (gene: string) => void;
  initialSelectedComplexId?: string | null;
  complexSource?: ComplexSourceMode;
  discoveryOptions?: DiscoveryOptions;
  onRunDiscovery?: (options: DiscoveryOptions) => void;
  onImportPCprophetFile?: (file: File) => Promise<void>;
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
  initialSelectedComplexId,
  complexSource = 'preset',
  discoveryOptions,
  onRunDiscovery,
  onImportPCprophetFile
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [conditionFilter, setConditionFilter] = useState<string>('all');
  const [minRfScore, setMinRfScore] = useState<number>(0.5);
  const [selectedComplexKey, setSelectedComplexKey] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState<boolean>(false);

  const [corrCutoff, setCorrCutoff] = useState<number>(discoveryOptions?.minPearsonR ?? 0.82);
  const [peakTol, setPeakTol] = useState<number>(discoveryOptions?.peakTolerance ?? 1);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Quick lookup from lowercase gene -> first matching profile (for description search & fallback lookup)
  const profileByGeneLower = useMemo(() => {
    const map = new Map<string, ProteinProfile>();
    for (const p of allProfiles) {
      const k = p.gene.toLowerCase();
      if (!map.has(k)) map.set(k, p);
    }
    return map;
  }, [allProfiles]);

  // Attach stable unique key to each complex entry
  const keyedComplexes = useMemo(() => {
    return complexes.map((c, idx) => ({
      complex: c,
      key: `${c.id}__${c.condition}__${c.peak ?? 'na'}__${idx}`
    }));
  }, [complexes]);

  // Available conditions in complexes
  const conditions = useMemo(() => {
    const set = new Set<string>();
    complexes.forEach(c => {
      if (c.condition) set.add(c.condition);
    });
    return Array.from(set);
  }, [complexes]);

  // Reset stale conditionFilter whenever dataset conditions change
  useEffect(() => {
    if (conditionFilter !== 'all' && !conditions.includes(conditionFilter)) {
      setConditionFilter('all');
    }
  }, [conditions, conditionFilter]);

  // Sync external initialSelectedComplexId (e.g. clicking a complex badge in Explorer)
  useEffect(() => {
    if (initialSelectedComplexId) {
      const match = keyedComplexes.find(item => item.complex.id === initialSelectedComplexId);
      if (match) {
        setSelectedComplexKey(match.key);
        return;
      }
    }
    setSelectedComplexKey(prev => {
      if (prev && keyedComplexes.some(item => item.key === prev)) return prev;
      return keyedComplexes[0]?.key || null;
    });
  }, [initialSelectedComplexId, keyedComplexes]);

  // Sync discovery options when updated externally
  useEffect(() => {
    if (discoveryOptions?.minPearsonR !== undefined) setCorrCutoff(discoveryOptions.minPearsonR);
    if (discoveryOptions?.peakTolerance !== undefined) setPeakTol(discoveryOptions.peakTolerance);
  }, [discoveryOptions]);

  // Filter complexes (searches ID, member gene/accession, AND member description!)
  const filteredComplexes = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return keyedComplexes.filter(({ complex: c }) => {
      if (conditionFilter !== 'all' && c.condition !== conditionFilter) return false;
      if (c.rf < minRfScore) return false;
      if (term) {
        if (c.id.toLowerCase().includes(term)) return true;
        return c.members.some(m => {
          const mLower = m.toLowerCase();
          if (mLower.includes(term)) return true;
          const prof = profileByGeneLower.get(mLower);
          if (!prof) return false;
          return (
            (prof.description && prof.description.toLowerCase().includes(term)) ||
            (prof.uniprot && prof.uniprot.toLowerCase().includes(term))
          );
        });
      }
      return true;
    });
  }, [keyedComplexes, conditionFilter, minRfScore, searchTerm, profileByGeneLower]);

  // Active selected complex
  const activeEntry = useMemo(() => {
    if (!selectedComplexKey) return filteredComplexes[0] || null;
    return (
      keyedComplexes.find(item => item.key === selectedComplexKey) ||
      filteredComplexes[0] ||
      null
    );
  }, [selectedComplexKey, keyedComplexes, filteredComplexes]);

  const activeComplex = activeEntry?.complex || null;

  // Subunit profiles for the active complex
  const complexSubunitProfiles = useMemo(() => {
    if (!activeComplex) return [];

    return activeComplex.members.map((m, idx) => {
      const mLower = m.toLowerCase();
      const keyExact = `${mLower}__${activeComplex.condition}`;
      const profile = profilesByGeneAndCond.get(keyExact) || profileByGeneLower.get(mLower) || null;
      return {
        gene: m,
        profile,
        color: SUBUNIT_PALETTE[idx % SUBUNIT_PALETTE.length]
      };
    });
  }, [activeComplex, profilesByGeneAndCond, profileByGeneLower]);

  // Pick the first DETECTED subunit as primary so charts never render blank if member[0] is missing
  const primarySubunitEntry = useMemo(() => {
    return complexSubunitProfiles.find(s => s.profile !== null) || null;
  }, [complexSubunitProfiles]);

  const primarySubunit = primarySubunitEntry?.profile || null;

  const overlaySubunits: OverlayProfile[] = useMemo(() => {
    return complexSubunitProfiles
      .filter(
        (s): s is { gene: string; profile: ProteinProfile; color: string } =>
          s.profile !== null && s !== primarySubunitEntry
      )
      .map(s => ({
        profile: s.profile,
        color: s.color,
        label: s.gene,
        pearsonR: primarySubunit ? calculatePearsonR(primarySubunit.values, s.profile.values) : undefined
      }));
  }, [complexSubunitProfiles, primarySubunitEntry, primarySubunit]);

  const handleExportCSV = () => {
    const headers = [
      'ComplexID',
      'Condition',
      'Confidence_RF',
      'ApexFraction',
      'MolecularWeight_kDa',
      'Stoichiometry',
      'SubunitCount',
      'Members'
    ];
    const rows = filteredComplexes.map(({ complex: c }) => [
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

  const handleFileImport = async (files: FileList | null) => {
    if (!files || files.length === 0 || !onImportPCprophetFile) return;
    setImportError(null);
    setImporting(true);
    try {
      await onImportPCprophetFile(files[0]);
    } catch (err: any) {
      setImportError(err.message || 'Failed to parse PCprophet output file.');
    } finally {
      setImporting(false);
    }
  };

  const handleRerunDiscovery = (nextR: number, nextTol: number) => {
    setCorrCutoff(nextR);
    setPeakTol(nextTol);
    if (onRunDiscovery) {
      onRunDiscovery({ minPearsonR: nextR, peakTolerance: nextTol });
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden PCprophet File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.tsv,.csv,.txt"
        className="hidden"
        onChange={(e) => {
          handleFileImport(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Top Banner & Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
                <Layers className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-white">PCprophet &amp; Co-Elution Complex Discovery</h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20 font-semibold">
                {filteredComplexes.length.toLocaleString()} Complexes
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
                    ? 'De Novo SEC Co-Elution'
                    : complexSource === 'imported'
                    ? 'Imported PCprophet'
                    : 'PCprophet Pre-Loaded'}
                </span>
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {complexSource === 'discovered'
                ? 'Automatically clustered from your uploaded SEC-DIA elution profiles by peak alignment, Pearson correlation, and cosine shape similarity. Tune stringency or import external PCprophet output below.'
                : 'Browse predicted protein complexes, validate subunit co-migration curves, and analyze complex stability.'}
            </p>
          </div>

          {/* Filter Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Condition Filter */}
            {conditions.length > 1 && (
              <div className="flex items-center space-x-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
                <span className="text-slate-400">Condition:</span>
                <select
                  value={conditionFilter}
                  onChange={(e) => setConditionFilter(e.target.value)}
                  className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="all" className="bg-slate-900">All Conditions</option>
                  {conditions.map(c => (
                    <option key={c} value={c} className="bg-slate-900">{c}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Min RF / Confidence Score Slider */}
            <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400">Min Score:</span>
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
                placeholder="Search ID, subunit, or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500 w-52 sm:w-64"
              />
            </div>

            {/* Import external PCprophet output */}
            {onImportPCprophetFile && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
                title="Import external PCprophet output (pcprophet_complexes.json, CombineReport.txt, ComplexReport.tsv)"
              >
                <UploadCloud className="w-3.5 h-3.5 text-sky-400" />
                <span>{importing ? 'Importing...' : 'Import PCprophet'}</span>
              </button>
            )}

            {/* Export */}
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

        {/* De Novo Clustering Controls Bar */}
        {onRunDiscovery && (
          <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-slate-400 font-semibold flex items-center space-x-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                <span>De Novo Complex Clustering:</span>
              </span>

              {/* Min Co-Elution Pearson R */}
              <div className="flex items-center space-x-1 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                <span className="text-slate-400 mr-1">Pair R ≥</span>
                {[0.75, 0.80, 0.82, 0.85, 0.90].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleRerunDiscovery(r, peakTol)}
                    className={`px-1.5 py-0.5 rounded font-mono transition ${
                      Math.abs(corrCutoff - r) < 0.005 && complexSource === 'discovered'
                        ? 'bg-sky-500 text-slate-950 font-bold'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {r.toFixed(2)}
                  </button>
                ))}
              </div>

              {/* Peak Tolerance */}
              <div className="flex items-center space-x-1 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                <span className="text-slate-400 mr-1">Apex Window:</span>
                {[0, 1, 2].map(tol => (
                  <button
                    key={tol}
                    type="button"
                    onClick={() => handleRerunDiscovery(corrCutoff, tol)}
                    className={`px-1.5 py-0.5 rounded font-mono transition ${
                      peakTol === tol && complexSource === 'discovered'
                        ? 'bg-sky-500 text-slate-950 font-bold'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    ±{tol}
                  </button>
                ))}
              </div>
            </div>

            {complexSource !== 'discovered' && (
              <button
                type="button"
                onClick={() => handleRerunDiscovery(corrCutoff, peakTol)}
                className="px-2.5 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 font-semibold transition"
              >
                Run De Novo Discovery on Active Profiles
              </button>
            )}
          </div>
        )}

        {importError && (
          <div className="p-2.5 bg-rose-950/40 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{importError}</span>
          </div>
        )}
      </div>

      {/* Main Grid: Complex List + Subunit Chromatogram Plot */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Complex Selection Table (5 columns) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col h-[600px]">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
            Predicted Complexes ({filteredComplexes.length.toLocaleString()})
          </div>

          <div className="overflow-y-auto flex-1 divide-y divide-slate-800/80 pr-1">
            {filteredComplexes.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs space-y-2 px-4">
                <div>No complexes found matching your filters.</div>
                {onRunDiscovery && complexes.length === 0 && (
                  <button
                    type="button"
                    onClick={() => handleRerunDiscovery(0.75, 1)}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-semibold transition"
                  >
                    Run Co-Elution Complex Discovery
                  </button>
                )}
              </div>
            ) : (
              filteredComplexes.slice(0, 500).map(({ complex: c, key }) => {
                const isSelected = activeEntry?.key === key;
                return (
                  <div
                    key={key}
                    onClick={() => setSelectedComplexKey(key)}
                    className={`p-3 rounded-xl cursor-pointer transition text-xs ${
                      isSelected
                        ? 'bg-teal-950/40 border border-teal-500/40 text-white'
                        : 'hover:bg-slate-800/50 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold font-mono text-teal-400">{c.id}</span>
                      <div className="flex items-center space-x-1.5">
                        <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-300 max-w-[110px] truncate" title={c.condition}>
                          {c.condition}
                        </span>
                        <span
                          className={`px-1.5 py-0.2 rounded font-mono font-bold text-[10px] ${
                            c.rf >= 0.8
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-teal-500/20 text-teal-400'
                          }`}
                        >
                          {complexSource === 'discovered' ? 'Score' : 'RF'} {c.rf.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.members.slice(0, 8).map((m, mIdx) => {
                        const prof = profileByGeneLower.get(m.toLowerCase());
                        return (
                          <span
                            key={`${m}_${mIdx}`}
                            className="px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800 text-[10px] font-medium text-slate-300 max-w-[170px] truncate"
                            title={prof?.description ? `${m} — ${prof.description}` : m}
                          >
                            {m}
                          </span>
                        );
                      })}
                      {c.members.length > 8 && (
                        <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-400">
                          +{c.members.length - 8} more
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                      <span>{c.members.length} Subunits</span>
                      {c.peak !== null && c.peak !== undefined && (
                        <span>Apex Peak: F{c.peak}</span>
                      )}
                      {c.mw ? <span>MW: {c.mw} kDa</span> : null}
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
                subtitle={`Condition: ${activeComplex.condition} | ${
                  complexSource === 'discovered' ? 'Co-Elution Score' : 'RF Prob'
                }: ${activeComplex.rf.toFixed(3)}`}
              />

              {/* Subunits Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <h4 className="text-sm font-bold text-white mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span>Complex Subunit Details &amp; Pairwise Correlation</span>
                  {activeComplex.stoich && (
                    <span className="text-xs text-slate-400 font-normal">
                      Stoichiometry:{' '}
                      <span className="text-teal-400 font-mono">{activeComplex.stoich}</span>
                    </span>
                  )}
                </h4>

                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {complexSubunitProfiles.map((s, idx) => {
                    const rWithFirst =
                      primarySubunit && s.profile && s !== primarySubunitEntry
                        ? calculatePearsonR(primarySubunit.values, s.profile.values)
                        : null;

                    return (
                      <div
                        key={`${s.gene}_${idx}`}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs"
                      >
                        <div className="flex items-center space-x-3 min-w-0">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: s.color }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-white text-sm truncate max-w-xs" title={s.gene}>
                                {s.gene}
                              </span>
                              {s.profile?.uniprot &&
                                s.profile.uniprot.toLowerCase() !== s.gene.toLowerCase() && (
                                  <span className="font-mono text-slate-400 text-[11px] shrink-0">
                                    {s.profile.uniprot}
                                  </span>
                                )}
                            </div>
                            <div
                              className="text-[11px] text-slate-400 truncate max-w-md"
                              title={s.profile?.description || 'Subunit'}
                            >
                              {s.profile?.description || 'Subunit'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-3 shrink-0">
                          {s.profile ? (
                            <>
                              <span className="font-mono text-slate-300">
                                Apex: F{s.profile.apexFraction}
                              </span>
                              {rWithFirst !== null && (
                                <span
                                  className={`font-mono font-bold px-1.5 py-0.5 rounded ${
                                    rWithFirst >= 0.8
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : 'bg-teal-500/20 text-teal-400'
                                  }`}
                                >
                                  R = {rWithFirst.toFixed(2)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-500 text-[11px] italic">Not detected in run</span>
                          )}

                          <button
                            type="button"
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
