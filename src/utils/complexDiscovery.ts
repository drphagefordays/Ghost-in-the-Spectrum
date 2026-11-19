import Papa from 'papaparse';
import { ProteinProfile, PCprophetComplex, PCprophetPPI } from '../types/sec';

export interface DiscoveryOptions {
  /** Minimum global Pearson correlation R between co-eluting subunits (default 0.82) */
  minPearsonR?: number;
  /** Minimum cosine similarity between co-eluting subunits (default 0.80) */
  minCosine?: number;
  /** Allowed apex fraction offset between subunits (default 1) */
  peakTolerance?: number;
  /** Maximum subunits per complex cluster to prevent void-volume hairballs (default 16) */
  maxComplexSize?: number;
  /** Maximum direct PPI partners retained per protein (default 12) */
  maxPartnersPerProtein?: number;
  /** Minimum number of non-zero fractions required for a protein to be analyzed (default 3) */
  minDetectedFractions?: number;
}

export interface DiscoveryResult {
  complexes: PCprophetComplex[];
  ppis: PCprophetPPI[];
  stats: {
    eligibleProteins: number;
    complexCount: number;
    ppiCount: number;
    elapsedMs: number;
  };
}

interface PreparedProfile {
  idx: number;
  profile: ProteinProfile;
  apexIndex: number; // index into fractions[]
  apexFraction: number;
  zVec: Float64Array; // zero-mean, unit L2 norm (dot product = Pearson R)
  uVec: Float64Array; // unit L2 norm (dot product = Cosine similarity)
  raw: Float64Array;
}

interface Edge {
  a: number;
  b: number;
  r: number;
  cos: number;
  localSim: number;
  score: number;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}

function localCosine(a: Float64Array, b: Float64Array, centerIdx: number, halfWin: number = 3): number {
  const start = Math.max(0, centerIdx - halfWin);
  const end = Math.min(a.length - 1, centerIdx + halfWin);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = start; i <= end; i++) {
    const ai = a[i];
    const bi = b[i];
    ab += ai * bi;
    aa += ai * ai;
    bb += bi * bi;
  }
  const denom = Math.sqrt(aa * bb);
  return denom > 1e-12 ? Math.max(0, Math.min(1, ab / denom)) : 0;
}

function prepareConditionProfiles(
  profiles: ProteinProfile[],
  minDetectedFractions: number
): PreparedProfile[] {
  const prepared: PreparedProfile[] = [];

  for (let idx = 0; idx < profiles.length; idx++) {
    const p = profiles[idx];
    const n = p.values.length;
    if (n < 3) continue;

    let detected = 0;
    let sum = 0;
    let normSq = 0;
    let maxVal = -Infinity;
    let apexIndex = 0;
    const raw = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const v = p.values[i] > 0 && isFinite(p.values[i]) ? p.values[i] : 0;
      raw[i] = v;
      if (v > 0) detected++;
      sum += v;
      normSq += v * v;
      if (v > maxVal) {
        maxVal = v;
        apexIndex = i;
      }
    }

    if (detected < minDetectedFractions || normSq <= 1e-12) continue;

    const mean = sum / n;
    let varSq = 0;
    const zVec = new Float64Array(n);
    const uVec = new Float64Array(n);
    const l2 = Math.sqrt(normSq);

    for (let i = 0; i < n; i++) {
      const d = raw[i] - mean;
      zVec[i] = d;
      varSq += d * d;
      uVec[i] = raw[i] / l2;
    }

    const stdNorm = Math.sqrt(varSq);
    if (stdNorm <= 1e-12) continue;
    for (let i = 0; i < n; i++) {
      zVec[i] /= stdNorm;
    }

    prepared.push({
      idx: prepared.length,
      profile: p,
      apexIndex,
      apexFraction: p.apexFraction,
      zVec,
      uVec,
      raw
    });
  }

  return prepared;
}

/**
 * In-browser de novo SEC-DIA co-elution complex & PPI discovery engine.
 * Groups proteins with tightly aligned elution peaks, high global Pearson R,
 * high cosine similarity, and local peak shape agreement into cohesive complexes
 * (average-linkage clustering with stoichiometry & confidence scoring).
 */
export function discoverCoelutingComplexes(
  allProfiles: ProteinProfile[],
  options: DiscoveryOptions = {}
): DiscoveryResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const minPearsonR = options.minPearsonR ?? 0.82;
  const minCosine = options.minCosine ?? 0.8;
  const peakTolerance = options.peakTolerance ?? 1;
  const maxComplexSize = options.maxComplexSize ?? 16;
  const maxPartnersPerProtein = options.maxPartnersPerProtein ?? 12;
  const minDetectedFractions = options.minDetectedFractions ?? 3;

  // Group profiles by condition (and replicate if multiple replicates exist)
  const byCondition = new Map<string, ProteinProfile[]>();
  for (const p of allProfiles) {
    const cond = p.condition || 'Default';
    if (!byCondition.has(cond)) byCondition.set(cond, []);
    byCondition.get(cond)!.push(p);
  }

  const allComplexes: PCprophetComplex[] = [];
  const allPpis: PCprophetPPI[] = [];
  let totalEligible = 0;
  let complexCounter = 1;

  byCondition.forEach((condProfiles, condition) => {
    // Deduplicate by gene within one condition (keep highest totalArea profile)
    const bestByGene = new Map<string, ProteinProfile>();
    for (const p of condProfiles) {
      const key = p.gene.toLowerCase();
      const prev = bestByGene.get(key);
      if (!prev || p.totalArea > prev.totalArea) {
        bestByGene.set(key, p);
      }
    }

    const prepared = prepareConditionProfiles(Array.from(bestByGene.values()), minDetectedFractions);
    totalEligible += prepared.length;
    if (prepared.length < 2) return;

    // Bucket prepared proteins by their apex fraction for fast local comparison
    const buckets = new Map<number, PreparedProfile[]>();
    for (const item of prepared) {
      const f = item.apexFraction;
      if (!buckets.has(f)) buckets.set(f, []);
      buckets.get(f)!.push(item);
    }

    const sortedBucketFracs = Array.from(buckets.keys()).sort((a, b) => a - b);

    // Track top neighbors per node (bounded to avoid O(N^2) memory on dense monomer peaks)
    const neighbors: Map<number, Edge>[] = Array.from({ length: prepared.length }, () => new Map());

    const evaluatePair = (a: PreparedProfile, b: PreparedProfile) => {
      const r = dot(a.zVec, b.zVec);
      if (r < minPearsonR) return;

      const cos = dot(a.uVec, b.uVec);
      if (cos < minCosine) return;

      const centerIdx = Math.round((a.apexIndex + b.apexIndex) / 2);
      const localSim = localCosine(a.raw, b.raw, centerIdx, 3);
      if (localSim < 0.75) return;

      const peakDiff = Math.abs(a.apexFraction - b.apexFraction);
      const peakAlign = 1 - peakDiff / (peakTolerance + 1);

      // PCprophet-inspired composite co-elution confidence score in [0, 1]
      const score = Math.max(
        0,
        Math.min(0.999, 0.45 * r + 0.3 * cos + 0.15 * localSim + 0.1 * peakAlign)
      );

      const edge: Edge = { a: a.idx, b: b.idx, r, cos, localSim, score };
      neighbors[a.idx].set(b.idx, edge);
      neighbors[b.idx].set(a.idx, edge);
    };

    // Compare pairs within same apex bucket and within +1..+peakTolerance buckets
    for (let bi = 0; bi < sortedBucketFracs.length; bi++) {
      const fracA = sortedBucketFracs[bi];
      const listA = buckets.get(fracA)!;

      // Intra-bucket pairs
      for (let i = 0; i < listA.length; i++) {
        for (let j = i + 1; j < listA.length; j++) {
          evaluatePair(listA[i], listA[j]);
        }
      }

      // Cross-bucket pairs within peakTolerance
      for (let bj = bi + 1; bj < sortedBucketFracs.length; bj++) {
        const fracB = sortedBucketFracs[bj];
        if (fracB - fracA > peakTolerance) break;
        const listB = buckets.get(fracB)!;
        for (let i = 0; i < listA.length; i++) {
          for (let j = 0; j < listB.length; j++) {
            evaluatePair(listA[i], listB[j]);
          }
        }
      }
    }

    // Prune each node's neighborhood to its top-K strongest co-eluting partners
    const topEdgesMap = new Map<string, Edge>();
    const prunedNeighbors: Map<number, Edge>[] = Array.from({ length: prepared.length }, () => new Map());

    for (let i = 0; i < prepared.length; i++) {
      const sorted = Array.from(neighbors[i].values())
        .sort((e1, e2) => e2.score - e1.score)
        .slice(0, maxPartnersPerProtein);

      for (const edge of sorted) {
        const other = edge.a === i ? edge.b : edge.a;
        prunedNeighbors[i].set(other, edge);
        const key = edge.a < edge.b ? `${edge.a}_${edge.b}` : `${edge.b}_${edge.a}`;
        if (!topEdgesMap.has(key)) {
          topEdgesMap.set(key, edge);
        }
      }
    }

    // Keep mutual or high-scoring seed edges sorted descending by confidence score
    const seedEdges = Array.from(topEdgesMap.values()).sort((e1, e2) => e2.score - e1.score);

    // Cohesive average-linkage greedy clustering into complexes
    const assigned = new Uint8Array(prepared.length);
    const ppiPairSeen = new Set<string>();
    const pairLinkedSet = new Set<string>();

    const addPpi = (idxA: number, idxB: number, complexId: string) => {
      const lo = Math.min(idxA, idxB);
      const hi = Math.max(idxA, idxB);
      const key = `${lo}_${hi}_${complexId}`;
      if (ppiPairSeen.has(key)) return;
      ppiPairSeen.add(key);
      pairLinkedSet.add(`${lo}_${hi}`);
      allPpis.push({
        condition,
        geneA: prepared[lo].profile.gene,
        geneB: prepared[hi].profile.gene,
        complex_id: complexId
      });
    };

    for (const seed of seedEdges) {
      if (assigned[seed.a] || assigned[seed.b]) continue;

      const cluster: number[] = [seed.a, seed.b];
      const clusterSet = new Set<number>(cluster);
      const anchorPeak = Math.round((prepared[seed.a].apexFraction + prepared[seed.b].apexFraction) / 2);

      // Iteratively recruit the best cohesive unassigned candidate connected to existing cluster members
      while (cluster.length < maxComplexSize) {
        const candidateScores = new Map<number, { sumR: number; sumScore: number; hits: number }>();

        for (const memberIdx of cluster) {
          prunedNeighbors[memberIdx].forEach((edge, nbrIdx) => {
            if (clusterSet.has(nbrIdx) || assigned[nbrIdx]) return;
            if (Math.abs(prepared[nbrIdx].apexFraction - anchorPeak) > peakTolerance) return;

            const acc = candidateScores.get(nbrIdx) || { sumR: 0, sumScore: 0, hits: 0 };
            acc.sumR += edge.r;
            acc.sumScore += edge.score;
            acc.hits += 1;
            candidateScores.set(nbrIdx, acc);
          });
        }

        let bestCand = -1;
        let bestAvgScore = -1;
        // Require linkage to at least 60% of existing members (strict cohesion, prevents chaining)
        const minHits = Math.max(2, Math.ceil(cluster.length * 0.6));

        candidateScores.forEach((stats, candIdx) => {
          if (stats.hits < minHits) return;
          // Verify true average Pearson R across ALL cluster members
          let totalR = 0;
          let minMemberR = 1;
          for (const mIdx of cluster) {
            const r = dot(prepared[candIdx].zVec, prepared[mIdx].zVec);
            totalR += r;
            if (r < minMemberR) minMemberR = r;
          }
          const avgR = totalR / cluster.length;
          if (avgR < minPearsonR || minMemberR < minPearsonR - 0.08) return;

          const avgScore = stats.sumScore / stats.hits;
          if (avgScore > bestAvgScore) {
            bestAvgScore = avgScore;
            bestCand = candIdx;
          }
        });

        if (bestCand === -1) break;
        cluster.push(bestCand);
        clusterSet.add(bestCand);
      }

      // Mark members assigned
      for (const mIdx of cluster) {
        assigned[mIdx] = 1;
      }

      // Compute complex-level confidence score (mean pairwise composite score), peak, stoichiometry & MW
      let pairCount = 0;
      let scoreSum = 0;
      const peaks: number[] = [];
      let maxApexInt = 0;
      let mwSum = 0;
      let hasAllMw = true;

      for (let i = 0; i < cluster.length; i++) {
        const pi = prepared[cluster[i]];
        peaks.push(pi.apexFraction);
        if (pi.profile.apexIntensity > maxApexInt) maxApexInt = pi.profile.apexIntensity;
        if (pi.profile.mw !== undefined && pi.profile.mw > 0) {
          mwSum += pi.profile.mw;
        } else {
          hasAllMw = false;
        }

        for (let j = i + 1; j < cluster.length; j++) {
          const pj = prepared[cluster[j]];
          const existing = neighbors[pi.idx].get(pj.idx);
          if (existing) {
            scoreSum += existing.score;
          } else {
            const r = Math.max(0, dot(pi.zVec, pj.zVec));
            const cos = Math.max(0, dot(pi.uVec, pj.uVec));
            const peakAlign = 1 - Math.min(peakTolerance + 1, Math.abs(pi.apexFraction - pj.apexFraction)) / (peakTolerance + 1);
            scoreSum += 0.55 * r + 0.35 * cos + 0.1 * peakAlign;
          }
          pairCount++;
        }
      }

      peaks.sort((a, b) => a - b);
      const consensusPeak = peaks[Math.floor(peaks.length / 2)];
      const rfScore = pairCount > 0 ? Math.round((scoreSum / pairCount) * 1000) / 1000 : 0.8;

      // Sort subunits by descending peak intensity so primary subunit is strongest
      cluster.sort((i1, i2) => prepared[i2].profile.apexIntensity - prepared[i1].profile.apexIntensity);

      const stoich =
        maxApexInt > 0
          ? cluster
              .map(mIdx => Math.max(0.1, prepared[mIdx].profile.apexIntensity / maxApexInt).toFixed(1))
              .join(':')
          : cluster.map(() => '1.0').join(':');

      const complexId = `cmplx__${complexCounter++}`;
      allComplexes.push({
        id: complexId,
        condition,
        members: cluster.map(mIdx => prepared[mIdx].profile.gene),
        peak: consensusPeak,
        rf: rfScore,
        mw: hasAllMw ? Math.round(mwSum * 10) / 10 : null,
        stoich
      });

      // Emit pairwise PPIs for complex members
      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          addPpi(cluster[i], cluster[j], complexId);
        }
      }
    }

    // Also include direct high-confidence PPI edges for proteins not linked via the same complex
    // (capped at top 6 partners per protein so the PPI network stays crisp and informative)
    const directPpiCounts = new Map<number, number>();
    for (const edge of seedEdges) {
      const ca = directPpiCounts.get(edge.a) || 0;
      const cb = directPpiCounts.get(edge.b) || 0;
      if (ca >= 6 && cb >= 6) continue;

      const lo = Math.min(edge.a, edge.b);
      const hi = Math.max(edge.a, edge.b);
      if (!pairLinkedSet.has(`${lo}_${hi}`)) {
        addPpi(lo, hi, `coelute_F${prepared[lo].apexFraction}`);
        directPpiCounts.set(edge.a, ca + 1);
        directPpiCounts.set(edge.b, cb + 1);
      }
    }
  });

  // Sort complexes: multi-subunit & highest confidence first
  allComplexes.sort((a, b) => {
    const scoreA = a.rf + Math.min(0.15, (a.members.length - 2) * 0.02);
    const scoreB = b.rf + Math.min(0.15, (b.members.length - 2) * 0.02);
    return scoreB - scoreA;
  });

  const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);

  return {
    complexes: allComplexes,
    ppis: allPpis,
    stats: {
      eligibleProteins: totalEligible,
      complexCount: allComplexes.length,
      ppiCount: allPpis.length,
      elapsedMs
    }
  };
}

/**
 * Parses an externally generated PCprophet output file:
 * - JSON: pcprophet_complexes.json or pcprophet_ppis.json
 * - TSV/CSV: PCprophet CombineReport.txt / ComplexReport.txt (e.g. ID, Members, Peak, RF/Score, Condition, Stoich)
 *            or pairwise PPI table (GeneA/ProteinA, GeneB/ProteinB, ComplexID)
 */
export async function parsePCprophetFile(
  fileOrText: File | string,
  fileName: string = 'pcprophet.json',
  defaultCondition: string = 'Default'
): Promise<{ complexes: PCprophetComplex[]; ppis: PCprophetPPI[] }> {
  const text =
    typeof fileOrText === 'string'
      ? fileOrText
      : await fileOrText.text();

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('PCprophet file is empty.');
  }

  // Case 1: JSON array (pcprophet_complexes.json or pcprophet_ppis.json)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (arr.length === 0) throw new Error('JSON file contains no entries.');

    const first = arr[0];
    if (Array.isArray(first.members)) {
      const complexes: PCprophetComplex[] = arr.map((c: any, idx: number) => ({
        id: String(c.id || `cmplx__${idx + 1}`),
        condition: String(c.condition || defaultCondition),
        members: c.members.map((m: any) => String(m).trim()).filter(Boolean),
        peak: c.peak !== undefined && c.peak !== null ? Number(c.peak) : null,
        rf: c.rf !== undefined ? Number(c.rf) : 0.8,
        mw: c.mw !== undefined && c.mw !== null ? Number(c.mw) : null,
        stoich: c.stoich ? String(c.stoich) : undefined
      }));
      const ppis: PCprophetPPI[] = [];
      for (const c of complexes) {
        for (let i = 0; i < c.members.length; i++) {
          for (let j = i + 1; j < c.members.length; j++) {
            ppis.push({
              condition: c.condition,
              geneA: c.members[i],
              geneB: c.members[j],
              complex_id: c.id
            });
          }
        }
      }
      return { complexes, ppis };
    }

    if (first.geneA && first.geneB) {
      const ppis: PCprophetPPI[] = arr.map((p: any) => ({
        condition: String(p.condition || defaultCondition),
        geneA: String(p.geneA).trim(),
        geneB: String(p.geneB).trim(),
        complex_id: String(p.complex_id || 'ppi')
      }));
      return { complexes: [], ppis };
    }
  }

  // Case 2: Delimited TSV/CSV (PCprophet CombineReport.txt, ComplexReport.txt, or PPI table)
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(trimmed, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        try {
          const rows = res.data || [];
          if (rows.length === 0) {
            return reject(new Error(`No rows found in ${fileName}.`));
          }
          const cols = Object.keys(rows[0] || {});
          const findCol = (re: RegExp) => cols.find(c => re.test(c.trim())) || '';

          const membersCol = findCol(/^(?:members|subunits|proteins|genes|cmplx_members|complex_members)$/i);
          const idCol = findCol(/^(?:id|complex_?id|cmplx_?id|name|complex)$/i);
          const condCol = findCol(/^(?:condition|sample|timepoint|group|cond)$/i);
          const rfCol = findCol(/^(?:rf|rf_?prob\w*|prob\w*|score|pos|confidence)$/i);
          const peakCol = findCol(/^(?:peak|apex|apex_?fraction|fraction|ft|elution_?peak)$/i);
          const mwCol = findCol(/^(?:mw|molecular_?weight\w*|mw_?kda)$/i);
          const stoichCol = findCol(/^(?:stoich\w*)$/i);

          if (membersCol) {
            const complexes: PCprophetComplex[] = [];
            const ppis: PCprophetPPI[] = [];

            rows.forEach((row, idx) => {
              const rawMembers = (row[membersCol] || '').trim();
              if (!rawMembers) return;
              const members = rawMembers
                .split(/[;#,\s]+/)
                .map(s => s.trim())
                .filter(Boolean);
              if (members.length === 0) return;

              const id = (idCol && row[idCol]?.trim()) || `cmplx__${idx + 1}`;
              const condition = (condCol && row[condCol]?.trim()) || defaultCondition;
              const rfVal = rfCol && row[rfCol] ? parseFloat(row[rfCol]) : 0.85;
              const peakVal = peakCol && row[peakCol] ? parseFloat(row[peakCol]) : NaN;
              const mwVal = mwCol && row[mwCol] ? parseFloat(row[mwCol]) : NaN;
              const stoich = stoichCol && row[stoichCol] ? row[stoichCol].trim() : undefined;

              complexes.push({
                id,
                condition,
                members,
                peak: !isNaN(peakVal) ? Math.round(peakVal) : null,
                rf: !isNaN(rfVal) ? Math.max(0, Math.min(1, rfVal)) : 0.85,
                mw: !isNaN(mwVal) ? mwVal : null,
                stoich
              });

              for (let i = 0; i < members.length; i++) {
                for (let j = i + 1; j < members.length; j++) {
                  ppis.push({ condition, geneA: members[i], geneB: members[j], complex_id: id });
                }
              }
            });

            if (complexes.length === 0) {
              return reject(new Error('Could not parse any complexes from this file.'));
            }
            return resolve({ complexes, ppis });
          }

          // Check for pairwise PPI table (GeneA / GeneB)
          const geneACol = findCol(/^(?:gene_?a|protein_?a|interactor_?a|source|from|node1|protein1)$/i);
          const geneBCol = findCol(/^(?:gene_?b|protein_?b|interactor_?b|target|to|node2|protein2)$/i);
          if (geneACol && geneBCol) {
            const ppis: PCprophetPPI[] = [];
            rows.forEach((row, idx) => {
              const a = (row[geneACol] || '').trim();
              const b = (row[geneBCol] || '').trim();
              if (!a || !b) return;
              ppis.push({
                condition: (condCol && row[condCol]?.trim()) || defaultCondition,
                geneA: a,
                geneB: b,
                complex_id: (idCol && row[idCol]?.trim()) || `ppi_${idx + 1}`
              });
            });
            return resolve({ complexes: [], ppis });
          }

          reject(
            new Error(
              'Unrecognized PCprophet file format. Expected JSON (pcprophet_complexes.json / pcprophet_ppis.json) or TSV/CSV with Members (or GeneA/GeneB) columns.'
            )
          );
        } catch (err) {
          reject(err);
        }
      },
      error: (err: Error) => reject(err)
    });
  });
}
