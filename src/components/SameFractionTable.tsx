import React, { useState, useMemo } from 'react';
import { ProteinProfile, CoelutingCandidate } from '../types/sec';
import { calculatePearsonR, calculateCosineSimilarity } from '../utils/statistics';
import { downloadFile } from '../utils/export';
import { Search, SlidersHorizontal, Download, Layers, Share2, CheckSquare, Square, ArrowUpDown, ExternalLink } from 'lucide-react';

interface SameFractionTableProps {
  queryProfile: ProteinProfile | null;
  allProfilesInCondition: ProteinProfile[];
  targetFraction: number | null;
  complexMembersMap: Map<string, string[]>; // gene -> array of complex_ids
  ppiPartnersMap: Map<string, Set<string>>; // gene -> set of interacting genes
  activeOverlays: Set<string>;
  onToggleOverlay: (profile: ProteinProfile) => void;
  onSelectQueryGene: (gene: string) => void;
  onInspectComplex?: (complexId: string) => void;
}

export const SameFractionTable: React.FC<SameFractionTableProps> = ({
  queryProfile,
  allProfilesInCondition,
  targetFraction,
  complexMembersMap,
  ppiPartnersMap,
  activeOverlays,
  onToggleOverlay,
  onSelectQueryGene,
  onInspectComplex
}) => {
  const [fractionTolerance, setFractionTolerance] = useState<number>(1); // +/- 1 fraction by default
  const [minPearsonR, setMinPearsonR] = useState<number>(0.0);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortBy, setSortBy] = useState<'pearson' | 'intensity' | 'offset' | 'gene'>('pearson');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Compute co-eluting candidates
  const candidates: CoelutingCandidate[] = useMemo(() => {
    if (!queryProfile) return [];

    const effectiveFraction = targetFraction !== null ? targetFraction : queryProfile.apexFraction;
    const queryGene = queryProfile.gene.toLowerCase();
    const knownPartners = ppiPartnersMap.get(queryGene) || new Set<string>();
    const queryComplexes = new Set(complexMembersMap.get(queryGene) || []);

    const list: CoelutingCandidate[] = [];

    for (const p of allProfilesInCondition) {
      // Don't compare protein with itself
      if (p.gene.toLowerCase() === queryGene) continue;

      // Fraction tolerance check
      const offset = Math.abs(p.apexFraction - effectiveFraction);
      if (fractionTolerance >= 0 && offset > fractionTolerance) continue;

      // Pearson correlation across the entire elution gradient
      const r = calculatePearsonR(queryProfile.values, p.values);
      if (r < minPearsonR) continue;

      const pGene = p.gene.toLowerCase();
      const dot = calculateCosineSimilarity(queryProfile.values, p.values);

      // Check complex co-membership
      const pComplexes = complexMembersMap.get(pGene) || [];
      const sharedComplexes = pComplexes.filter(c => queryComplexes.has(c));
      const inSameComplex = sharedComplexes.length > 0;

      // Check known PPI interaction
      const isKnownInteractor = knownPartners.has(pGene);

      list.push({
        profile: p,
        pearsonR: r,
        dotProduct: dot,
        peakOffset: p.apexFraction - effectiveFraction,
        inSameComplex,
        isKnownInteractor,
        complexIds: sharedComplexes
      });
    }

    return list;
  }, [queryProfile, allProfilesInCondition, targetFraction, fractionTolerance, minPearsonR, complexMembersMap, ppiPartnersMap]);

  // Filtered & sorted list
  const filteredCandidates = useMemo(() => {
    let result = candidates;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(c =>
        c.profile.gene.toLowerCase().includes(term) ||
        (c.profile.uniprot && c.profile.uniprot.toLowerCase().includes(term)) ||
        (c.profile.description && c.profile.description.toLowerCase().includes(term))
      );
    }

    return result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'pearson') {
        cmp = b.pearsonR - a.pearsonR;
      } else if (sortBy === 'intensity') {
        cmp = b.profile.apexIntensity - a.profile.apexIntensity;
      } else if (sortBy === 'offset') {
        cmp = Math.abs(a.peakOffset) - Math.abs(b.peakOffset);
      } else if (sortBy === 'gene') {
        cmp = a.profile.gene.localeCompare(b.profile.gene);
      }
      return sortAsc ? -cmp : cmp;
    });
  }, [candidates, searchTerm, sortBy, sortAsc]);

  const handleExportCSV = () => {
    if (!queryProfile || filteredCandidates.length === 0) return;
    const headers = ['QueryGene', 'CandidateGene', 'UniProt', 'Description', 'ApexFraction', 'PeakOffset', 'PearsonR', 'CosineSimilarity', 'PeakIntensity', 'InSameComplex', 'IsKnownInteractor', 'ComplexIDs'];
    const rows = filteredCandidates.map(c => [
      queryProfile.gene,
      c.profile.gene,
      c.profile.uniprot || '',
      `"${(c.profile.description || '').replace(/"/g, '""')}"`,
      c.profile.apexFraction,
      c.peakOffset,
      c.pearsonR.toFixed(4),
      c.dotProduct.toFixed(4),
      c.profile.apexIntensity,
      c.inSameComplex ? 'YES' : 'NO',
      c.isKnownInteractor ? 'YES' : 'NO',
      `"${c.complexIds.join(';')}"`
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csv, `coeluting_${queryProfile.gene}_F${targetFraction || queryProfile.apexFraction}.csv`);
  };

  const handleSort = (type: 'pearson' | 'intensity' | 'offset' | 'gene') => {
    if (sortBy === type) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(type);
      setSortAsc(false);
    }
  };

  if (!queryProfile) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">
        Search and select a protein above to see co-fractionating and co-eluting proteins.
      </div>
    );
  }

  const activeFrac = targetFraction !== null ? targetFraction : queryProfile.apexFraction;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
      {/* Title & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h3 className="text-base font-bold text-white">
              Proteins Co-Eluting in Fraction {activeFrac}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-500/10 text-teal-400 border border-teal-500/20">
              {filteredCandidates.length} Candidates
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Target: <span className="text-teal-400 font-semibold">{queryProfile.gene}</span> (Apex at Fraction {queryProfile.apexFraction} in {queryProfile.condition})
          </p>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Fraction Window Tolerance */}
          <div className="flex items-center space-x-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-slate-400">Fraction Window:</span>
            {[0, 1, 2, -1].map((w) => (
              <button
                key={w}
                onClick={() => setFractionTolerance(w)}
                className={`px-2 py-0.5 rounded transition ${
                  fractionTolerance === w
                    ? 'bg-teal-500 text-slate-950 font-bold'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title={w === -1 ? 'Search across all fractions' : `Allow +/- ${w} fractions`}
              >
                {w === -1 ? 'All' : `±${w}`}
              </button>
            ))}
          </div>

          {/* Min Pearson R Slider */}
          <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-slate-400">Min R:</span>
            <input
              type="range"
              min="0"
              max="0.95"
              step="0.05"
              value={minPearsonR}
              onChange={(e) => setMinPearsonR(parseFloat(e.target.value))}
              className="w-20 accent-teal-500 cursor-pointer"
            />
            <span className="font-mono text-teal-400 font-semibold w-8">{minPearsonR.toFixed(2)}</span>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter candidates..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500 w-36 sm:w-44"
            />
          </div>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition"
            title="Download candidates as CSV"
          >
            <Download className="w-3.5 h-3.5 text-teal-400" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Candidate Table */}
      <div className="mt-4 overflow-x-auto max-h-[460px] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 text-slate-400 font-semibold sticky top-0 z-10 border-b border-slate-800">
            <tr>
              <th className="py-2.5 px-3 w-10 text-center">Overlay</th>
              <th className="py-2.5 px-3 cursor-pointer hover:text-white" onClick={() => handleSort('gene')}>
                <div className="flex items-center space-x-1">
                  <span>Gene / Protein</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-2.5 px-3">UniProt</th>
              <th className="py-2.5 px-3 cursor-pointer hover:text-white" onClick={() => handleSort('offset')}>
                <div className="flex items-center space-x-1">
                  <span>Apex Frac (ΔF)</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-2.5 px-3 cursor-pointer hover:text-white" onClick={() => handleSort('pearson')}>
                <div className="flex items-center space-x-1">
                  <span>Co-Elution R</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-2.5 px-3">Dot Product</th>
              <th className="py-2.5 px-3 cursor-pointer hover:text-white" onClick={() => handleSort('intensity')}>
                <div className="flex items-center space-x-1">
                  <span>Peak Intensity</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-2.5 px-3">Complex & Interactors</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredCandidates.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-500">
                  No proteins found matching the criteria in fraction {activeFrac} (±{fractionTolerance}). Try increasing tolerance or lowering the correlation slider.
                </td>
              </tr>
            ) : (
              filteredCandidates.map((c) => {
                const isOverlaid = activeOverlays.has(c.profile.id);
                return (
                  <tr
                    key={c.profile.id}
                    className={`hover:bg-slate-800/40 transition-colors ${
                      isOverlaid ? 'bg-teal-950/20' : ''
                    }`}
                  >
                    {/* Toggle Overlay Checkbox */}
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => onToggleOverlay(c.profile)}
                        className="text-slate-400 hover:text-teal-400 transition"
                        title={isOverlaid ? 'Remove from chromatogram' : 'Overlay trace on chromatogram'}
                      >
                        {isOverlaid ? (
                          <CheckSquare className="w-4 h-4 text-teal-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-600 hover:text-slate-400" />
                        )}
                      </button>
                    </td>

                    {/* Gene Name & Badges */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white">{c.profile.gene}</span>
                        {c.inSameComplex && (
                          <span
                            className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center space-x-0.5 cursor-pointer"
                            onClick={() => c.complexIds[0] && onInspectComplex && onInspectComplex(c.complexIds[0])}
                            title={`Member of ${c.complexIds.join(', ')}`}
                          >
                            <Layers className="w-2.5 h-2.5 mr-0.5" />
                            <span>Same Complex</span>
                          </span>
                        )}
                        {c.isKnownInteractor && (
                          <span
                            className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center space-x-0.5"
                            title="Direct PCprophet PPI Partner"
                          >
                            <Share2 className="w-2.5 h-2.5 mr-0.5" />
                            <span>PPI</span>
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate max-w-xs" title={c.profile.description}>
                        {c.profile.description || '—'}
                      </div>
                    </td>

                    {/* UniProt */}
                    <td className="py-2.5 px-3 font-mono text-slate-300">
                      {c.profile.uniprot ? (
                        <a
                          href={`https://www.uniprot.org/uniprotkb/${c.profile.uniprot}`}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-teal-400 flex items-center space-x-1"
                        >
                          <span>{c.profile.uniprot}</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>

                    {/* Apex Fraction & Offset */}
                    <td className="py-2.5 px-3 font-mono">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-bold text-slate-200">F{c.profile.apexFraction}</span>
                        <span className={`text-[10px] px-1 rounded ${
                          c.peakOffset === 0
                            ? 'bg-teal-500/20 text-teal-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {c.peakOffset === 0 ? 'Exact' : `${c.peakOffset > 0 ? '+' : ''}${c.peakOffset}`}
                        </span>
                      </div>
                    </td>

                    {/* Pearson Correlation Bar */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center space-x-2">
                        <div className="w-16 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              c.pearsonR >= 0.8
                                ? 'bg-emerald-400'
                                : c.pearsonR >= 0.6
                                ? 'bg-teal-400'
                                : c.pearsonR >= 0.4
                                ? 'bg-amber-400'
                                : 'bg-slate-600'
                            }`}
                            style={{ width: `${Math.max(0, c.pearsonR * 100)}%` }}
                          />
                        </div>
                        <span className={`font-mono font-bold ${
                          c.pearsonR >= 0.8
                            ? 'text-emerald-400'
                            : c.pearsonR >= 0.6
                            ? 'text-teal-400'
                            : c.pearsonR >= 0.4
                            ? 'text-amber-400'
                            : 'text-slate-400'
                        }`}>
                          {c.pearsonR.toFixed(2)}
                        </span>
                      </div>
                    </td>

                    {/* Dot Product */}
                    <td className="py-2.5 px-3 font-mono text-slate-300">
                      {c.dotProduct.toFixed(2)}
                    </td>

                    {/* Apex Intensity */}
                    <td className="py-2.5 px-3 font-mono text-slate-300">
                      {c.profile.apexIntensity >= 1e6
                        ? `${(c.profile.apexIntensity / 1e6).toFixed(1)}M`
                        : c.profile.apexIntensity >= 1e3
                        ? `${(c.profile.apexIntensity / 1e3).toFixed(0)}k`
                        : c.profile.apexIntensity.toFixed(0)}
                    </td>

                    {/* Complex IDs */}
                    <td className="py-2.5 px-3">
                      {c.complexIds.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {c.complexIds.slice(0, 2).map((cid) => (
                            <button
                              key={cid}
                              onClick={() => onInspectComplex && onInspectComplex(cid)}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-mono transition"
                            >
                              {cid}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => onSelectQueryGene(c.profile.gene)}
                        className="px-2 py-1 bg-slate-800 hover:bg-teal-600 hover:text-slate-950 text-slate-200 rounded font-medium transition"
                        title="Set this protein as the main search target"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
