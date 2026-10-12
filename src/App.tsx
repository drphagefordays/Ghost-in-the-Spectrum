import React, { useState, useEffect, useMemo } from 'react';
import { ProteinProfile, DatasetMeta, PCprophetComplex, PCprophetPPI, NormalizationMode } from './types/sec';
import { parseSECDIAData, exportCombinedCSV } from './utils/parser';
import { calculatePearsonR } from './utils/statistics';
import { downloadFile } from './utils/export';
import { Navbar } from './components/Navbar';
import { ChromatogramViewer, OverlayProfile } from './components/ChromatogramViewer';
import { SameFractionTable } from './components/SameFractionTable';
import { PCprophetHub } from './components/PCprophetHub';
import { InteractorsHub } from './components/InteractorsHub';
import { CombinedDatasetExport } from './components/CombinedDatasetExport';
import { DataIngestionModal } from './components/DataIngestionModal';
import { Search, Activity, Layers, Share2, Sparkles, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

export const App: React.FC = () => {
  const [profiles, setProfiles] = useState<ProteinProfile[]>([]);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [complexes, setComplexes] = useState<PCprophetComplex[]>([]);
  const [ppis, setPpis] = useState<PCprophetPPI[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // User selections
  const [activeTab, setActiveTab] = useState<'explorer' | 'complexes' | 'interactors' | 'combined'>('explorer');
  const [normMode, setNormMode] = useState<NormalizationMode>('raw');
  const [selectedGene, setSelectedGene] = useState<string>('dnaN');
  const [selectedFraction, setSelectedFraction] = useState<number | null>(null);
  const [selectedComplexId, setSelectedComplexId] = useState<string | null>(null);

  // Search input state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);

  // Active overlay traces (toggled from SameFractionTable)
  const [activeOverlays, setActiveOverlays] = useState<Set<string>>(new Set());

  // Upload modal
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);

  // Initial Data Loading: Load pre-bundled combined matrix + PCprophet JSON
  useEffect(() => {
    async function loadInitialData() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const baseUrl = import.meta.env.BASE_URL || '/';
        const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

        // 1. Fetch pre-bundled combined CSV
        const csvRes = await fetch(`${cleanBase}data/report_pg_matrix_combined_app.csv`);
        if (!csvRes.ok) {
          throw new Error(`Failed to load default dataset: ${csvRes.statusText}`);
        }
        const csvText = await csvRes.text();
        const parsed = await parseSECDIAData(csvText, 'report_pg_matrix_combined_app.csv');

        setProfiles(parsed.profiles);
        setDatasets(parsed.metadata);

        // 2. Fetch PCprophet complexes & PPIs
        try {
          const compRes = await fetch(`${cleanBase}data/pcprophet_complexes.json`);
          if (compRes.ok) {
            const compData = await compRes.json();
            setComplexes(compData);
          }

          const ppiRes = await fetch(`${cleanBase}data/pcprophet_ppis.json`);
          if (ppiRes.ok) {
            const ppiData = await ppiRes.json();
            setPpis(ppiData);
          }
        } catch (e) {
          console.warn('Could not load PCprophet assets:', e);
        }

        // Set default gene if dnaN is available
        const hasDnaN = parsed.profiles.some(p => p.gene.toLowerCase() === 'dnan');
        if (hasDnaN) {
          setSelectedGene('dnaN');
        } else if (parsed.profiles[0]) {
          setSelectedGene(parsed.profiles[0].gene);
        }
      } catch (err: any) {
        console.error('Data load error:', err);
        setLoadError(err.message || 'Error loading datasets.');
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialData();
  }, []);

  // Indexed maps for high-performance lookup
  const profilesByGene = useMemo(() => {
    const map = new Map<string, ProteinProfile[]>();
    profiles.forEach(p => {
      const g = p.gene.toLowerCase();
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    });
    return map;
  }, [profiles]);

  const profilesByGeneAndCond = useMemo(() => {
    const map = new Map<string, ProteinProfile>();
    profiles.forEach(p => {
      map.set(`${p.gene.toLowerCase()}__${p.condition}`, p);
    });
    return map;
  }, [profiles]);

  const allGenesList = useMemo(() => {
    return Array.from(profilesByGene.keys()).map(k => profilesByGene.get(k)![0].gene);
  }, [profilesByGene]);

  // Map of gene -> complex IDs
  const complexMembersMap = useMemo(() => {
    const map = new Map<string, string[]>();
    complexes.forEach(c => {
      c.members.forEach(m => {
        const clean = m.toLowerCase();
        if (!map.has(clean)) map.set(clean, []);
        map.get(clean)!.push(c.id);
      });
    });
    return map;
  }, [complexes]);

  // Map of gene -> Set of interacting genes
  const ppiPartnersMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    ppis.forEach(p => {
      const a = p.geneA.toLowerCase();
      const b = p.geneB.toLowerCase();
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    });
    return map;
  }, [ppis]);

  // Active conditions
  const activeConditions = useMemo(() => {
    const set = new Set<string>();
    profiles.forEach(p => set.add(p.condition));
    return Array.from(set);
  }, [profiles]);

  // Profiles of the currently queried gene
  const currentQueryProfiles = useMemo(() => {
    return profilesByGene.get(selectedGene.toLowerCase()) || [];
  }, [profilesByGene, selectedGene]);

  // Primary profile (defaulting to first condition or 60min)
  const primaryQueryProfile = useMemo(() => {
    if (currentQueryProfiles.length === 0) return null;
    const cond60 = currentQueryProfiles.find(p => /60min/i.test(p.condition));
    return cond60 || currentQueryProfiles[0];
  }, [currentQueryProfiles]);

  // Automatically update selected fraction when query protein changes
  useEffect(() => {
    if (primaryQueryProfile) {
      setSelectedFraction(primaryQueryProfile.apexFraction);
    }
  }, [primaryQueryProfile]);

  // Toggle overlay traces
  const handleToggleOverlay = (profile: ProteinProfile) => {
    const next = new Set(activeOverlays);
    if (next.has(profile.id)) {
      next.delete(profile.id);
    } else {
      next.add(profile.id);
    }
    setActiveOverlays(next);
  };

  // Overlay profile list for ChromatogramViewer
  const overlayProfilesList: OverlayProfile[] = useMemo(() => {
    const list: OverlayProfile[] = [];
    const colors = ['#f59e0b', '#38bdf8', '#a78bfa', '#4ade80', '#ec4899', '#06b6d4'];
    let cIdx = 0;

    activeOverlays.forEach(id => {
      const p = profiles.find(item => item.id === id);
      if (p) {
        list.push({
          profile: p,
          color: colors[cIdx % colors.length],
          dashed: true,
          label: `${p.gene} (${p.condition})`,
          pearsonR: primaryQueryProfile ? calculatePearsonR(primaryQueryProfile.values, p.values) : undefined
        });
        cIdx++;
      }
    });

    return list;
  }, [activeOverlays, profiles, primaryQueryProfile]);

  // Autocomplete suggestions for top search bar
  const searchSuggestions = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];
    const term = searchQuery.toLowerCase();
    const matches: { gene: string; desc: string; uniprot: string }[] = [];

    for (const gene of allGenesList) {
      const p = profilesByGene.get(gene.toLowerCase())?.[0];
      if (!p) continue;
      if (
        p.gene.toLowerCase().includes(term) ||
        (p.uniprot && p.uniprot.toLowerCase().includes(term)) ||
        (p.description && p.description.toLowerCase().includes(term))
      ) {
        matches.push({ gene: p.gene, desc: p.description, uniprot: p.uniprot });
        if (matches.length >= 8) break;
      }
    }
    return matches;
  }, [searchQuery, allGenesList, profilesByGene]);

  // Handlers
  const handleSelectGene = (gene: string) => {
    setSelectedGene(gene);
    setSearchQuery('');
    setIsSearchOpen(false);
    setActiveOverlays(new Set()); // Reset overlays on new query protein
  };

  const handleDownloadCombined = () => {
    const csv = exportCombinedCSV(profiles);
    downloadFile(csv, 'report_pg_matrix_combined_app.csv');
  };

  const handleCustomDataLoaded = (newProfiles: ProteinProfile[], newMeta: DatasetMeta[]) => {
    setProfiles(newProfiles);
    setDatasets(newMeta);
    if (newProfiles.length > 0) {
      setSelectedGene(newProfiles[0].gene);
    }
  };

  const handleInspectComplex = (complexId: string) => {
    setSelectedComplexId(complexId);
    setActiveTab('complexes');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-300">
        <Loader2 className="w-12 h-12 text-teal-400 animate-spin mb-4" />
        <h2 className="text-xl font-bold text-white">Loading SEC-DIA App Datasets...</h2>
        <p className="text-sm text-slate-400 mt-2">
          Parsing fraction matrices and initializing PCprophet complexes & PPI interactors...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-100">
      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        normMode={normMode}
        setNormMode={setNormMode}
        onOpenUpload={() => setIsUploadOpen(true)}
        onDownloadCombined={handleDownloadCombined}
        totalProteins={allGenesList.length}
        activeConditions={activeConditions}
        fractionCount={profiles[0]?.fractions.length || 70}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Global Protein Search Bar & Metadata Header */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl relative z-30">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Search Input with Autocomplete */}
            <div className="relative flex-1 max-w-lg">
              <div className="relative">
                <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search target protein (e.g. dnaN, recF, gyrB, MSMEG_0002)..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setIsSearchOpen(true);
                  }}
                  onFocus={() => setIsSearchOpen(true)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl pl-11 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 shadow-inner"
                />
              </div>

              {/* Suggestions Dropdown */}
              {isSearchOpen && searchSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden divide-y divide-slate-800/80 z-40">
                  {searchSuggestions.map((s) => (
                    <div
                      key={s.gene}
                      onClick={() => handleSelectGene(s.gene)}
                      className="p-3 hover:bg-teal-950/40 cursor-pointer transition flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-bold text-white text-sm flex items-center space-x-2">
                          <span>{s.gene}</span>
                          {s.uniprot && (
                            <span className="font-mono text-slate-400 text-xs">{s.uniprot}</span>
                          )}
                        </div>
                        <div className="text-slate-400 text-[11px] truncate max-w-md">{s.desc}</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-teal-400 opacity-60" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Protein Summary Badges */}
            {primaryQueryProfile && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* Gene Badge */}
                <div className="px-3 py-1.5 rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-300 font-bold flex items-center space-x-1.5">
                  <Activity className="w-4 h-4 text-teal-400" />
                  <span>{primaryQueryProfile.gene}</span>
                  {primaryQueryProfile.uniprot && (
                    <span className="text-[11px] font-mono text-slate-400">({primaryQueryProfile.uniprot})</span>
                  )}
                </div>

                {/* Primary Apex Fraction */}
                <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 flex items-center space-x-1 font-mono">
                  <span className="text-slate-500">Apex:</span>
                  <span className="font-bold text-white">F{primaryQueryProfile.apexFraction}</span>
                </div>

                {/* Complex Membership */}
                <div
                  onClick={() => {
                    const cids = complexMembersMap.get(primaryQueryProfile.gene.toLowerCase());
                    if (cids && cids[0]) handleInspectComplex(cids[0]);
                  }}
                  className={`px-3 py-1.5 rounded-xl border flex items-center space-x-1 cursor-pointer transition ${
                    (complexMembersMap.get(primaryQueryProfile.gene.toLowerCase()) || []).length > 0
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                      : 'bg-slate-950 border-slate-800 text-slate-500'
                  }`}
                  title="Click to view complex in PCprophet Hub"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>
                    {(complexMembersMap.get(primaryQueryProfile.gene.toLowerCase()) || []).length} Complexes
                  </span>
                </div>

                {/* Known Interactors */}
                <div
                  onClick={() => setActiveTab('interactors')}
                  className={`px-3 py-1.5 rounded-xl border flex items-center space-x-1 cursor-pointer transition ${
                    (ppiPartnersMap.get(primaryQueryProfile.gene.toLowerCase()) || new Set()).size > 0
                      ? 'bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20'
                      : 'bg-slate-950 border-slate-800 text-slate-500'
                  }`}
                  title="Click to view interactors in Interactors Hub"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>
                    {(ppiPartnersMap.get(primaryQueryProfile.gene.toLowerCase()) || new Set()).size} PPI Partners
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* TAB 1: Profile Explorer & Same Fraction Search */}
        {activeTab === 'explorer' && (
          <div className="space-y-6">
            {/* Primary Multi-Condition & Multi-Trace Chromatogram */}
            <ChromatogramViewer
              primaryProfiles={currentQueryProfiles}
              overlayProfiles={overlayProfilesList}
              normMode={normMode}
              selectedFraction={selectedFraction}
              onSelectFraction={(f) => setSelectedFraction(f)}
              title={`Elution Chromatogram: ${selectedGene}`}
              subtitle={primaryQueryProfile?.description || undefined}
            />

            {/* Same-Fraction & Co-Eluting Proteins Explorer Table */}
            <SameFractionTable
              queryProfile={primaryQueryProfile}
              allProfilesInCondition={
                primaryQueryProfile
                  ? profiles.filter(p => p.condition === primaryQueryProfile.condition)
                  : profiles
              }
              targetFraction={selectedFraction}
              complexMembersMap={complexMembersMap}
              ppiPartnersMap={ppiPartnersMap}
              activeOverlays={activeOverlays}
              onToggleOverlay={handleToggleOverlay}
              onSelectQueryGene={handleSelectGene}
              onInspectComplex={handleInspectComplex}
            />
          </div>
        )}

        {/* TAB 2: PCprophet Complexes Hub */}
        {activeTab === 'complexes' && (
          <PCprophetHub
            complexes={complexes}
            profilesByGeneAndCond={profilesByGeneAndCond}
            allProfiles={profiles}
            normMode={normMode}
            onSelectProtein={handleSelectGene}
            initialSelectedComplexId={selectedComplexId}
          />
        )}

        {/* TAB 3: Interactors & PPI Network Hub */}
        {activeTab === 'interactors' && (
          <InteractorsHub
            ppis={ppis}
            profilesByGene={profilesByGene}
            allProteinsList={allGenesList}
            normMode={normMode}
            selectedGene={selectedGene}
            onSelectGene={handleSelectGene}
            onInspectComplex={handleInspectComplex}
          />
        )}

        {/* TAB 4: Combined Dataset & Ingestion Manager */}
        {activeTab === 'combined' && (
          <CombinedDatasetExport
            datasets={datasets}
            allProfiles={profiles}
            onLoadPreloadedCombined={() => {
              // Reload combined dataset
              window.location.reload();
            }}
          />
        )}
      </main>

      {/* Ingestion & Upload Modal */}
      <DataIngestionModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onDataLoaded={handleCustomDataLoaded}
      />
    </div>
  );
};
