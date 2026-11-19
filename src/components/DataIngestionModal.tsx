import React, { useState, useMemo } from 'react';
import {
  inspectSECDIAFile,
  buildProfilesFromInspection,
  buildManualFractionColumns,
  FileInspectionResult,
  ColumnMapping,
  ColumnStats,
  AggregationMode
} from '../utils/parser';
import { ProteinProfile, DatasetMeta } from '../types/sec';
import { anonymizeProfiles, exportAnonymizationKeyCSV } from '../utils/anonymizer';
import { downloadFile } from '../utils/export';
import {
  UploadCloud,
  X,
  FileText,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  Download,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  ArrowRight,
  Table
} from 'lucide-react';

interface DataIngestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataLoaded: (profiles: ProteinProfile[], metadata: DatasetMeta[], isAnonymized: boolean) => void;
}

function truncateText(text: string, maxLen: number = 34): string {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function formatColOptionLabel(colName: string, stat?: ColumnStats): string {
  if (!stat || stat.sampleValues.length === 0) {
    return `${colName} (empty)`;
  }
  const example = truncateText(stat.sampleValues[0], 30);
  const pct = Math.round(stat.fillRate * 100);
  return pct < 100
    ? `${colName} — e.g. "${example}" (${pct}% filled)`
    : `${colName} — e.g. "${example}"`;
}

function formatCompactNumber(raw?: string): string {
  if (!raw) return '—';
  const v = parseFloat(raw);
  if (isNaN(v) || !isFinite(v)) return '—';
  if (v === 0) return '0';
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
}

export const DataIngestionModal: React.FC<DataIngestionModalProps> = ({
  isOpen,
  onClose,
  onDataLoaded
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoAnonymize, setAutoAnonymize] = useState(false);
  const [downloadableKey, setDownloadableKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successSummary, setSuccessSummary] = useState<string | null>(null);

  // Staged file inspection & interactive column mapping state
  const [inspections, setInspections] = useState<FileInspectionResult[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ proteinNameCol: '' });
  const [conditionOverrides, setConditionOverrides] = useState<string[]>([]);
  const [manualFractionCols, setManualFractionCols] = useState<string[]>([]);
  const [useManualFractions, setUseManualFractions] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const primaryInspection = inspections[0] || null;

  const statsByName = useMemo(() => {
    const map = new Map<string, ColumnStats>();
    if (primaryInspection) {
      primaryInspection.columnStats.forEach(s => map.set(s.name, s));
    }
    return map;
  }, [primaryInspection]);

  // All non-fraction columns first, then remaining columns if user ever wants them
  const selectableMetadataCols = useMemo(() => {
    if (!primaryInspection) return [];
    const meta = primaryInspection.metadataColumns;
    if (useManualFractions && manualFractionCols.length > 0) {
      const fracSet = new Set(manualFractionCols);
      return primaryInspection.columns.filter(c => !fracSet.has(c));
    }
    return meta.length > 0 ? meta : primaryInspection.columns;
  }, [primaryInspection, useManualFractions, manualFractionCols]);

  // Quick-switch pills for the most plausible Protein / Gene Name columns
  const quickNamePills = useMemo(() => {
    if (!primaryInspection) return [];
    return selectableMetadataCols
      .filter(col => {
        const s = statsByName.get(col);
        if (!s || s.fillRate === 0) return false;
        if (s.numericRate > 0.9) return false;
        if (s.isPrecursorCol) return false;
        return true;
      })
      .slice(0, 6);
  }, [primaryInspection, selectableMetadataCols, statsByName]);

  // Active fraction columns (auto-detected or user-selected)
  const activeFractionCols = useMemo(() => {
    if (!primaryInspection) return [];
    if (useManualFractions) {
      return buildManualFractionColumns(manualFractionCols).sort((a, b) => a.fracNum - b.fracNum);
    }
    return [...primaryInspection.fractionColumns].sort((a, b) => a.fracNum - b.fracNum);
  }, [primaryInspection, useManualFractions, manualFractionCols]);

  // Unique fraction numbers (handles wide multi-condition where F1 appears twice)
  const uniqueFractionNums = useMemo(() => {
    const set = new Set<number>();
    activeFractionCols.forEach(f => set.add(f.fracNum));
    return Array.from(set).sort((a, b) => a - b);
  }, [activeFractionCols]);

  // Preview fraction columns (first 3 + last 1)
  const previewFractionCols = useMemo(() => {
    if (activeFractionCols.length === 0) return [];
    // If multi-condition wide, preview first condition's fractions
    const firstCond = activeFractionCols[0]?.condition;
    const singleRunFracs = firstCond
      ? activeFractionCols.filter(f => f.condition === firstCond)
      : activeFractionCols;
    if (singleRunFracs.length <= 4) return singleRunFracs;
    return [
      singleRunFracs[0],
      singleRunFracs[1],
      singleRunFracs[2],
      singleRunFracs[singleRunFracs.length - 1]
    ];
  }, [activeFractionCols]);

  // Estimate resulting protein profile count dynamically as user changes Protein Name or Aggregation
  const estimatedSummary = useMemo(() => {
    if (inspections.length === 0) return { rows: 0, profiles: 0 };
    let totalRows = 0;
    let totalProfiles = 0;
    const aggMode: AggregationMode = mapping.aggregationMode ?? 'none';

    for (const insp of inspections) {
      totalRows += insp.totalRows;
      if (aggMode === 'none') {
        totalProfiles += insp.totalRows;
      } else {
        const seen = new Set<string>();
        const pCol = mapping.proteinNameCol;
        const fbCol = mapping.fallbackNameCol || '';
        const accCol = mapping.accessionCol || '';
        const condCol = mapping.conditionCol || '';
        for (let i = 0; i < insp.rawRows.length; i++) {
          const row = insp.rawRows[i];
          const acc = accCol ? (row[accCol] || '').trim() : '';
          const name =
            (pCol ? (row[pCol] || '').trim() : '') ||
            (fbCol ? (row[fbCol] || '').trim() : '') ||
            acc;
          if (!name) continue;
          const cond = condCol && row[condCol] ? row[condCol].trim() : '';
          const aggKey = insp.isPrecursorMatrix && acc ? acc.toLowerCase() : name.toLowerCase();
          seen.add(`${aggKey}__${cond}`);
        }
        const multiCondFactor =
          !condCol && insp.detectedConditions.length > 1 ? insp.detectedConditions.length : 1;
        totalProfiles += seen.size * multiCondFactor;
      }
    }
    return { rows: totalRows, profiles: totalProfiles };
  }, [inspections, mapping]);

  if (!isOpen) return null;

  const resetStaging = () => {
    setInspections([]);
    setMapping({ proteinNameCol: '' });
    setConditionOverrides([]);
    setManualFractionCols([]);
    setUseManualFractions(false);
    setShowAdvanced(false);
    setErrorMsg(null);
    setSuccessSummary(null);
    setDownloadableKey(null);
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessSummary(null);
    setDownloadableKey(null);

    try {
      const results: FileInspectionResult[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const inspected = await inspectSECDIAFile(file, file.name);
        results.push(inspected);
      }

      const first = results[0];
      if (first.isLongFormatReport) {
        setErrorMsg(
          'Detected a long-format DIA-NN report (Run / File.Name column). Please upload a DIA-NN matrix file (*_pg_matrix.tsv, *_pr_matrix.tsv, or *_gg_matrix.tsv) or a wide SEC CSV.'
        );
        return;
      }

      setInspections(results);
      setMapping(first.suggestedMapping);
      setConditionOverrides(results.map(r => r.inferredCondition));

      if (first.fractionColumns.length === 0 && first.candidateNumericCols.length >= 2) {
        setUseManualFractions(true);
        setManualFractionCols(first.candidateNumericCols);
        setShowAdvanced(true);
      } else {
        setUseManualFractions(false);
        setManualFractionCols(first.fractionColumns.map(f => f.colName));
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to read file(s). Please verify CSV/TSV formatting.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProteinNameCol = (newCol: string) => {
    setMapping(prev => {
      const next: ColumnMapping = { ...prev, proteinNameCol: newCol };
      // If user selects the column currently mapped to Description as the primary Protein Name,
      // swap Description to the previous Protein Name so both stay useful and non-redundant.
      if (prev.descriptionCol === newCol) {
        next.descriptionCol = prev.proteinNameCol && prev.proteinNameCol !== newCol
          ? prev.proteinNameCol
          : undefined;
      }
      // Avoid fallback being identical to primary
      if (prev.fallbackNameCol === newCol) {
        next.fallbackNameCol = prev.proteinNameCol && prev.proteinNameCol !== newCol
          ? prev.proteinNameCol
          : undefined;
      }
      return next;
    });
  };

  const handleToggleManualFractionCol = (colName: string) => {
    setManualFractionCols(prev =>
      prev.includes(colName) ? prev.filter(c => c !== colName) : [...prev, colName]
    );
  };

  const handleConfirmImport = () => {
    if (inspections.length === 0) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessSummary(null);
    setDownloadableKey(null);

    try {
      let allNewProfiles: ProteinProfile[] = [];
      const allNewMeta: DatasetMeta[] = [];

      for (let i = 0; i < inspections.length; i++) {
        const insp = inspections[i];
        const perFileMapping: ColumnMapping = {
          ...mapping,
          conditionOverride: conditionOverrides[i] || insp.inferredCondition,
          manualFractionCols: useManualFractions ? manualFractionCols : undefined
        };
        const res = buildProfilesFromInspection(insp, perFileMapping);
        allNewProfiles.push(...res.profiles);
        allNewMeta.push(...res.metadata);
      }

      const totalPrecursors = allNewMeta.reduce((acc, m) => acc + (m.precursorCount || 0), 0);
      const rollupNote =
        totalPrecursors > 0
          ? ` (rolled up from ${totalPrecursors.toLocaleString()} rows)`
          : '';

      if (autoAnonymize) {
        const anonRes = anonymizeProfiles(allNewProfiles);
        allNewProfiles = anonRes.anonymizedProfiles;
        const keyCsv = exportAnonymizationKeyCSV(anonRes.keyEntries);
        setDownloadableKey(keyCsv);
        setSuccessSummary(
          `Imported ${allNewProfiles.length.toLocaleString()} protein profiles${rollupNote}. GDPR Anonymization applied!`
        );
      } else {
        setSuccessSummary(
          `Successfully imported ${allNewProfiles.length.toLocaleString()} protein profiles${rollupNote} across ${allNewMeta.length} run(s)!`
        );
      }

      onDataLoaded(allNewProfiles, allNewMeta, autoAnonymize);
      if (!autoAnonymize) {
        setTimeout(() => {
          resetStaging();
          onClose();
        }, 700);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to import dataset with the selected column mapping.');
    } finally {
      setLoading(false);
    }
  };

  const hasSingleEditableCondition =
    primaryInspection &&
    !mapping.conditionCol &&
    !(
      !useManualFractions &&
      new Set(primaryInspection.fractionColumns.map(f => f.condition).filter(Boolean)).size > 1
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div
        className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full shadow-2xl relative max-h-[90vh] flex flex-col transition-all ${
          primaryInspection ? 'max-w-3xl' : 'max-w-xl'
        }`}
      >
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-white p-1 rounded-lg transition"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-4 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center">
            {primaryInspection ? (
              <SlidersHorizontal className="w-5 h-5" />
            ) : (
              <UploadCloud className="w-6 h-6" />
            )}
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              {primaryInspection ? 'Configure Columns & Preview Import' : 'Ingest SEC DIA Datasets'}
            </h3>
            <p className="text-xs text-slate-400">
              {primaryInspection
                ? 'Verify or customize which columns represent your protein name, accession, description, and SEC fractions.'
                : 'Supports DIA-NN matrices (pr_matrix, pg_matrix, gg_matrix TSV), CSVs, Spectronaut, FragPipe, and MaxQuant.'}
            </p>
          </div>
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.tsv,.txt"
          className="hidden"
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />

        {/* Scrollable Content Area */}
        <div className="overflow-y-auto flex-1 pr-1 space-y-4">
          {/* STEP 1: DROP / BROWSE ZONE */}
          {!primaryInspection ? (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleFilesSelected(e.dataTransfer.files);
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
                  {loading ? 'Inspecting columns & fractions...' : 'Drop CSV / TSV files here or click to browse'}
                </p>
                <p className="text-xs text-slate-400 mt-1 mb-3">
                  You will be able to preview your data and choose which column is used as the Protein Name before importing.
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-teal-400 hover:text-teal-300 rounded-lg text-xs font-semibold border border-slate-700 shadow-sm transition"
                >
                  <span>Browse CSV / TSV Files</span>
                </button>
              </div>

              {/* Instructions */}
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 text-xs text-slate-400 space-y-1.5">
                <div className="font-semibold text-slate-300 flex items-center space-x-1">
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  <span>Flexible Auto-Detection + Interactive Column Mapper:</span>
                </div>
                <ul className="list-disc list-inside space-y-1 pl-1 text-[11px]">
                  <li>
                    <b>Choose Your Protein Label:</b> Switch between <code className="text-slate-300">Genes</code>,{' '}
                    <code className="text-slate-300">Protein.Names</code>,{' '}
                    <code className="text-slate-300">Protein.Group</code>,{' '}
                    <code className="text-slate-300">First.Protein.Description</code>, or any custom column with live preview.
                  </li>
                  <li>
                    <b>DIA-NN & Raw MS Matrices:</b> Natively parses <code className="text-slate-300">pg_matrix.tsv</code>,{' '}
                    <code className="text-slate-300">pr_matrix.tsv</code> (auto-aggregated to protein level),{' '}
                    <code className="text-slate-300">gg_matrix.tsv</code>, and raw run paths (e.g.{' '}
                    <code className="text-slate-300">G:\...\Sample_F01_Slot2-01.d</code>).
                  </li>
                  <li>
                    <b>Any Fraction Count or Custom Headers:</b> Automatically detects and sorts fractions—or lets you pick numeric columns manually.
                  </li>
                </ul>
              </div>
            </>
          ) : (
            /* STEP 2: INTERACTIVE COLUMN MAPPER & LIVE PREVIEW */
            <>
              {/* File Summary Bar */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center space-x-1.5 font-semibold text-white">
                    <FileText className="w-4 h-4 text-teal-400 shrink-0" />
                    <span className="truncate max-w-xs" title={inspections.map(i => i.fileName).join(', ')}>
                      {inspections.length === 1
                        ? primaryInspection.fileName
                        : `${inspections.length} files (${primaryInspection.fileName} + ${inspections.length - 1} more)`}
                    </span>
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300 text-[11px] font-mono">
                    {uniqueFractionNums.length} Fractions
                    {uniqueFractionNums.length > 0
                      ? ` (F${uniqueFractionNums[0]}–F${uniqueFractionNums[uniqueFractionNums.length - 1]})`
                      : ''}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[11px] font-mono">
                    {primaryInspection.isPrecursorMatrix
                      ? `Precursor Matrix (${estimatedSummary.rows.toLocaleString()} rows)`
                      : `${estimatedSummary.rows.toLocaleString()} rows`}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={resetStaging}
                  className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-medium border border-slate-700 transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Change File</span>
                </button>
              </div>

              {/* Manual fraction warning when standard headers were not detected */}
              {primaryInspection.fractionColumns.length === 0 && (
                <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200 flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Non-standard fraction column names detected</div>
                    <p className="text-[11px] text-amber-300/90 mt-0.5">
                      {manualFractionCols.length >= 2
                        ? `Selected ${manualFractionCols.length} numeric columns as Fractions 1–${manualFractionCols.length}. Expand "More Options" below if you want to adjust which columns are fractions.`
                        : 'Select at least 2 numeric intensity columns under "More Options → Fraction Columns" below.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Primary Column Mapping Controls */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3.5">
                {/* 1. Primary Protein / Gene Name */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <label className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <span>Protein / Gene Name Column</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-300 font-semibold">
                        Primary Label
                      </span>
                    </label>
                    <span className="text-[11px] text-slate-400">
                      Used for search, chart title &amp; tables
                    </span>
                  </div>

                  <select
                    value={mapping.proteinNameCol}
                    onChange={(e) => handleSelectProteinNameCol(e.target.value)}
                    className="w-full bg-slate-900 border border-teal-500/40 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20"
                  >
                    {selectableMetadataCols.map(col => (
                      <option key={col} value={col}>
                        {formatColOptionLabel(col, statsByName.get(col))}
                      </option>
                    ))}
                  </select>

                  {/* 1-Click Quick-Pick Pills */}
                  {quickNamePills.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-[10px] text-slate-500 font-medium mr-0.5">Quick switch:</span>
                      {quickNamePills.map(col => {
                        const isSelected = mapping.proteinNameCol === col;
                        return (
                          <button
                            key={col}
                            type="button"
                            onClick={() => handleSelectProteinNameCol(col)}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition ${
                              isSelected
                                ? 'bg-teal-500/20 text-teal-300 border-teal-500/50 font-semibold'
                                : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-600 hover:text-slate-200'
                            }`}
                            title={statsByName.get(col)?.sampleValues.join(' | ')}
                          >
                            {col}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2. Description & Accession side-by-side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Description / Annotation Column
                    </label>
                    <select
                      value={mapping.descriptionCol || ''}
                      onChange={(e) =>
                        setMapping(prev => ({
                          ...prev,
                          descriptionCol: e.target.value || undefined
                        }))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-teal-400"
                    >
                      <option value="">(None)</option>
                      {selectableMetadataCols.map(col => (
                        <option key={col} value={col}>
                          {formatColOptionLabel(col, statsByName.get(col))}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Accession / UniProt ID Column
                    </label>
                    <select
                      value={mapping.accessionCol || ''}
                      onChange={(e) =>
                        setMapping(prev => ({
                          ...prev,
                          accessionCol: e.target.value || undefined
                        }))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-teal-400"
                    >
                      <option value="">(None)</option>
                      {selectableMetadataCols.map(col => (
                        <option key={col} value={col}>
                          {formatColOptionLabel(col, statsByName.get(col))}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Expandable Advanced Options */}
                <div className="pt-1 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center space-x-1.5 text-[11px] font-semibold text-slate-400 hover:text-teal-400 transition"
                  >
                    {showAdvanced ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                    <span>
                      More Options (Fallback ID, Duplicate/Precursor Rollup, Condition Label, Fractions)
                    </span>
                  </button>

                  {showAdvanced && (
                    <div className="mt-3 space-y-3 pt-2 border-t border-slate-800/60">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Fallback Name Column */}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                            Fallback Name (when primary is blank)
                          </label>
                          <select
                            value={mapping.fallbackNameCol || ''}
                            onChange={(e) =>
                              setMapping(prev => ({
                                ...prev,
                                fallbackNameCol: e.target.value || undefined
                              }))
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-teal-400"
                          >
                            <option value="">(None — skip blank rows)</option>
                            {selectableMetadataCols
                              .filter(c => c !== mapping.proteinNameCol)
                              .map(col => (
                                <option key={col} value={col}>
                                  {formatColOptionLabel(col, statsByName.get(col))}
                                </option>
                              ))}
                          </select>
                        </div>

                        {/* Duplicate / Precursor Aggregation Mode */}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                            Duplicate / Precursor Rollup
                          </label>
                          <select
                            value={mapping.aggregationMode || 'none'}
                            onChange={(e) =>
                              setMapping(prev => ({
                                ...prev,
                                aggregationMode: e.target.value as AggregationMode
                              }))
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-teal-400"
                          >
                            <option value="sum">Sum intensities by Protein Name (recommended for pr_matrix)</option>
                            <option value="mean">Average detected intensities by Protein Name</option>
                            <option value="none">Keep each row separate (recommended for pg_matrix)</option>
                          </select>
                        </div>

                        {/* Condition Column (Stacked) or Editable Run Name */}
                        {hasSingleEditableCondition ? (
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                              Condition / Run Label
                            </label>
                            <div className="space-y-1.5">
                              {inspections.map((insp, idx) => (
                                <input
                                  key={insp.fileName + idx}
                                  type="text"
                                  value={conditionOverrides[idx] ?? insp.inferredCondition}
                                  onChange={(e) => {
                                    const next = [...conditionOverrides];
                                    next[idx] = e.target.value;
                                    setConditionOverrides(next);
                                  }}
                                  placeholder="e.g. 8h, Ctrl, 60min"
                                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-teal-400"
                                />
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                              Condition Column (Stacked CSV)
                            </label>
                            <select
                              value={mapping.conditionCol || ''}
                              onChange={(e) =>
                                setMapping(prev => ({
                                  ...prev,
                                  conditionCol: e.target.value || undefined
                                }))
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-teal-400"
                            >
                              <option value="">(Infer from headers / filename)</option>
                              {selectableMetadataCols.map(col => (
                                <option key={col} value={col}>
                                  {formatColOptionLabel(col, statsByName.get(col))}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* MW Column */}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                            Molecular Weight Column (optional)
                          </label>
                          <select
                            value={mapping.mwCol || ''}
                            onChange={(e) =>
                              setMapping(prev => ({
                                ...prev,
                                mwCol: e.target.value || undefined
                              }))
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-teal-400"
                          >
                            <option value="">(None)</option>
                            {selectableMetadataCols.map(col => (
                              <option key={col} value={col}>
                                {formatColOptionLabel(col, statsByName.get(col))}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Manual Fraction Column Picker (always accessible when toggled or needed) */}
                      <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-300">
                            Detected SEC Fractions ({activeFractionCols.length} columns)
                          </span>
                          <label className="inline-flex items-center space-x-1.5 text-[11px] text-slate-400 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={useManualFractions}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setUseManualFractions(checked);
                                if (checked && manualFractionCols.length === 0) {
                                  setManualFractionCols(
                                    primaryInspection.fractionColumns.length > 0
                                      ? primaryInspection.fractionColumns.map(f => f.colName)
                                      : primaryInspection.candidateNumericCols
                                  );
                                }
                              }}
                              className="accent-teal-500 rounded"
                            />
                            <span>Customize fraction columns manually</span>
                          </label>
                        </div>

                        {useManualFractions ? (
                          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-1">
                            {primaryInspection.columns.map(col => {
                              const checked = manualFractionCols.includes(col);
                              const shortLabel = col.split(/[\\/]/).pop() || col;
                              return (
                                <button
                                  key={col}
                                  type="button"
                                  onClick={() => handleToggleManualFractionCol(col)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
                                    checked
                                      ? 'bg-teal-500/20 border-teal-500/40 text-teal-300'
                                      : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
                                  }`}
                                  title={col}
                                >
                                  {truncateText(shortLabel, 24)}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          activeFractionCols.length > 0 && (
                            <div className="text-[10px] font-mono text-slate-400 truncate">
                              First: <span className="text-teal-300">F{activeFractionCols[0].fracNum}</span>{' '}
                              ({activeFractionCols[0].colName.split(/[\\/]/).pop()}) → Last:{' '}
                              <span className="text-teal-300">
                                F{activeFractionCols[activeFractionCols.length - 1].fracNum}
                              </span>{' '}
                              ({activeFractionCols[activeFractionCols.length - 1].colName.split(/[\\/]/).pop()})
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* LIVE DATA PREVIEW TABLE */}
              <div className="rounded-2xl bg-slate-950/80 border border-slate-800 overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-300 flex items-center space-x-1.5">
                    <Table className="w-3.5 h-3.5 text-teal-400" />
                    <span>Live Preview (first 5 rows as mapped)</span>
                  </span>
                  <span className="text-slate-400 font-mono">
                    {mapping.aggregationMode && mapping.aggregationMode !== 'none'
                      ? `Will import ~${estimatedSummary.profiles.toLocaleString()} proteins (from ${estimatedSummary.rows.toLocaleString()} rows)`
                      : `Will import ${estimatedSummary.profiles.toLocaleString()} rows`}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3 font-semibold text-teal-300">Protein Name</th>
                        <th className="py-2 px-3 font-semibold">Accession / ID</th>
                        <th className="py-2 px-3 font-semibold">Description</th>
                        {previewFractionCols.map((f, idx) => (
                          <th key={`${f.colName}_${idx}`} className="py-2 px-2 font-mono text-right">
                            {idx === 3 && activeFractionCols.length > 4 ? `… F${f.fracNum}` : `F${f.fracNum}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {primaryInspection.sampleRows.slice(0, 5).map((row, rIdx) => {
                        const primaryVal = mapping.proteinNameCol
                          ? (row[mapping.proteinNameCol] || '').trim()
                          : '';
                        const fallbackVal = mapping.fallbackNameCol
                          ? (row[mapping.fallbackNameCol] || '').trim()
                          : '';
                        const accVal = mapping.accessionCol
                          ? (row[mapping.accessionCol] || '').trim()
                          : '';
                        const descVal = mapping.descriptionCol
                          ? (row[mapping.descriptionCol] || '').trim()
                          : '';
                        const resolvedName = primaryVal || fallbackVal || accVal;
                        const usedFallback = !primaryVal && Boolean(resolvedName);

                        return (
                          <tr key={rIdx} className="hover:bg-slate-900/40">
                            <td className="py-1.5 px-3 font-bold text-white max-w-[180px] truncate" title={resolvedName}>
                              {resolvedName || <span className="text-rose-400 italic">(blank — skipped)</span>}
                              {usedFallback && (
                                <span className="ml-1 text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-normal">
                                  fallback
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 px-3 font-mono text-slate-300 max-w-[130px] truncate" title={accVal}>
                              {accVal || '—'}
                            </td>
                            <td className="py-1.5 px-3 text-slate-400 max-w-[200px] truncate" title={descVal}>
                              {descVal || '—'}
                            </td>
                            {previewFractionCols.map((f, fIdx) => (
                              <td key={`${f.colName}_${fIdx}`} className="py-1.5 px-2 font-mono text-slate-400 text-right">
                                {formatCompactNumber(row[f.colName])}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Optional GDPR Auto-Anonymization Toggle */}
              <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3">
                <div className="flex items-center space-x-2.5">
                  <ShieldCheck
                    className={`w-5 h-5 shrink-0 ${autoAnonymize ? 'text-emerald-400' : 'text-slate-500'}`}
                  />
                  <div>
                    <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <span>GDPR Anonymization Shield</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-medium">
                        Optional (for sharing)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {autoAnonymize
                        ? 'ON: Protein names above will be replaced with PRT_0001… on import and a private key CSV will be generated.'
                        : 'OFF: Keep your original protein names & descriptions locally in your browser (data never leaves your device).'}
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={autoAnonymize}
                    onChange={(e) => setAutoAnonymize(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
            </>
          )}

          {/* Feedback messages */}
          {errorMsg && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successSummary && (
            <div className="p-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 space-y-2">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                <span className="font-semibold">{successSummary}</span>
              </div>
              {downloadableKey && (
                <div className="pt-2 border-t border-emerald-500/20 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-emerald-400">
                    Save your private de-anonymization mapping key locally:
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadFile(downloadableKey, 'private_deanonymization_key.csv');
                      }}
                      className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold shadow transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Key (.csv)</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        resetStaging();
                        onClose();
                      }}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold border border-slate-700 transition"
                    >
                      Explore Data
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Footer CTA when file(s) are staged */}
        {primaryInspection && !downloadableKey && (
          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={resetStaging}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
            >
              Back
            </button>

            <button
              type="button"
              disabled={loading || !mapping.proteinNameCol || activeFractionCols.length === 0}
              onClick={handleConfirmImport}
              className="inline-flex items-center space-x-2 px-5 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold shadow-lg shadow-teal-500/20 transition"
            >
              <span>
                {loading
                  ? 'Importing...'
                  : `Import ${estimatedSummary.profiles.toLocaleString()} Proteins`}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
