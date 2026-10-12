import React from 'react';
import { Layers, Activity, Share2, UploadCloud, Download, Sparkles, Filter } from 'lucide-react';
import { NormalizationMode } from '../types/sec';

interface NavbarProps {
  activeTab: 'explorer' | 'complexes' | 'interactors' | 'combined';
  setActiveTab: (tab: 'explorer' | 'complexes' | 'interactors' | 'combined') => void;
  normMode: NormalizationMode;
  setNormMode: (mode: NormalizationMode) => void;
  onOpenUpload: () => void;
  onDownloadCombined: () => void;
  totalProteins: number;
  activeConditions: string[];
  fractionCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  normMode,
  setNormMode,
  onOpenUpload,
  onDownloadCombined,
  totalProteins,
  activeConditions,
  fractionCount
}) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Activity className="w-6 h-6 text-slate-950 font-bold" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-bold text-white tracking-tight">SEC-DIA Explorer</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-teal-500/10 text-teal-400 border border-teal-500/20">
                  PCprophet & PhageMap
                </span>
              </div>
              <div className="text-xs text-slate-400 flex items-center space-x-2">
                <span>{totalProteins.toLocaleString()} Proteins</span>
                <span>•</span>
                <span>{fractionCount} Fractions</span>
                <span>•</span>
                <span className="text-teal-400">{activeConditions.join(', ') || 'No data'}</span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex space-x-1 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('explorer')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'explorer'
                  ? 'bg-teal-500 text-slate-950 font-semibold shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Chromatograms & Co-Elution</span>
            </button>

            <button
              onClick={() => setActiveTab('complexes')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'complexes'
                  ? 'bg-teal-500 text-slate-950 font-semibold shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>PCprophet Complexes</span>
            </button>

            <button
              onClick={() => setActiveTab('interactors')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'interactors'
                  ? 'bg-teal-500 text-slate-950 font-semibold shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Share2 className="w-4 h-4" />
              <span>Interactors & PPI Network</span>
            </button>

            <button
              onClick={() => setActiveTab('combined')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'combined'
                  ? 'bg-teal-500 text-slate-950 font-semibold shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Combined CSV & Datasets</span>
            </button>
          </nav>

          {/* Right Tools & Normalization */}
          <div className="flex items-center space-x-3">
            {/* Normalization Selector */}
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs">
              <span className="px-2 text-slate-500 flex items-center">
                <Filter className="w-3 h-3 mr-1" /> Norm:
              </span>
              {(['raw', 'peak', 'area'] as NormalizationMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setNormMode(mode)}
                  className={`px-2 py-1 rounded capitalize transition-all ${
                    normMode === mode
                      ? 'bg-slate-800 text-teal-400 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={
                    mode === 'raw'
                      ? 'Raw mass-spec MS1/MS2 peak intensity'
                      : mode === 'peak'
                      ? 'Normalized by maximum peak (0 - 1)'
                      : 'Normalized by total profile area (% of sum)'
                  }
                >
                  {mode}
                </button>
              ))}
            </div>

            {/* Ingest / Upload Button */}
            <button
              onClick={onOpenUpload}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-medium border border-slate-700 transition"
              title="Upload custom CSVs or combined matrices"
            >
              <UploadCloud className="w-4 h-4 text-teal-400" />
              <span className="hidden sm:inline">Ingest Data</span>
            </button>

            {/* Download Combined CSV */}
            <button
              onClick={onDownloadCombined}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-teal-500/20 transition"
              title="Download unified combined CSV"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export Combined CSV</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
