import Papa from 'papaparse';
import { ProteinProfile, DatasetMeta } from '../types/sec';
import { findApex } from './statistics';

export interface ParsedFractionCol {
  colName: string;
  fracNum: number;
  prefix?: string;
  condition?: string;
  replicate?: string;
  plate?: string;
}

interface RawParsedFractionCol {
  colName: string;
  fracNum: number;
  rawPrefix: string;
  rawSuffix: string;
  metricType?: string;
  isMsRunCol: boolean;
}

const MS_EXTENSION_REGEX = /\.(?:d|raw|mzml|mzxml|wiff2?|dia|htrms|tdf|baf|yep|lcd)(?:\.gz)?$/i;

function stripBomAndTrim(value: string): string {
  return value.replace(/^\uFEFF/, '').trim();
}

function isKnownMetadataColumn(cleanHeader: string): boolean {
  return /^(?:gene|genes|gene_name|gene[._\s]names?|pg\.genes|protein\.group|protein\.ids?|protein\.names?|pg\.protein\w*|protein|protein_id|protein\s+id|majority\s+protein\s+ids|entry\s+name|fasta\s+headers|first\.protein\.description|protein\.description|protein\s+description|description|complex|name|organism|uniprot|uniprot_id|accession|proteotypic|stripped\.sequence|modified\.sequence|precursor\.charge|precursor\.id|eg\.\w+|peptide|peptides|unique\s+peptides|razor.*|sequence|sequence\s+coverage.*|charge|n\.sequences|n\.proteotypic\.sequences|protein\s+length|length|monomermw_kda|mw|mw_kda|molecular_weight|mol\.\s*weight.*|fdr|q\.value|global\.q\.value|lib\.q\.value|pg\.q\.value|pep|score|f1[_\s-]?score|rt|im|ccs|mz|condition|timepoint|treatment|sample_id|sample|replicate|rep|biorep|techrep|plate|plate_id|batch|group|reverse|potential\s+contaminant|only\s+identified\s+by\s+site|indistinguishable\s+proteins|ms\/ms\s+count|id)$/i.test(
    cleanHeader
  );
}

function normalizeRunHeader(rawHeader: string): {
  stem: string;
  metricType?: string;
  isMsRunCol: boolean;
} {
  const clean = stripBomAndTrim(rawHeader);
  const hasPath = /[\\/]/.test(clean);
  let stem = clean.split(/[\\/]/).pop() || clean;
  let metricType: string | undefined;

  // Spectronaut leading run index: "[1] Sample_F01.raw.PG.Quantity"
  stem = stem.replace(/^\[\d+\]\s*/, '');

  // Spectronaut trailing quantity suffix
  const spectroMatch = stem.match(/\.(PG\.(?:MaxLFQ|MS2Quantity|MS1Quantity|Quantity|IBAQ))$/i);
  if (spectroMatch) {
    metricType = spectroMatch[1].toLowerCase();
    stem = stem.slice(0, -spectroMatch[0].length);
  }

  // MaxQuant leading quantity prefix
  const mqMatch = stem.match(/^(LFQ\s+intensity|iBAQ|Intensity|MS\/MS\s+count)\s+(.+)$/i);
  if (mqMatch) {
    metricType = mqMatch[1].toLowerCase().replace(/\s+/g, ' ');
    stem = mqMatch[2];
  }

  // FragPipe trailing quantity suffix
  const fpMatch = stem.match(
    /^(.+?)\s+(MaxLFQ\s+Intensity|Unique\s+Intensity|Total\s+Intensity|Intensity|Unique\s+Spectral\s+Count|Total\s+Spectral\s+Count|Spectral\s+Count)$/i
  );
  if (fpMatch) {
    metricType = fpMatch[2].toLowerCase().replace(/\s+/g, ' ');
    stem = fpMatch[1];
  }

  // Strip raw mass-spec extensions (.d, .raw, .mzML, .wiff, .dia, .htrms, etc.)
  const hasMsExt = MS_EXTENSION_REGEX.test(stem);
  stem = stem.replace(MS_EXTENSION_REGEX, '');

  return {
    stem: stem.trim(),
    metricType,
    isMsRunCol: hasPath || hasMsExt || Boolean(metricType)
  };
}

function findLastRegexMatch(input: string, regex: RegExp): RegExpExecArray | null {
  regex.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(input)) !== null) {
    last = m;
    if (m.index === regex.lastIndex) {
      regex.lastIndex++;
    }
  }
  return last;
}

function extractFractionFromStem(
  stem: string,
  isMsRunCol: boolean
): { fracNum: number; rawPrefix: string; rawSuffix: string } | null {
  if (!stem) return null;

  // Pure numeric column header: e.g. "1", "2", ..., "70" (only for plain headers)
  if (!isMsRunCol && /^\d+$/.test(stem)) {
    return { fracNum: parseInt(stem, 10), rawPrefix: '', rawSuffix: '' };
  }

  // Try fraction tokens in priority order so explicit "Fraction"/"Frac" wins over "F", and "F" wins over "SEC"
  const tokenPatterns = [
    /(?:^|[_\-\s.])(?:Fraction|Frac)[_\-\s]?0*(\d+)(?=$|[_\-\s.])/gi,
    /(?:^|[_\-\s.])(?:Fr|F)[_\-\s]?0*(\d+)(?=$|[_\-\s.])/gi,
    /(?:^|[_\-\s.])SEC[_\-\s]?0*(\d+)(?=$|[_\-\s.])/gi
  ];

  for (const pattern of tokenPatterns) {
    const match = findLastRegexMatch(stem, pattern);
    if (match) {
      const fracNum = parseInt(match[1], 10);
      const rawPrefix = stem.slice(0, match.index).replace(/[_\-\s.]+$/, '');
      const rawSuffix = stem.slice(match.index + match[0].length).replace(/^[_\-\s.]+/, '');
      return { fracNum, rawPrefix, rawSuffix };
    }
  }

  return null;
}

function cleanAcquisitionSuffix(suffix: string): string {
  if (!suffix) return '';
  let s = suffix;
  // Remove Bruker timsTOF slot tokens (e.g. Slot2-28, Slot1_A1)
  s = s.replace(/(?:^|[_\-\s.])Slot\d+[_\-][A-Za-z0-9]+(?=$|[_\-\s.])/gi, '');
  // Remove standalone numeric acquisition/run ID tokens (e.g. _1_4832, _001)
  s = s.replace(/(?:^|[_\-\s.])\d+(?=$|[_\-\s.])/g, '');
  s = s.replace(/^[_\-\s.]+|[_\-\s.]+$/g, '').replace(/[_\-\s.]{2,}/g, '_');
  return s;
}

function getMetricPriority(metricType: string): number {
  const m = metricType.toLowerCase();
  if (m === 'maxlfq intensity' || m === 'pg.maxlfq') return 1;
  if (m === 'lfq intensity') return 2;
  if (m === 'pg.quantity' || m === 'pg.ms2quantity') return 3;
  if (m === 'intensity' || m === 'pg.ms1quantity') return 4;
  if (m === 'ibaq' || m === 'pg.ibaq') return 5;
  if (m === 'total intensity' || m === 'unique intensity') return 6;
  return 10;
}

function extractReplicateAndPlate(text?: string): { replicate?: string; plate?: string } {
  if (!text) return {};
  const repM = text.match(/(?:^|[_\-\s.])(?:rep|replicate)[_\-\s]?(\d+)(?=$|[_\-\s.])/i);
  const plateM = text.match(/(?:^|[_\-\s.])(?:plate)[_\-\s]?([a-zA-Z0-9]+)(?=$|[_\-\s.])/i);
  return {
    replicate: repM ? `Rep${repM[1]}` : undefined,
    plate: plateM ? `Plate${plateM[1]}` : undefined
  };
}

/**
 * Extracts fraction columns and resolves embedded condition/replicate/plate metadata
 * across all column headers. Supports:
 * - Standard CSV headers: Fraction_1, Frac_01, Fr1, F1, SEC_1, 1..70
 * - Wide prefixed/suffixed headers: 60min_Fraction_1, Rep1_Frac_05, Fraction_1_60min, F01_Rep2
 * - DIA-NN / Bruker / Thermo / Spectronaut / FragPipe / MaxQuant raw file path headers:
 *   e.g. G:\2026\Freja_AF94_8h_F28_Slot2-28_1_4832.d, /data/Sample_Frac01.mzML
 */
export function detectFractionColumns(columns: string[]): ParsedFractionCol[] {
  const candidates: RawParsedFractionCol[] = [];
  const msRunCandidates: { colName: string; stem: string; metricType?: string }[] = [];

  for (const colName of columns) {
    const clean = stripBomAndTrim(colName);
    if (!clean || isKnownMetadataColumn(clean)) continue;

    const { stem, metricType, isMsRunCol } = normalizeRunHeader(colName);
    if (isMsRunCol) {
      msRunCandidates.push({ colName, stem, metricType });
    }

    const extracted = extractFractionFromStem(stem, isMsRunCol);
    if (extracted) {
      candidates.push({
        colName,
        fracNum: extracted.fracNum,
        rawPrefix: extracted.rawPrefix,
        rawSuffix: extracted.rawSuffix,
        metricType,
        isMsRunCol
      });
    }
  }

  // Fallback for MS run columns lacking explicit F/Frac/Fraction/SEC tokens
  if (candidates.length === 0 && msRunCandidates.length >= 2) {
    // Fallback 1: Bruker Slot positions (e.g. Sample_Slot2-01_1_4794.d)
    const slotPattern = /(?:^|[_\-\s.])Slot\d+[_\-]0*(\d+)(?=$|[_\-\s.])/gi;
    for (const item of msRunCandidates) {
      const m = findLastRegexMatch(item.stem, slotPattern);
      if (m) {
        candidates.push({
          colName: item.colName,
          fracNum: parseInt(m[1], 10),
          rawPrefix: item.stem.slice(0, m.index).replace(/[_\-\s.]+$/, ''),
          rawSuffix: item.stem.slice(m.index + m[0].length).replace(/^[_\-\s.]+/, ''),
          metricType: item.metricType,
          isMsRunCol: true
        });
      }
    }

    // Fallback 2: Trailing numeric index on MS raw files (e.g. Sample_01.raw .. Sample_36.raw)
    if (candidates.length === 0) {
      const trailing: RawParsedFractionCol[] = [];
      for (const item of msRunCandidates) {
        const m = item.stem.match(/^(.+?)[_\-\s.]0*(\d+)$/);
        if (m) {
          trailing.push({
            colName: item.colName,
            fracNum: parseInt(m[2], 10),
            rawPrefix: m[1].replace(/[_\-\s.]+$/, ''),
            rawSuffix: '',
            metricType: item.metricType,
            isMsRunCol: true
          });
        }
      }
      const uniqueNums = new Set(trailing.map(t => t.fracNum));
      if (trailing.length >= 2 && uniqueNums.size >= 2) {
        candidates.push(...trailing);
      }
    }
  }

  if (candidates.length === 0) return [];

  // If multiple quantitative metric columns exist (FragPipe / MaxQuant / Spectronaut),
  // keep only the highest-priority metric (e.g. MaxLFQ Intensity over Spectral Count).
  const metricTypes = new Set(candidates.map(c => c.metricType).filter((m): m is string => Boolean(m)));
  let activeCandidates = candidates;
  if (metricTypes.size > 1) {
    const bestMetric = Array.from(metricTypes).sort(
      (a, b) => getMetricPriority(a) - getMetricPriority(b)
    )[0];
    activeCandidates = candidates.filter(c => c.metricType === bestMetric);
  }

  // Frequency analysis of prefixes and suffixes to distinguish true conditions from per-fraction run IDs
  const rawSuffixCounts = new Map<string, number>();
  for (const c of activeCandidates) {
    if (c.rawSuffix) {
      rawSuffixCounts.set(c.rawSuffix, (rawSuffixCounts.get(c.rawSuffix) || 0) + 1);
    }
  }

  const withCleanSuffix = activeCandidates.map(c => {
    const keepRawSuffix = !c.rawPrefix && c.rawSuffix && (rawSuffixCounts.get(c.rawSuffix) || 0) >= 2;
    const cleanSuffix = keepRawSuffix ? c.rawSuffix : cleanAcquisitionSuffix(c.rawSuffix);
    return { ...c, cleanSuffix };
  });

  const cleanSuffixCounts = new Map<string, number>();
  for (const c of withCleanSuffix) {
    if (c.cleanSuffix) {
      cleanSuffixCounts.set(c.cleanSuffix, (cleanSuffixCounts.get(c.cleanSuffix) || 0) + 1);
    }
  }

  const resolved: ParsedFractionCol[] = withCleanSuffix.map(c => {
    const hasPrefix = Boolean(c.rawPrefix);
    const hasCleanSuffix = Boolean(c.cleanSuffix);
    const suffixRepeats = hasCleanSuffix && (cleanSuffixCounts.get(c.cleanSuffix) || 0) >= 2;

    let condition: string | undefined;
    if (hasPrefix && suffixRepeats) {
      condition = `${c.rawPrefix}_${c.cleanSuffix}`;
    } else if (hasPrefix) {
      condition = c.rawPrefix;
    } else if (hasCleanSuffix) {
      condition = c.cleanSuffix;
    }

    const { replicate, plate } = extractReplicateAndPlate(condition);
    return {
      colName: c.colName,
      fracNum: c.fracNum,
      prefix: c.rawPrefix || undefined,
      condition,
      replicate,
      plate
    };
  });

  // Guard against per-fraction unique prefixes (e.g. "4794_Sample_F01", "4795_Sample_F02")
  // being falsely treated as N separate 1-fraction conditions.
  const condCounts = new Map<string, number>();
  const fracNumCounts = new Map<number, number>();
  for (const r of resolved) {
    if (r.condition) condCounts.set(r.condition, (condCounts.get(r.condition) || 0) + 1);
    fracNumCounts.set(r.fracNum, (fracNumCounts.get(r.fracNum) || 0) + 1);
  }

  const hasDuplicateFracNums = Array.from(fracNumCounts.values()).some(cnt => cnt > 1);
  const multiFractionConds = Array.from(condCounts.values()).filter(cnt => cnt >= 2).length;
  if (condCounts.size > 1 && multiFractionConds < 2 && !hasDuplicateFracNums) {
    for (const r of resolved) {
      r.condition = undefined;
      r.replicate = undefined;
      r.plate = undefined;
    }
  }

  return resolved;
}

function inferConditionFromFileName(fileName: string): string {
  const condMatch = fileName.match(
    /(?:^|[_\-\s.])(\d+\s*(?:min|hr|hrs|h)|ctrl|control|mock|wt|treat\d*|plate\d*|rep\d*)(?=$|[_\-\s.])/i
  );
  if (condMatch) return condMatch[1];

  return (
    fileName
      .replace(/\.(?:csv|tsv|txt)$/i, '')
      .replace(/[._-](?:report[._-])?(?:pg|pr|gg|unique_genes)[._-]matrix$/i, '')
      .replace(/[._-]report$/i, '')
      .trim() || fileName.replace(/\.[^/.]+$/, '')
  );
}

function parseNumericIntensity(rawValue: string | undefined): number {
  if (!rawValue) return 0;
  const val = parseFloat(rawValue);
  return isNaN(val) || !isFinite(val) ? 0 : val;
}

function csvEscape(value: string): string {
  if (!value) return '';
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Intelligent parser for single or multi-condition SEC DIA CSV/TSV files,
 * including raw DIA-NN matrices (pg_matrix.tsv, pr_matrix.tsv, gg_matrix.tsv).
 */
export async function parseSECDIAData(
  fileOrText: File | string,
  fileName: string = 'SEC_Data.csv',
  fallbackCondition?: string
): Promise<{ profiles: ProteinProfile[]; metadata: DatasetMeta[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(fileOrText as any, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      complete: (results) => {
        try {
          const rawRows = results.data;
          if (!rawRows || rawRows.length === 0) {
            return reject(new Error('File appears to be empty or invalid.'));
          }

          const columns = Object.keys(rawRows[0] || {});
          const norm = (c: string) => stripBomAndTrim(c);

          // 1. Detect ID & annotation columns (supports app CSV, DIA-NN, Spectronaut, FragPipe, MaxQuant)
          const geneCol =
            columns.find(c => /^(gene|genes|gene_name|gene[._\s]names?|pg\.genes|protein_id)$/i.test(norm(c))) ||
            columns.find(c => /gene/i.test(norm(c))) ||
            columns.find(c => /^(protein\.group|pg\.proteingroups|protein\.ids?|majority\s+protein\s+ids|protein)$/i.test(norm(c))) ||
            columns[0];

          const proteinGroupCol =
            columns.find(c => /^(protein\.group|pg\.proteingroups|majority\s+protein\s+ids|protein\s+id)$/i.test(norm(c))) || '';

          const uniprotCol =
            columns.find(c => /^(uniprot|uniprot_id|accession)$/i.test(norm(c))) ||
            columns.find(c => /^(protein\.group|pg\.proteingroups|protein\.ids?|majority\s+protein\s+ids)$/i.test(norm(c))) || '';

          const descCol =
            columns.find(c =>
              /^(first\.protein\.description|protein\.description|protein\s+description|pg\.proteindescriptions?|description|complex)$/i.test(
                norm(c)
              )
            ) ||
            columns.find(c => /^(protein\.names?|pg\.proteinnames?|entry\s+name|name)$/i.test(norm(c))) || '';

          const mwCol =
            columns.find(c => /^(monomermw_kda|mw|mw_kda|molecular_weight|mol\.\s*weight\s*\[kda\])$/i.test(norm(c))) || '';

          // Detect precursor-level matrices (e.g. DIA-NN report.pr_matrix.tsv) so precursors roll up cleanly to proteins
          const isPrecursorMatrix = columns.some(c =>
            /^(precursor\.id|precursor\.charge|stripped\.sequence|modified\.sequence|eg\.precursorid|eg\.modifiedsequence)$/i.test(
              norm(c)
            )
          );

          // 2. Detect metadata columns in stacked format
          const conditionCol = columns.find(c => /^(condition|timepoint|treatment|sample_id|sample)$/i.test(norm(c))) || '';
          const replicateCol = columns.find(c => /^(replicate|rep|biorep|techrep)$/i.test(norm(c))) || '';
          const plateCol = columns.find(c => /^(plate|plate_id)$/i.test(norm(c))) || '';

          // 3. Detect fraction columns
          const fractionHeaders = detectFractionColumns(columns);

          if (fractionHeaders.length === 0) {
            const hasLongFormatRunCol = columns.some(c => /^(run|file\.name|r\.filename)$/i.test(norm(c)));
            if (hasLongFormatRunCol) {
              return reject(
                new Error(
                  'Detected a long-format DIA-NN report (Run / File.Name column). Please upload a DIA-NN matrix file (*_pg_matrix.tsv, *_pr_matrix.tsv, or *_gg_matrix.tsv) or wide SEC CSV.'
                )
              );
            }
            return reject(
              new Error(
                'No fraction columns detected. Expecting headers like Fraction_1, Frac_1, F1, or DIA-NN raw run paths containing _F01_ / _Frac1_.'
              )
            );
          }

          const resolveRowIdentity = (row: Record<string, string>) => {
            const gene =
              (row[geneCol] || '').trim() ||
              (proteinGroupCol ? (row[proteinGroupCol] || '').trim() : '') ||
              (uniprotCol ? (row[uniprotCol] || '').trim() : '');
            const uniprot = uniprotCol ? (row[uniprotCol] || '').trim() : '';
            const description = descCol ? (row[descCol] || '').trim() : '';
            const parsedMw = mwCol && row[mwCol] ? parseFloat(row[mwCol]) : NaN;
            const mw = !isNaN(parsedMw) && isFinite(parsedMw) ? parsedMw : undefined;
            return { gene, uniprot, description, mw };
          };

          // Collect distinct embedded conditions from fraction headers
          const conditionPrefixes = new Set<string>();
          for (const f of fractionHeaders) {
            if (f.condition) conditionPrefixes.add(f.condition);
          }

          const profiles: ProteinProfile[] = [];
          const metaMap = new Map<string, DatasetMeta>();

          const singleHeaderCondition =
            conditionPrefixes.size === 1 ? Array.from(conditionPrefixes)[0] : undefined;
          const inferredFileCondition =
            fallbackCondition || singleHeaderCondition || inferConditionFromFileName(fileName);

          if (conditionPrefixes.size > 1 && !conditionCol) {
            // CASE A: Wide format with multiple conditions embedded in column headers
            for (const cond of conditionPrefixes) {
              const condFracs = fractionHeaders
                .filter(f => f.condition === cond)
                .sort((a, b) => a.fracNum - b.fracNum);

              const fracNumbers = condFracs.map(f => f.fracNum);
              const fracNames = condFracs.map(f => f.colName);
              const firstFrac = condFracs[0];
              const replicate = firstFrac?.replicate;
              const plate = firstFrac?.plate;

              const dsId = `${fileName}_${cond}`;

              if (isPrecursorMatrix) {
                const aggMap = new Map<
                  string,
                  { gene: string; uniprot: string; description: string; mw?: number; values: number[]; precursors: number }
                >();
                let totalPrecursors = 0;

                for (const row of rawRows) {
                  const { gene, uniprot, description, mw } = resolveRowIdentity(row);
                  if (!gene) continue;

                  const key = gene.toLowerCase();
                  let entry = aggMap.get(key);
                  if (!entry) {
                    entry = {
                      gene,
                      uniprot,
                      description,
                      mw,
                      values: new Array(condFracs.length).fill(0),
                      precursors: 0
                    };
                    aggMap.set(key, entry);
                  } else {
                    if (!entry.uniprot && uniprot) entry.uniprot = uniprot;
                    if (!entry.description && description) entry.description = description;
                    if (entry.mw === undefined && mw !== undefined) entry.mw = mw;
                  }

                  entry.precursors += 1;
                  totalPrecursors += 1;

                  for (let i = 0; i < condFracs.length; i++) {
                    const val = parseNumericIntensity(row[condFracs[i].colName]);
                    if (val > 0) entry.values[i] += val;
                  }
                }

                metaMap.set(dsId, {
                  id: dsId,
                  name: `${fileName} (${cond})`,
                  condition: cond,
                  replicate,
                  plate,
                  fractionCount: condFracs.length,
                  fractionNames: fracNames,
                  proteinCount: aggMap.size,
                  precursorCount: totalPrecursors,
                  source: 'upload'
                });

                let idx = 0;
                aggMap.forEach(entry => {
                  const apex = findApex(entry.values, fracNumbers);
                  profiles.push({
                    id: `${entry.gene}__${cond}__${idx++}`,
                    gene: entry.gene,
                    uniprot: entry.uniprot,
                    description: entry.description,
                    mw: entry.mw,
                    condition: cond,
                    replicate,
                    plate,
                    fractions: fracNumbers,
                    values: entry.values,
                    apexFraction: apex.apexFraction,
                    apexIntensity: apex.apexIntensity,
                    totalArea: apex.totalArea
                  });
                });
              } else {
                let proteinCount = 0;
                for (let idx = 0; idx < rawRows.length; idx++) {
                  const row = rawRows[idx];
                  const { gene, uniprot, description, mw } = resolveRowIdentity(row);
                  if (!gene) continue;

                  proteinCount += 1;
                  const values = condFracs.map(f => parseNumericIntensity(row[f.colName]));
                  const apex = findApex(values, fracNumbers);

                  profiles.push({
                    id: `${gene}__${cond}__${idx}`,
                    gene,
                    uniprot,
                    description,
                    mw,
                    condition: cond,
                    replicate,
                    plate,
                    fractions: fracNumbers,
                    values,
                    apexFraction: apex.apexFraction,
                    apexIntensity: apex.apexIntensity,
                    totalArea: apex.totalArea
                  });
                }

                metaMap.set(dsId, {
                  id: dsId,
                  name: `${fileName} (${cond})`,
                  condition: cond,
                  replicate,
                  plate,
                  fractionCount: condFracs.length,
                  fractionNames: fracNames,
                  proteinCount,
                  source: 'upload'
                });
              }
            }
          } else {
            // CASE B: Standard single-run or stacked format (Condition column or uniform fraction columns)
            const sortedFracs = fractionHeaders
              .filter(f => !f.condition || conditionPrefixes.size <= 1)
              .sort((a, b) => a.fracNum - b.fracNum);

            const fracNumbers = sortedFracs.map(f => f.fracNum);
            const fracNames = sortedFracs.map(f => f.colName);
            const headerReplicate = sortedFracs[0]?.replicate;
            const headerPlate = sortedFracs[0]?.plate;

            if (isPrecursorMatrix) {
              const datasetAgg = new Map<
                string,
                {
                  condition: string;
                  replicate?: string;
                  plate?: string;
                  precursorCount: number;
                  proteins: Map<
                    string,
                    { gene: string; uniprot: string; description: string; mw?: number; values: number[] }
                  >;
                }
              >();

              for (let idx = 0; idx < rawRows.length; idx++) {
                const row = rawRows[idx];
                const { gene, uniprot, description, mw } = resolveRowIdentity(row);
                if (!gene) continue;

                const condition =
                  conditionCol && row[conditionCol]
                    ? row[conditionCol].trim()
                    : inferredFileCondition || 'Default';
                const replicate =
                  replicateCol && row[replicateCol] ? row[replicateCol].trim() : headerReplicate;
                const plate = plateCol && row[plateCol] ? row[plateCol].trim() : headerPlate;

                const dsKey = `${condition}_${replicate || 'rep1'}_${plate || 'plate1'}`;
                let ds = datasetAgg.get(dsKey);
                if (!ds) {
                  ds = {
                    condition,
                    replicate,
                    plate,
                    precursorCount: 0,
                    proteins: new Map()
                  };
                  datasetAgg.set(dsKey, ds);
                }

                ds.precursorCount += 1;
                const pKey = gene.toLowerCase();
                let entry = ds.proteins.get(pKey);
                if (!entry) {
                  entry = {
                    gene,
                    uniprot,
                    description,
                    mw,
                    values: new Array(sortedFracs.length).fill(0)
                  };
                  ds.proteins.set(pKey, entry);
                } else {
                  if (!entry.uniprot && uniprot) entry.uniprot = uniprot;
                  if (!entry.description && description) entry.description = description;
                  if (entry.mw === undefined && mw !== undefined) entry.mw = mw;
                }

                for (let i = 0; i < sortedFracs.length; i++) {
                  const val = parseNumericIntensity(row[sortedFracs[i].colName]);
                  if (val > 0) entry.values[i] += val;
                }
              }

              datasetAgg.forEach((ds, dsKey) => {
                metaMap.set(dsKey, {
                  id: dsKey,
                  name: `${ds.condition}${ds.replicate ? ` (${ds.replicate})` : ''}`,
                  condition: ds.condition,
                  replicate: ds.replicate,
                  plate: ds.plate,
                  fractionCount: sortedFracs.length,
                  fractionNames: fracNames,
                  proteinCount: ds.proteins.size,
                  precursorCount: ds.precursorCount,
                  source: 'upload'
                });

                let idx = 0;
                ds.proteins.forEach(entry => {
                  const apex = findApex(entry.values, fracNumbers);
                  profiles.push({
                    id: `${entry.gene}__${ds.condition}__${ds.replicate || ''}__${ds.plate || ''}__${idx++}`,
                    gene: entry.gene,
                    uniprot: entry.uniprot,
                    description: entry.description,
                    mw: entry.mw,
                    condition: ds.condition,
                    replicate: ds.replicate,
                    plate: ds.plate,
                    fractions: fracNumbers,
                    values: entry.values,
                    apexFraction: apex.apexFraction,
                    apexIntensity: apex.apexIntensity,
                    totalArea: apex.totalArea
                  });
                });
              });
            } else {
              for (let idx = 0; idx < rawRows.length; idx++) {
                const row = rawRows[idx];
                const { gene, uniprot, description, mw } = resolveRowIdentity(row);
                if (!gene) continue;

                const condition =
                  conditionCol && row[conditionCol]
                    ? row[conditionCol].trim()
                    : inferredFileCondition || 'Default';

                const replicate =
                  replicateCol && row[replicateCol] ? row[replicateCol].trim() : headerReplicate;
                const plate = plateCol && row[plateCol] ? row[plateCol].trim() : headerPlate;

                const values = sortedFracs.map(f => parseNumericIntensity(row[f.colName]));
                const apex = findApex(values, fracNumbers);

                const dsKey = `${condition}_${replicate || 'rep1'}_${plate || 'plate1'}`;
                if (!metaMap.has(dsKey)) {
                  metaMap.set(dsKey, {
                    id: dsKey,
                    name: `${condition}${replicate ? ` (${replicate})` : ''}`,
                    condition,
                    replicate,
                    plate,
                    fractionCount: sortedFracs.length,
                    fractionNames: fracNames,
                    proteinCount: 0,
                    source: 'upload'
                  });
                }
                const currentMeta = metaMap.get(dsKey)!;
                currentMeta.proteinCount += 1;

                profiles.push({
                  id: `${gene}__${condition}__${replicate || ''}__${plate || ''}__${idx}`,
                  gene,
                  uniprot,
                  description,
                  mw,
                  condition,
                  replicate,
                  plate,
                  fractions: fracNumbers,
                  values,
                  apexFraction: apex.apexFraction,
                  apexIntensity: apex.apexIntensity,
                  totalArea: apex.totalArea
                });
              }
            }
          }

          if (profiles.length === 0) {
            return reject(
              new Error(
                'No valid protein rows were found in this file. Please ensure there is a gene or protein identifier column.'
              )
            );
          }

          resolve({
            profiles,
            metadata: Array.from(metaMap.values())
          });
        } catch (err) {
          reject(err);
        }
      },
      error: (err) => reject(err)
    });
  });
}

/**
 * Combines multiple datasets or profile sets into a single unified CSV string for export.
 */
export function exportCombinedCSV(profiles: ProteinProfile[]): string {
  if (profiles.length === 0) return '';

  const fractions = profiles[0].fractions;
  const fracHeaders = fractions.map(f => `Fraction_${f}`);

  const headers = ['Gene', 'UniProt', 'Complex', 'MonomerMW_kDa', 'Condition', 'Replicate', 'Plate', ...fracHeaders];

  const rows = profiles.map(p => {
    const meta = [
      csvEscape(p.gene),
      csvEscape(p.uniprot || ''),
      csvEscape(p.description || ''),
      p.mw !== undefined ? p.mw.toString() : '',
      csvEscape(p.condition),
      csvEscape(p.replicate || ''),
      csvEscape(p.plate || '')
    ];
    const vals = p.values.map(v => v.toString());
    return [...meta, ...vals].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
