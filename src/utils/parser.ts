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

export type AggregationMode = 'sum' | 'mean' | 'none';

export interface ColumnMapping {
  /** Primary protein / gene identifier column (displayed as the main label) */
  proteinNameCol: string;
  /** Optional fallback identifier column when proteinNameCol is blank on a row */
  fallbackNameCol?: string;
  /** Optional accession / UniProt ID column */
  accessionCol?: string;
  /** Optional protein description / annotation / complex column */
  descriptionCol?: string;
  /** Optional monomer molecular weight (kDa) column */
  mwCol?: string;
  /** Optional condition / timepoint column (for stacked matrices) */
  conditionCol?: string;
  /** Optional replicate column (for stacked matrices) */
  replicateCol?: string;
  /** Optional plate column (for stacked matrices) */
  plateCol?: string;
  /** How to combine multiple rows sharing the same protein name within one run */
  aggregationMode?: AggregationMode;
  /** Optional override for single-condition run name */
  conditionOverride?: string;
  /** Optional manual list of fraction columns (overrides auto-detected fractions when provided) */
  manualFractionCols?: string[];
}

export interface ColumnStats {
  name: string;
  nonEmptyCount: number;
  totalSampled: number;
  fillRate: number;
  numericRate: number;
  uniqueCount: number;
  sampleValues: string[];
  isFractionCol: boolean;
  isPrecursorCol: boolean;
}

export interface FileInspectionResult {
  fileName: string;
  columns: string[];
  columnStats: ColumnStats[];
  metadataColumns: string[];
  fractionColumns: ParsedFractionCol[];
  candidateNumericCols: string[];
  detectedConditions: string[];
  isPrecursorMatrix: boolean;
  isLongFormatReport: boolean;
  totalRows: number;
  sampleRows: Record<string, string>[];
  suggestedMapping: ColumnMapping;
  inferredCondition: string;
  rawRows: Record<string, string>[];
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

const PRECURSOR_COL_REGEX =
  /^(?:precursor\.id|precursor\.charge|stripped\.sequence|modified\.sequence|eg\.precursorid|eg\.modifiedsequence|peptide\.sequence)$/i;

const NON_ID_METADATA_REGEX =
  /^(?:unnamed:\s*\d+|index|row|row_id|#|proteotypic|stripped\.sequence|modified\.sequence|precursor\.charge|precursor\.id|eg\.\w+|charge|n\.sequences|n\.proteotypic\.sequences|n\.genes|gene_count|num_genes|protein\s+length|length|monomermw_kda|mw|mw_kda|molecular_weight|mol\.\s*weight.*|fdr|q\.value|global\.q\.value|lib\.q\.value|pg\.q\.value|pep|score|f1[_\s-]?score|rt|im|ccs|mz|condition|timepoint|treatment|sample_id|sample|replicate|rep|biorep|techrep|plate|plate_id|batch|group|reverse|potential\s+contaminant|only\s+identified\s+by\s+site|ms\/ms\s+count|peptides|unique\s+peptides|razor.*|sequence\s+coverage.*)$/i;

function stripBomAndTrim(value: string): string {
  return value.replace(/^\uFEFF/, '').trim();
}

function isKnownMetadataColumn(cleanHeader: string): boolean {
  return /^(?:unnamed:\s*\d+|index|row|row_id|#|gene|genes|gene_name|gene[._\s]names?|gene[._\s]?symbol|symbol|hgnc|pg\.genes|protein\.group|protein\.ids?|protein\.names?|protein[._\s]?name|pg\.protein\w*|protein|protein_id|protein\s+id|majority\s+protein\s+ids|entry|entry[._\s]?name|locus|locus[._\s]?tag|orf|fasta\s+headers|first\.protein\.description|protein\.description|protein\s+description|description|product|function|annotation|complex|name|target|identifier|organism|uniprot|uniprot_id|uniprotkb|accession|proteotypic|stripped\.sequence|modified\.sequence|precursor\.charge|precursor\.id|eg\.\w+|peptide|peptides|unique\s+peptides|razor.*|sequence|sequence\s+coverage.*|charge|n\.sequences|n\.proteotypic\.sequences|n\.genes|gene_count|num_genes|protein\s+length|length|monomermw_kda|mw|mw_kda|molecular_weight|mol\.\s*weight.*|fdr|q\.value|global\.q\.value|lib\.q\.value|pg\.q\.value|pep|score|f1[_\s-]?score|rt|im|ccs|mz|condition|timepoint|treatment|sample_id|sample|replicate|rep|biorep|techrep|plate|plate_id|batch|group|reverse|potential\s+contaminant|only\s+identified\s+by\s+site|indistinguishable\s+proteins|ms\/ms\s+count|id)$/i.test(
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

/**
 * Converts a user-selected ordered list of column names into ParsedFractionCol entries
 * when automatic fraction header detection doesn't match custom column names.
 */
export function buildManualFractionColumns(colNames: string[]): ParsedFractionCol[] {
  const detected = detectFractionColumns(colNames);
  if (detected.length === colNames.length) {
    return detected;
  }

  const parsedNums = colNames.map(col => {
    const clean = stripBomAndTrim(col);
    const numMatch = clean.match(/(\d+)\s*$/);
    return numMatch ? parseInt(numMatch[1], 10) : null;
  });

  const allHaveUniqueNums =
    parsedNums.every((n): n is number => n !== null) &&
    new Set(parsedNums).size === colNames.length;

  return colNames.map((colName, idx) => ({
    colName,
    fracNum: allHaveUniqueNums ? (parsedNums[idx] as number) : idx + 1
  }));
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

function isPureNumericValue(val: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(val);
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

function computeColumnStats(
  columns: string[],
  rawRows: Record<string, string>[],
  fractionColSet: Set<string>
): ColumnStats[] {
  const sampleLimit = Math.min(rawRows.length, 200);
  return columns.map(name => {
    let nonEmptyCount = 0;
    let numericCount = 0;
    const uniqueVals = new Set<string>();
    const sampleValues: string[] = [];

    for (let i = 0; i < sampleLimit; i++) {
      const v = (rawRows[i]?.[name] || '').trim();
      if (!v || v === 'NA' || v === 'NaN' || v === 'null') continue;
      nonEmptyCount++;
      if (isPureNumericValue(v)) numericCount++;
      if (!uniqueVals.has(v)) {
        uniqueVals.add(v);
        if (sampleValues.length < 3) sampleValues.push(v);
      }
    }

    const clean = stripBomAndTrim(name);
    return {
      name,
      nonEmptyCount,
      totalSampled: sampleLimit,
      fillRate: sampleLimit > 0 ? nonEmptyCount / sampleLimit : 0,
      numericRate: nonEmptyCount > 0 ? numericCount / nonEmptyCount : 0,
      uniqueCount: uniqueVals.size,
      sampleValues,
      isFractionCol: fractionColSet.has(name),
      isPrecursorCol: PRECURSOR_COL_REGEX.test(clean)
    };
  });
}

function scoreProteinNameCandidate(stat: ColumnStats): number {
  const clean = stripBomAndTrim(stat.name);
  if (!clean || stat.isFractionCol || stat.fillRate === 0) return -1000;
  // Reject pure numeric index/count/charge columns
  if (stat.numericRate > 0.9) return -500;
  if (stat.isPrecursorCol) return -200;
  if (NON_ID_METADATA_REGEX.test(clean)) return -400;

  let baseScore = 0;
  if (/^(?:gene|genes|gene_name|gene[._\s]names?|gene[._\s]?symbol|genesymbol|symbol|pg\.genes|hgnc)$/i.test(clean)) {
    baseScore = 100;
  } else if (/^(?:protein[._\s]?names?|pg\.proteinnames?|entry[._\s]?name|protein_id|protein\s+id|protein|locus|locus[._\s]?tag|orf)$/i.test(clean)) {
    baseScore = 90;
  } else if (/^(?:protein\.group|pg\.proteingroups|protein\.ids?|majority\s+protein\s+ids|uniprot|uniprot_id|accession|entry)$/i.test(clean)) {
    baseScore = 82;
  } else if (/^(?:name|target|identifier|id)$/i.test(clean)) {
    baseScore = 70;
  } else if (/^(?:first\.protein\.description|protein[._\s]?description|description|product)$/i.test(clean)) {
    baseScore = 50;
  } else if (/gene|protein|symbol|locus|orf/i.test(clean) && !/count|length|mw|weight|score|q\.value|fdr|sequence/i.test(clean)) {
    baseScore = 65;
  } else {
    baseScore = 15;
  }

  // Strongly penalize mostly-empty columns (e.g. FASTA without GN= tags where Genes is 95% blank)
  if (stat.fillRate < 0.5) {
    baseScore -= 55 * (1 - stat.fillRate);
  } else {
    baseScore += stat.fillRate * 10;
  }

  // Slight preference for columns with diverse values (actual protein identifiers rather than a constant column)
  if (stat.uniqueCount <= 1 && stat.totalSampled > 5) {
    baseScore -= 40;
  }

  return baseScore;
}

function suggestColumnMapping(
  columns: string[],
  columnStats: ColumnStats[],
  isPrecursorMatrix: boolean,
  inferredCondition: string
): ColumnMapping {
  const norm = (c: string) => stripBomAndTrim(c);
  const statsByName = new Map(columnStats.map(s => [s.name, s]));
  const nonFractionStats = columnStats.filter(s => !s.isFractionCol);

  // 1. Primary Protein / Gene Name column (content-aware ranking)
  const rankedNameCols = [...nonFractionStats]
    .map(stat => ({ stat, score: scoreProteinNameCandidate(stat) }))
    .sort((a, b) => b.score - a.score);

  const proteinNameCol =
    rankedNameCols[0]?.stat.name ||
    nonFractionStats[0]?.name ||
    columns[0] ||
    '';

  // 2. Fallback identifier column when proteinNameCol is blank on specific rows
  const fallbackNameCol =
    rankedNameCols.find(
      item =>
        item.stat.name !== proteinNameCol &&
        item.score >= 50 &&
        item.stat.fillRate > 0.5
    )?.stat.name || '';

  // 3. Accession / UniProt ID column
  const findColByRegex = (regex: RegExp, exclude: string[] = []): string => {
    const match = nonFractionStats.find(
      s => !exclude.includes(s.name) && s.fillRate > 0 && regex.test(norm(s.name))
    );
    return match ? match.name : '';
  };

  let accessionCol =
    findColByRegex(/^(?:uniprot|uniprot_id|uniprotkb|accession|entry|pg\.proteinaccessions?)$/i, [proteinNameCol]) ||
    findColByRegex(/^(?:protein\.group|pg\.proteingroups|majority\s+protein\s+ids|protein\.ids?|protein\s+id)$/i, [proteinNameCol]);

  // If no distinct column matched, allow Protein.Group / UniProt even if same header only when it's explicitly UniProt/Accession
  if (!accessionCol) {
    accessionCol = findColByRegex(/^(?:uniprot|uniprot_id|accession)$/i);
  }

  // 4. Description / Annotation column
  const primarySamples = JSON.stringify(statsByName.get(proteinNameCol)?.sampleValues || []);
  let descriptionCol =
    findColByRegex(
      /^(?:first\.protein\.description|protein\.description|protein\s+description|pg\.proteindescriptions?|description|product|function|annotation|complex|fasta\s+headers)$/i,
      [proteinNameCol]
    );
  if (!descriptionCol) {
    const altNameCol = findColByRegex(
      /^(?:protein\.names?|pg\.proteinnames?|entry\s+name|name)$/i,
      [proteinNameCol, accessionCol]
    );
    if (altNameCol) {
      const altSamples = JSON.stringify(statsByName.get(altNameCol)?.sampleValues || []);
      if (altSamples !== primarySamples) {
        descriptionCol = altNameCol;
      }
    }
  }

  // 5. Molecular Weight & stacked metadata columns
  const mwCol =
    nonFractionStats.find(s =>
      /^(?:monomermw_kda|mw|mw_kda|molecular_weight|mol\.\s*weight.*|mass_kda)$/i.test(norm(s.name))
    )?.name || '';

  const conditionCol =
    nonFractionStats.find(s =>
      /^(?:condition|timepoint|treatment|sample_id|sample)$/i.test(norm(s.name))
    )?.name || '';

  const replicateCol =
    nonFractionStats.find(s =>
      /^(?:replicate|rep|biorep|techrep)$/i.test(norm(s.name))
    )?.name || '';

  const plateCol =
    nonFractionStats.find(s =>
      /^(?:plate|plate_id)$/i.test(norm(s.name))
    )?.name || '';

  return {
    proteinNameCol,
    fallbackNameCol: fallbackNameCol || undefined,
    accessionCol: accessionCol || undefined,
    descriptionCol: descriptionCol || undefined,
    mwCol: mwCol || undefined,
    conditionCol: conditionCol || undefined,
    replicateCol: replicateCol || undefined,
    plateCol: plateCol || undefined,
    aggregationMode: isPrecursorMatrix ? 'sum' : 'none',
    conditionOverride: inferredCondition
  };
}

/**
 * Parses and inspects a SEC-DIA CSV/TSV file without committing to a fixed column mapping.
 * Returns column statistics, sample rows, detected fractions, and smart suggested mappings
 * so users can review or customize which column is Protein Name, Accession, Description, etc.
 */
export async function inspectSECDIAFile(
  fileOrText: File | string,
  fileName: string = 'SEC_Data.csv'
): Promise<FileInspectionResult> {
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

          const isPrecursorMatrix = columns.some(c => PRECURSOR_COL_REGEX.test(norm(c)));
          const fractionColumns = detectFractionColumns(columns);
          const fractionColSet = new Set(fractionColumns.map(f => f.colName));
          const columnStats = computeColumnStats(columns, rawRows, fractionColSet);
          const metadataColumns = columns.filter(c => !fractionColSet.has(c));

          // Candidate numeric columns for manual fraction selection if auto-detection found none
          const candidateNumericCols = columnStats
            .filter(
              s =>
                !s.isFractionCol &&
                !s.isPrecursorCol &&
                !NON_ID_METADATA_REGEX.test(norm(s.name)) &&
                s.fillRate > 0 &&
                s.numericRate >= 0.85
            )
            .map(s => s.name);

          const conditionPrefixes = new Set<string>();
          for (const f of fractionColumns) {
            if (f.condition) conditionPrefixes.add(f.condition);
          }

          const singleHeaderCondition =
            conditionPrefixes.size === 1 ? Array.from(conditionPrefixes)[0] : undefined;
          const inferredCondition = singleHeaderCondition || inferConditionFromFileName(fileName);

          const isLongFormatReport =
            fractionColumns.length === 0 &&
            columns.some(c => /^(?:run|file\.name|r\.filename)$/i.test(norm(c)));

          const suggestedMapping = suggestColumnMapping(
            columns,
            columnStats,
            isPrecursorMatrix,
            inferredCondition
          );

          // Collect distinct detected conditions (either wide header prefixes or stacked Condition column)
          const detectedConditions = new Set<string>();
          if (conditionPrefixes.size > 1 && !suggestedMapping.conditionCol) {
            conditionPrefixes.forEach(c => detectedConditions.add(c));
          } else if (suggestedMapping.conditionCol) {
            const condColName = suggestedMapping.conditionCol;
            for (let i = 0; i < rawRows.length; i++) {
              const v = (rawRows[i]?.[condColName] || '').trim();
              if (v) detectedConditions.add(v);
            }
          }
          if (detectedConditions.size === 0) {
            detectedConditions.add(inferredCondition);
          }

          resolve({
            fileName,
            columns,
            columnStats,
            metadataColumns,
            fractionColumns,
            candidateNumericCols,
            detectedConditions: Array.from(detectedConditions),
            isPrecursorMatrix,
            isLongFormatReport,
            totalRows: rawRows.length,
            sampleRows: rawRows.slice(0, 8),
            suggestedMapping,
            inferredCondition,
            rawRows
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
 * Builds ProteinProfile[] and DatasetMeta[] from an inspected file using either
 * the auto-suggested column mapping or user-customized overrides.
 */
export function buildProfilesFromInspection(
  inspection: FileInspectionResult,
  mappingOverride?: Partial<ColumnMapping>,
  fallbackCondition?: string
): { profiles: ProteinProfile[]; metadata: DatasetMeta[] } {
  const { rawRows, fileName } = inspection;
  const mapping: ColumnMapping = {
    ...inspection.suggestedMapping,
    ...mappingOverride
  };

  const fractionHeaders =
    mapping.manualFractionCols && mapping.manualFractionCols.length > 0
      ? buildManualFractionColumns(mapping.manualFractionCols)
      : inspection.fractionColumns;

  if (fractionHeaders.length === 0) {
    if (inspection.isLongFormatReport) {
      throw new Error(
        'Detected a long-format DIA-NN report (Run / File.Name column). Please upload a DIA-NN matrix file (*_pg_matrix.tsv, *_pr_matrix.tsv, or *_gg_matrix.tsv) or wide SEC CSV.'
      );
    }
    throw new Error(
      'No fraction columns detected. Expecting headers like Fraction_1, Frac_1, F1, or DIA-NN raw run paths containing _F01_ / _Frac1_ — or select fraction columns manually.'
    );
  }

  const proteinNameCol = mapping.proteinNameCol;
  const fallbackNameCol = mapping.fallbackNameCol || '';
  const accessionCol = mapping.accessionCol || '';
  const descriptionCol = mapping.descriptionCol || '';
  const mwCol = mapping.mwCol || '';
  const conditionCol = mapping.conditionCol || '';
  const replicateCol = mapping.replicateCol || '';
  const plateCol = mapping.plateCol || '';
  const aggregationMode: AggregationMode =
    mapping.aggregationMode ?? (inspection.isPrecursorMatrix ? 'sum' : 'none');

  const resolveRowIdentity = (row: Record<string, string>) => {
    const primary = proteinNameCol ? (row[proteinNameCol] || '').trim() : '';
    const fallback = fallbackNameCol ? (row[fallbackNameCol] || '').trim() : '';
    const accession = accessionCol ? (row[accessionCol] || '').trim() : '';
    const description = descriptionCol ? (row[descriptionCol] || '').trim() : '';
    const gene = primary || fallback || accession;
    const parsedMw = mwCol && row[mwCol] ? parseFloat(row[mwCol]) : NaN;
    const mw = !isNaN(parsedMw) && isFinite(parsedMw) ? parsedMw : undefined;
    return { gene, uniprot: accession, description, mw };
  };

  const conditionPrefixes = new Set<string>();
  for (const f of fractionHeaders) {
    if (f.condition) conditionPrefixes.add(f.condition);
  }

  const profiles: ProteinProfile[] = [];
  const metaMap = new Map<string, DatasetMeta>();

  const singleConditionLabel =
    fallbackCondition ||
    (mapping.conditionOverride && mapping.conditionOverride.trim()) ||
    inspection.inferredCondition ||
    'Default';

  const shouldAggregate = aggregationMode === 'sum' || aggregationMode === 'mean';

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

      if (shouldAggregate) {
        const aggMap = new Map<
          string,
          {
            gene: string;
            uniprot: string;
            description: string;
            mw?: number;
            sums: number[];
            counts: number[];
            rowCount: number;
          }
        >();
        let totalSourceRows = 0;

        for (const row of rawRows) {
          const { gene, uniprot, description, mw } = resolveRowIdentity(row);
          if (!gene) continue;

          const key =
            inspection.isPrecursorMatrix && uniprot
              ? uniprot.toLowerCase()
              : gene.toLowerCase();
          let entry = aggMap.get(key);
          if (!entry) {
            entry = {
              gene,
              uniprot,
              description,
              mw,
              sums: new Array(condFracs.length).fill(0),
              counts: new Array(condFracs.length).fill(0),
              rowCount: 0
            };
            aggMap.set(key, entry);
          } else {
            if (!entry.uniprot && uniprot) entry.uniprot = uniprot;
            if (!entry.description && description) entry.description = description;
            if (entry.mw === undefined && mw !== undefined) entry.mw = mw;
          }

          entry.rowCount += 1;
          totalSourceRows += 1;

          for (let i = 0; i < condFracs.length; i++) {
            const val = parseNumericIntensity(row[condFracs[i].colName]);
            if (val > 0) {
              entry.sums[i] += val;
              entry.counts[i] += 1;
            }
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
          precursorCount: inspection.isPrecursorMatrix || totalSourceRows > aggMap.size ? totalSourceRows : undefined,
          source: 'upload'
        });

        // Disambiguate display names if two distinct protein groups share the exact same label (e.g. "hypothetical protein")
        const nameCountsA = new Map<string, number>();
        aggMap.forEach(entry => {
          const k = entry.gene.toLowerCase();
          nameCountsA.set(k, (nameCountsA.get(k) || 0) + 1);
        });

        let idx = 0;
        aggMap.forEach(entry => {
          const displayGene =
            (nameCountsA.get(entry.gene.toLowerCase()) || 0) > 1 &&
            entry.uniprot &&
            entry.uniprot.toLowerCase() !== entry.gene.toLowerCase()
              ? `${entry.gene} [${entry.uniprot}]`
              : entry.gene;
          const values =
            aggregationMode === 'mean'
              ? entry.sums.map((s, i) => (entry.counts[i] > 0 ? s / entry.counts[i] : 0))
              : entry.sums;
          const apex = findApex(values, fracNumbers);
          profiles.push({
            id: `${displayGene}__${cond}__${idx++}`,
            gene: displayGene,
            uniprot: entry.uniprot,
            description: entry.description,
            mw: entry.mw,
            condition: cond,
            replicate,
            plate,
            fractions: fracNumbers,
            values,
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
    // CASE B: Standard single-run or stacked format
    const sortedFracs = fractionHeaders
      .filter(f => !f.condition || conditionPrefixes.size <= 1)
      .sort((a, b) => a.fracNum - b.fracNum);

    const fracNumbers = sortedFracs.map(f => f.fracNum);
    const fracNames = sortedFracs.map(f => f.colName);
    const headerReplicate = sortedFracs[0]?.replicate;
    const headerPlate = sortedFracs[0]?.plate;

    if (shouldAggregate) {
      const datasetAgg = new Map<
        string,
        {
          condition: string;
          replicate?: string;
          plate?: string;
          sourceRows: number;
          proteins: Map<
            string,
            {
              gene: string;
              uniprot: string;
              description: string;
              mw?: number;
              sums: number[];
              counts: number[];
            }
          >;
        }
      >();

      for (let idx = 0; idx < rawRows.length; idx++) {
        const row = rawRows[idx];
        const { gene, uniprot, description, mw } = resolveRowIdentity(row);
        if (!gene) continue;

        const condition =
          conditionCol && row[conditionCol] ? row[conditionCol].trim() : singleConditionLabel;
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
            sourceRows: 0,
            proteins: new Map()
          };
          datasetAgg.set(dsKey, ds);
        }

        ds.sourceRows += 1;
        const pKey =
          inspection.isPrecursorMatrix && uniprot
            ? uniprot.toLowerCase()
            : gene.toLowerCase();
        let entry = ds.proteins.get(pKey);
        if (!entry) {
          entry = {
            gene,
            uniprot,
            description,
            mw,
            sums: new Array(sortedFracs.length).fill(0),
            counts: new Array(sortedFracs.length).fill(0)
          };
          ds.proteins.set(pKey, entry);
        } else {
          if (!entry.uniprot && uniprot) entry.uniprot = uniprot;
          if (!entry.description && description) entry.description = description;
          if (entry.mw === undefined && mw !== undefined) entry.mw = mw;
        }

        for (let i = 0; i < sortedFracs.length; i++) {
          const val = parseNumericIntensity(row[sortedFracs[i].colName]);
          if (val > 0) {
            entry.sums[i] += val;
            entry.counts[i] += 1;
          }
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
          precursorCount:
            inspection.isPrecursorMatrix || ds.sourceRows > ds.proteins.size ? ds.sourceRows : undefined,
          source: 'upload'
        });

        const nameCountsB = new Map<string, number>();
        ds.proteins.forEach(entry => {
          const k = entry.gene.toLowerCase();
          nameCountsB.set(k, (nameCountsB.get(k) || 0) + 1);
        });

        let idx = 0;
        ds.proteins.forEach(entry => {
          const displayGene =
            (nameCountsB.get(entry.gene.toLowerCase()) || 0) > 1 &&
            entry.uniprot &&
            entry.uniprot.toLowerCase() !== entry.gene.toLowerCase()
              ? `${entry.gene} [${entry.uniprot}]`
              : entry.gene;
          const values =
            aggregationMode === 'mean'
              ? entry.sums.map((s, i) => (entry.counts[i] > 0 ? s / entry.counts[i] : 0))
              : entry.sums;
          const apex = findApex(values, fracNumbers);
          profiles.push({
            id: `${displayGene}__${ds.condition}__${ds.replicate || ''}__${ds.plate || ''}__${idx++}`,
            gene: displayGene,
            uniprot: entry.uniprot,
            description: entry.description,
            mw: entry.mw,
            condition: ds.condition,
            replicate: ds.replicate,
            plate: ds.plate,
            fractions: fracNumbers,
            values,
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
          conditionCol && row[conditionCol] ? row[conditionCol].trim() : singleConditionLabel;
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
    throw new Error(
      `No valid protein rows were found using "${proteinNameCol}" as the protein name column. Try selecting a different Protein / Gene Name column.`
    );
  }

  return {
    profiles,
    metadata: Array.from(metaMap.values())
  };
}

/**
 * Intelligent one-step parser for single or multi-condition SEC DIA CSV/TSV files,
 * including raw DIA-NN matrices (pg_matrix.tsv, pr_matrix.tsv, gg_matrix.tsv).
 */
export async function parseSECDIAData(
  fileOrText: File | string,
  fileName: string = 'SEC_Data.csv',
  fallbackCondition?: string,
  mappingOverride?: Partial<ColumnMapping>
): Promise<{ profiles: ProteinProfile[]; metadata: DatasetMeta[] }> {
  const inspection = await inspectSECDIAFile(fileOrText, fileName);
  return buildProfilesFromInspection(inspection, mappingOverride, fallbackCondition);
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
