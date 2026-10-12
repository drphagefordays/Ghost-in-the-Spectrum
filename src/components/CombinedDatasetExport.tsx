import React, { useState } from 'react';
import { ProteinProfile, DatasetMeta } from '../types/sec';
import { exportCombinedCSV } from '../utils/parser';
import { downloadFile } from '../utils/export';
import { anonymizeProfiles, exportAnonymizationKeyCSV } from '../utils/anonymizer';
import { Download, Layers, Sparkles, CheckCircle2, FileText, Settings, ArrowDownRight, ShieldCheck } from 'lucide-react';

interface CombinedDatasetExportProps {
  datasets: DatasetMeta[];
  allProfiles: ProteinProfile[];
  onLoadPreloadedCombined: () => void;
}

export const CombinedDatasetExport: React.FC<CombinedDatasetExportProps> = ({
  datasets,
  allProfiles,
  onLoadPreloadedCombined
}) => {
  const [exportFormat, setExportFormat] = useState<'stacked' | 'wide'>('stacked');

  const handleDownload = () => {
    if (exportFormat === 'stacked') {
      const csv = exportCombinedCSV(allProfiles);
      downloadFile(csv, 'report_pg_matrix_combined_app.csv');
    } else {
      // Wide format generation
      const conditions = Array.from(new Set(allProfiles.map(p => p.condition)));
      const fractions = allProfiles[0]?.fractions || [];
      const genesMap = new Map<string, { uniprot: string; desc: string; mw?: number; runs: Map<string, number[]> }>();

      allProfiles.forEach(p => {
        if (!genesMap.has(p.gene)) {
          genesMap.set(p.gene, {
            uniprot: p.uniprot,
            desc: p.description,
            mw: p.mw,
            runs: new Map()
          });
        }
        genesMap.get(p.gene)!.runs.set(p.condition, p.values);
      });

      // Headers: Gene, UniProt, Complex, MonomerMW_kDa, [cond]_[frac]
      const fracHeaders: string[] = [];
      conditions.forEach(cond => {
        fractions.forEach(f => {
          fracHeaders.push(`${cond}_Fraction_${f}`);
        });
      });

      const headers = ['Gene', 'UniProt', 'Complex', 'MonomerMW_kDa', ...fracHeaders];
      const rows: string[] = [];

      genesMap.forEach((val, gene) => {
        const meta = [
          gene,
          val.uniprot || '',
          val.desc ? `"${val.desc.replace(/"/g, '""')}"` : '',
          val.mw !== undefined ? val.mw.toString() : ''
        ];
        const vals: string[] = [];
        conditions.forEach(cond => {
          const runVals = val.runs.get(cond) || fractions.map(() => 0);
          runVals.forEach(v => vals.push(v.toString()));
        });
        rows.push([...meta, ...vals].join(','));
      });

      const csv = [headers.join(','), ...rows].join('\n');
      downloadFile(csv, 'report_pg_matrix_wide_combined_app.csv');
    }
  };

  const handleDownloadAnonymized = () => {
    const anonRes = anonymizeProfiles(allProfiles);
    const csv = exportCombinedCSV(anonRes.anonymizedProfiles);
    downloadFile(csv, 'report_pg_matrix_combined_anonymized.csv');
  };

  const handleDownloadAnonymizationKey = () => {
    const anonRes = anonymizeProfiles(allProfiles);
    const keyCsv = exportAnonymizationKeyCSV(anonRes.keyEntries);
    downloadFile(keyCsv, 'anonymization_key_private.csv');
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                <Sparkles className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-white">Combined Dataset Manager & Exporter</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Combine your SEC DIA runs (such as 60min and 120min timepoints, replicates, or plates) into a standardized single CSV that is universally accepted by this app and downstream tools like PCprophet.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={onLoadPreloadedCombined}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
              title="Load the pre-bundled combined 60min + 120min matrix"
            >
              Load Default Combined Matrix
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-teal-500/20 transition"
            >
              <Download className="w-4 h-4" />
              <span>Download Combined CSV</span>
            </button>
          </div>
        </div>

        {/* Format Selector */}
        <div className="mt-6 p-4 bg-slate-950/80 rounded-xl border border-slate-800">
          <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center space-x-2">
            <Settings className="w-3.5 h-3.5 text-teal-400" />
            <span>Select Export Format Structure:</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              onClick={() => setExportFormat('stacked')}
              className={`p-3.5 rounded-xl border cursor-pointer transition text-xs ${
                exportFormat === 'stacked'
                  ? 'bg-teal-950/40 border-teal-500/60 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between font-bold mb-1">
                <span className="text-teal-400">1. Tidy Stacked Matrix (Recommended)</span>
                {exportFormat === 'stacked' && <CheckCircle2 className="w-4 h-4 text-teal-400" />}
              </div>
              <p className="text-[11px] text-slate-400">
                Each row corresponds to one protein in one condition/replicate. Contains standard columns: <code className="text-slate-300">Gene, UniProt, Complex, Condition, Fraction_1...Fraction_70</code>.
              </p>
            </div>

            <div
              onClick={() => setExportFormat('wide')}
              className={`p-3.5 rounded-xl border cursor-pointer transition text-xs ${
                exportFormat === 'wide'
                  ? 'bg-teal-950/40 border-teal-500/60 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between font-bold mb-1">
                <span className="text-teal-400">2. Wide Multi-Condition Matrix</span>
                {exportFormat === 'wide' && <CheckCircle2 className="w-4 h-4 text-teal-400" />}
              </div>
              <p className="text-[11px] text-slate-400">
                Single row per protein; fraction columns are prefixed by condition, e.g. <code className="text-slate-300">60min_Fraction_1... 120min_Fraction_1...</code>.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* GDPR De-Identification & Anonymization Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold shrink-0 mt-0.5">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white">GDPR De-Identification & Anonymization</h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Compliance
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-xl">
                Pseudonymize all Gene symbols (PRT_0001...), UniProt accessions (UP_0001...), and protein descriptions. Keep all quantitative SEC fraction intensities and correlations mathematically intact while protecting proprietary identities.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleDownloadAnonymized}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-500/20 transition"
            >
              <Download className="w-4 h-4" />
              <span>Export Anonymized Matrix (.csv)</span>
            </button>

            <button
              onClick={handleDownloadAnonymizationKey}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
              title="Download private local lookup table"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Download De-Anonymization Key</span>
            </button>
          </div>
        </div>
      </div>

      {/* Active Datasets Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center space-x-2">
          <Layers className="w-4 h-4 text-teal-400" />
          <span>Currently Loaded Runs & Replicates ({datasets.length})</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Dataset Name</th>
                <th className="py-2.5 px-3">Condition / Timepoint</th>
                <th className="py-2.5 px-3">Replicate</th>
                <th className="py-2.5 px-3">Plate</th>
                <th className="py-2.5 px-3">Fractions Detected</th>
                <th className="py-2.5 px-3">Proteins Detected</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {datasets.map((ds) => (
                <tr key={ds.id} className="hover:bg-slate-800/30">
                  <td className="py-2.5 px-3 font-medium text-white flex items-center space-x-2">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    <span>{ds.name}</span>
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-teal-400">{ds.condition}</td>
                  <td className="py-2.5 px-3">{ds.replicate || 'Rep 1'}</td>
                  <td className="py-2.5 px-3">{ds.plate || 'Plate 1'}</td>
                  <td className="py-2.5 px-3 font-mono">{ds.fractionCount} Fractions</td>
                  <td className="py-2.5 px-3 font-mono">{ds.proteinCount.toLocaleString()} Proteins</td>
                  <td className="py-2.5 px-3 text-right">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400">
                      Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
