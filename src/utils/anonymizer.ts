import { ProteinProfile } from '../types/sec';

export interface AnonymizationKeyEntry {
  originalGene: string;
  anonymizedGene: string;
  originalUniProt: string;
  anonymizedUniProt: string;
  originalDescription: string;
  anonymizedDescription: string;
}

export interface AnonymizationResult {
  anonymizedProfiles: ProteinProfile[];
  keyEntries: AnonymizationKeyEntry[];
  geneMap: Map<string, string>;
}

/**
 * Anonymizes/pseudonymizes a list of ProteinProfiles according to GDPR compliance.
 * Replaces Gene names with PRT_XXXX, UniProt with UP_XXXX, and Descriptions with DESC_XXXX.
 */
export function anonymizeProfiles(profiles: ProteinProfile[]): AnonymizationResult {
  const uniqueGenes = Array.from(new Set(profiles.map(p => p.gene))).sort();
  const geneMap = new Map<string, string>();
  const uniprotMap = new Map<string, string>();
  const descMap = new Map<string, string>();

  uniqueGenes.forEach((g, idx) => {
    geneMap.set(g.toLowerCase(), `PRT_${String(idx + 1).padStart(4, '0')}`);
  });

  const uniqueUniprots = Array.from(new Set(profiles.map(p => p.uniprot).filter(Boolean))).sort();
  uniqueUniprots.forEach((u, idx) => {
    uniprotMap.set(u.toLowerCase(), `UP_${String(idx + 1).padStart(4, '0')}`);
  });

  const uniqueDescs = Array.from(new Set(profiles.map(p => p.description).filter(Boolean))).sort();
  uniqueDescs.forEach((d, idx) => {
    descMap.set(d, `DESC_${String(idx + 1).padStart(4, '0')}`);
  });

  const keyEntries: AnonymizationKeyEntry[] = [];
  const processedGenes = new Set<string>();

  const anonymizedProfiles: ProteinProfile[] = profiles.map(p => {
    const anonGene = geneMap.get(p.gene.toLowerCase()) || p.gene;
    const anonUniProt = p.uniprot ? (uniprotMap.get(p.uniprot.toLowerCase()) || `UP_${anonGene.replace('PRT_', '')}`) : '';
    const anonDesc = p.description ? (descMap.get(p.description) || `DESC_${anonGene.replace('PRT_', '')}`) : '';

    if (!processedGenes.has(p.gene.toLowerCase())) {
      processedGenes.add(p.gene.toLowerCase());
      keyEntries.push({
        originalGene: p.gene,
        anonymizedGene: anonGene,
        originalUniProt: p.uniprot,
        anonymizedUniProt: anonUniProt,
        originalDescription: p.description,
        anonymizedDescription: anonDesc
      });
    }

    return {
      ...p,
      id: `${anonGene}__${p.condition}__${p.replicate || ''}__${p.plate || ''}`,
      gene: anonGene,
      uniprot: anonUniProt,
      description: anonDesc
    };
  });

  return {
    anonymizedProfiles,
    keyEntries,
    geneMap
  };
}

/**
 * Exports the de-anonymization mapping key table as a CSV string.
 */
export function exportAnonymizationKeyCSV(keyEntries: AnonymizationKeyEntry[]): string {
  const headers = ['Original_Gene', 'Anonymized_Gene', 'Original_UniProt', 'Anonymized_UniProt', 'Original_Description', 'Anonymized_Description'];
  const rows = keyEntries.map(e => [
    e.originalGene,
    e.anonymizedGene,
    e.originalUniProt,
    e.anonymizedUniProt,
    `"${(e.originalDescription || '').replace(/"/g, '""')}"`,
    e.anonymizedDescription
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
