export interface ProteinProfile {
  id: string; // Unique key: gene + condition + replicate
  gene: string;
  uniprot: string;
  description: string;
  mw?: number;
  condition: string;
  replicate?: string;
  plate?: string;
  fractions: number[]; // numerical indices, e.g. [1, 2, ..., 70]
  values: number[];    // raw intensities across fractions
  apexFraction: number;
  apexIntensity: number;
  totalArea: number;
}

export interface DatasetMeta {
  id: string;
  name: string;
  condition: string;
  replicate?: string;
  plate?: string;
  fractionCount: number;
  fractionNames: string[];
  proteinCount: number;
  source: 'preset' | 'upload';
}

export interface CoelutingCandidate {
  profile: ProteinProfile;
  pearsonR: number;
  dotProduct: number;
  peakOffset: number; // apexFraction - queryApex
  inSameComplex: boolean;
  isKnownInteractor: boolean;
  complexIds: string[];
}

export interface PCprophetComplex {
  id: string;
  condition: string;
  members: string[];
  peak?: number | null;
  rf: number;
  mw?: number | null;
  stoich?: string;
}

export interface PCprophetPPI {
  condition: string;
  geneA: string;
  geneB: string;
  complex_id: string;
}

export type NormalizationMode = 'raw' | 'peak' | 'area';
