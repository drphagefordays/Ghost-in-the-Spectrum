import React, { useState } from 'react';
import { parseSECDIAData } from '../utils/parser';
import { ProteinProfile, DatasetMeta } from '../types/sec';
import { UploadCloud, X, FileText, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successSummary, setSuccessSummary] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessSummary(null);

    try {
      const allNewProfiles: ProteinProfile[] = [];
      const allNewMeta: DatasetMeta[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await parseSECDIAData(file, file.name);
        allNewProfiles.push(...res.profiles);
        allNewMeta.push(...res.metadata);
      }

      onDataLoaded(allNewProfiles, allNewMeta);
      setSuccessSummary(
        `Successfully imported ${allNewProfiles.length.toLocaleString()} profiles across ${allNewMeta.length} condition/replicate run(s)!`
      );
      setTimeout(() => {
        onClose();
      }, 1200);
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
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.csv,.tsv,.txt';
            input.onchange = (e: any) => handleFiles(e.target.files);
            input.click();
          }}
        >
          <UploadCloud className="w-10 h-10 text-teal-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-200">
            {loading ? 'Processing & parsing matrix...' : 'Drop CSV files here or click to browse'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Accepts multiple individual files (e.g. 60min + 120min) or combined datasets.
          </p>
        </div>

        {/* Feedback messages */}
        {errorMsg && (
          <div className="mt-4 p-3 bg-rose-950/40 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successSummary && (
          <div className="mt-4 p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successSummary}</span>
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
