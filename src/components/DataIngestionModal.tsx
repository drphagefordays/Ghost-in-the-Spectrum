import React, { useState } from 'react';
import { parseSECDIAData } from '../utils/parser';
import { ProteinProfile, DatasetMeta } from '../types/sec';
import { anonymizeProfiles, exportAnonymizationKeyCSV } from '../utils/anonymizer';
import { downloadFile } from '../utils/export';
import { UploadCloud, X, FileText, CheckCircle2, AlertCircle, Sparkles, ShieldCheck, Download } from 'lucide-react';

interface DataIngestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataLoaded: (profiles: ProteinProfile[], metadata: DatasetMeta[]) => void;
}

export const DataIngestionModal: React.FC<DataIngestionModalProps> = ({
  isOpen,
  onClose,
  onDataLoaded
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoAnonymize, setAutoAnonymize] = useState(true);
  const [downloadableKey, setDownloadableKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successSummary, setSuccessSummary] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessSummary(null);
    setDownloadableKey(null);

    try {
      let allNewProfiles: ProteinProfile[] = [];
      const allNewMeta: DatasetMeta[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await parseSECDIAData(file, file.name);
        allNewProfiles.push(...res.profiles);
        allNewMeta.push(...res.metadata);
      }

      if (autoAnonymize) {
        const anonRes = anonymizeProfiles(allNewProfiles);
        allNewProfiles = anonRes.anonymizedProfiles;
        const keyCsv = exportAnonymizationKeyCSV(anonRes.keyEntries);
        setDownloadableKey(keyCsv);
        setSuccessSummary(
          `Imported ${allNewProfiles.length.toLocaleString()} profiles. GDPR Anonymization applied!`
        );
      } else {
        setSuccessSummary(
          `Successfully imported ${allNewProfiles.length.toLocaleString()} profiles across ${allNewMeta.length} run(s)!`
        );
      }

      onDataLoaded(allNewProfiles, allNewMeta);
      if (!autoAnonymize) {
        setTimeout(() => onClose(), 1200);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to parse CSV file(s). Please verify formatting.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-xl w-full shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-white p-1 rounded-lg transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Ingest SEC DIA Datasets</h3>
            <p className="text-xs text-slate-400">
              Supports single CSVs, multi-file batch upload, or unified combined matrices.
            </p>
          </div>
        </div>

        {/* GDPR Auto-Anonymization Toggle */}
        <div className="mb-4 p-3 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                <span>GDPR Anonymization Shield</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-semibold">Recommended</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Pseudonymizes gene & protein names (PRT_0001, UP_0001) and generates a private local de-anonymization key.
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autoAnonymize}
              onChange={(e) => setAutoAnonymize(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
          </label>
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.tsv,.txt"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {/* Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition cursor-pointer ${
            isDragging
              ? 'border-teal-400 bg-teal-950/20'
              : 'border-slate-700 hover:border-slate-600 bg-slate-950/50'
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud className="w-10 h-10 text-teal-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-200">
            {loading ? 'Processing & parsing matrix...' : 'Drop CSV files here or click to browse'}
          </p>
          <p className="text-xs text-slate-400 mt-1 mb-3">
            Accepts multiple individual files (e.g. 60min + 120min) or combined datasets.
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-teal-400 hover:text-teal-300 rounded-lg text-xs font-semibold border border-slate-700 shadow-sm transition"
          >
            <span>Browse CSV Files</span>
          </button>
        </div>

        {/* Feedback messages */}
        {errorMsg && (
          <div className="mt-4 p-3 bg-rose-950/40 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successSummary && (
          <div className="mt-4 p-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 space-y-2">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span className="font-semibold">{successSummary}</span>
            </div>
            {downloadableKey && (
              <div className="pt-2 border-t border-emerald-500/20 flex items-center justify-between">
                <span className="text-[11px] text-emerald-400">Save your private de-anonymization mapping key locally:</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadFile(downloadableKey, 'private_deanonymization_key.csv');
                  }}
                  className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold shadow transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Key (.csv)</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="mt-5 p-4 bg-slate-950/60 rounded-xl border border-slate-800 text-xs text-slate-400 space-y-1.5">
          <div className="font-semibold text-slate-300 flex items-center space-x-1">
            <Sparkles className="w-3.5 h-3.5 text-teal-400" />
            <span>Intelligent Format Auto-Detection:</span>
          </div>
          <ul className="list-disc list-inside space-y-1 pl-1 text-[11px]">
            <li><b>Flexible Fractions:</b> Automatically handles any fraction count (24, 48, 70, 96, etc.).</li>
            <li><b>Multi-Replicate & Plates:</b> Identifies <code className="text-slate-300">Replicate</code>, <code className="text-slate-300">Plate</code>, or embedded header prefixes.</li>
            <li><b>Multi-File Batch:</b> Select multiple CSVs at once; condition names are automatically inferred.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
