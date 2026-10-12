import Papa from 'papaparse';
import { ProteinProfile, DatasetMeta } from '../types/sec';
import { findApex } from './statistics';

interface ParsedFractionCol {
  colName: string;
  fracNum: number;
  prefix?: string;
  condition?: string;
  replicate?: string;
  plate?: string;
}

/**
 * Extracts fraction number and possible metadata from a column header string.
 * Supports patterns like:
 * - Fraction_1, Fraction 1, Frac_1, Frac 01, F1, F01, SEC_1
 * - 60min_Fraction_1, Rep1_Fraction_1, Plate1_Rep2_F01
 * - Fraction_1_60min, Fraction_1_Rep2
 */
function parseFractionHeader(header: string): ParsedFractionCol | null {
  const clean = header.trim();

  // Wide pattern with prefix: e.g. "60min_Fraction_1", "Rep1_Frac_05", "Plate1_F12"
  const prefixMatch = clean.match(/^([a-zA-Z0-9_\-]+?)_(?:Fraction|Frac|SEC|F)[_\s]*0*(\d+)$/i);
  if (prefixMatch) {
    const rawPrefix = prefixMatch[1];
    const fracNum = parseInt(prefixMatch[2], 10);
    let condition = rawPrefix;
    let replicate: string | undefined = undefined;
    let plate: string | undefined = undefined;

    // Check if prefix contains rep / plate
    const repM = rawPrefix.match(/(?:rep|replicate)[_\s]*(\d+)/i);
    if (repM) replicate = `Rep${repM[1]}`;

    const plateM = rawPrefix.match(/(?:plate)[_\s]*([a-zA-Z0-9]+)/i);
    if (plateM) plate = `Plate${plateM[1]}`;

    return { colName: clean, fracNum, prefix: rawPrefix, condition, replicate, plate };
  }

  // Wide pattern with suffix: e.g. "Fraction_1_60min", "F01_Rep2"
  const suffixMatch = clean.match(/^(?:Fraction|Frac|SEC|F)[_\s]*0*(\d+)_(.+)$/i);
  if (suffixMatch) {
    const fracNum = parseInt(suffixMatch[1], 10);
    const rawSuffix = suffixMatch[2];
    return { colName: clean, fracNum, condition: rawSuffix };
  }

  // Standard fraction pattern: e.g. "Fraction_1", "Fraction 1", "Frac_01", "F1", "F01"
  const stdMatch = clean.match(/^(?:Fraction|Frac|SEC|F)[_\s]*0*(\d+)$/i);
  if (stdMatch) {
    const fracNum = parseInt(stdMatch[1], 10);
    return { colName: clean, fracNum };
  }

  // Pure numeric column header: e.g. "1", "2", ..., "70"
  if (/^\d+$/.test(clean)) {
    const fracNum = parseInt(clean, 10);
    return { colName: clean, fracNum };
  }

  return null;
}

/**
 * Intelligent parser for single or multi-condition SEC DIA CSV files.
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
            return reject(new Error('CSV file appears to be empty or invalid.'));
          }

          const columns = Object.keys(rawRows[0] || {});

          // 1. Detect ID columns
          const geneCol = columns.find(c => /^(gene|gene_name|pg\.genes|protein_id)$/i.test(c.trim())) ||
                          columns.find(c => /gene/i.test(c)) || columns[0];
          const uniprotCol = columns.find(c => /^(uniprot|accession|protein\.ids)$/i.test(c.trim())) || '';
          const descCol = columns.find(c => /^(complex|description|protein\.names|name)$/i.test(c.trim())) || '';
          const mwCol = columns.find(c => /^(monomermw_kda|mw|mw_kda|molecular_weight)$/i.test(c.trim())) || '';

          // 2. Detect metadata columns in stacked format
          const conditionCol = columns.find(c => /^(condition|timepoint|treatment|sample_id|sample)$/i.test(c.trim())) || '';
          const replicateCol = columns.find(c => /^(replicate|rep|biorep|techrep)$/i.test(c.trim())) || '';
          const plateCol = columns.find(c => /^(plate|plate_id)$/i.test(c.trim())) || '';

          // 3. Detect fraction columns
          const fractionHeaders: ParsedFractionCol[] = [];
          for (const col of columns) {
            const parsed = parseFractionHeader(col);
            if (parsed) {
              fractionHeaders.push(parsed);
            }
          }

          if (fractionHeaders.length === 0) {
            return reject(new Error('No fraction columns detected. Expecting headers like Fraction_1, Frac_1, F1, etc.'));
          }

          // Check if wide multi-condition columns exist (e.g. 60min_Fraction_1 and 120min_Fraction_1)
          const conditionPrefixes = new Set<string>();
          for (const f of fractionHeaders) {
            if (f.condition) conditionPrefixes.add(f.condition);
          }

          const profiles: ProteinProfile[] = [];
          const metaMap = new Map<string, DatasetMeta>();

          // Fallback condition deduced from file name (e.g. report_pg_matrix_60min_app.csv -> 60min)
          let inferredFileCondition = fallbackCondition;
          if (!inferredFileCondition) {
            const fileCondMatch = fileName.match(/(60min|120min|30min|ctrl|treat\d*|plate\d*|rep\d*)/i);
            inferredFileCondition = fileCondMatch ? fileCondMatch[1] : fileName.replace(/\.[^/.]+$/, '');
          }

          if (conditionPrefixes.size > 1 && !conditionCol) {
            // CASE A: Wide format with multiple conditions embedded in column headers
            for (const cond of conditionPrefixes) {
              const condFracs = fractionHeaders
                .filter(f => f.condition === cond)
                .sort((a, b) => a.fracNum - b.fracNum);

              const fracNumbers = condFracs.map(f => f.fracNum);
              const fracNames = condFracs.map(f => f.colName);

              const dsId = `${fileName}_${cond}`;
              metaMap.set(dsId, {
                id: dsId,
                name: `${fileName} (${cond})`,
                condition: cond,
                fractionCount: condFracs.length,
                fractionNames: fracNames,
                proteinCount: rawRows.length,
                source: 'upload'
              });

              for (const row of rawRows) {
                const gene = (row[geneCol] || '').trim();
                if (!gene) continue;

                const uniprot = uniprotCol ? (row[uniprotCol] || '').trim() : '';
                const description = descCol ? (row[descCol] || '').trim() : '';
                const mw = mwCol && row[mwCol] ? parseFloat(row[mwCol]) : undefined;

                const values = condFracs.map(f => {
                  const val = parseFloat(row[f.colName] || '0');
                  return isNaN(val) ? 0 : val;
                });

                const apex = findApex(values, fracNumbers);

                profiles.push({
                  id: `${gene}__${cond}`,
                  gene,
                  uniprot,
                  description,
                  mw,
                  condition: cond,
                  fractions: fracNumbers,
                  values,
                  apexFraction: apex.apexFraction,
                  apexIntensity: apex.apexIntensity,
                  totalArea: apex.totalArea
                });
              }
            }
          } else {
            // CASE B: Standard or Stacked (Condition column or uniform fraction columns)
            const sortedFracs = fractionHeaders
              .filter(f => !f.condition || conditionPrefixes.size <= 1)
              .sort((a, b) => a.fracNum - b.fracNum);

            const fracNumbers = sortedFracs.map(f => f.fracNum);
            const fracNames = sortedFracs.map(f => f.colName);

            for (let idx = 0; idx < rawRows.length; idx++) {
              const row = rawRows[idx];
              const gene = (row[geneCol] || '').trim();
              if (!gene) continue;

              const uniprot = uniprotCol ? (row[uniprotCol] || '').trim() : '';
              const description = descCol ? (row[descCol] || '').trim() : '';
              const mw = mwCol && row[mwCol] ? parseFloat(row[mwCol]) : undefined;

              const condition = conditionCol && row[conditionCol]
                ? row[conditionCol].trim()
                : (inferredFileCondition || 'Default');

              const replicate = replicateCol && row[replicateCol] ? row[replicateCol].trim() : undefined;
              const plate = plateCol && row[plateCol] ? row[plateCol].trim() : undefined;

              const values = sortedFracs.map(f => {
                const val = parseFloat(row[f.colName] || '0');
                return isNaN(val) ? 0 : val;
              });

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
      p.gene,
      p.uniprot || '',
      p.description ? `"${p.description.replace(/"/g, '""')}"` : '',
      p.mw !== undefined ? p.mw.toString() : '',
      p.condition,
      p.replicate || '',
      p.plate || ''
    ];
    const vals = p.values.map(v => v.toString());
    return [...meta, ...vals].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
