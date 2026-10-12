# SEC-DIA Explorer | PhageMap & PCprophet Studio

Interactive Size Exclusion Chromatography Data-Independent Acquisition (SEC-DIA) analysis suite for proteomic complex discovery, fraction co-elution profiling, and PCprophet validation.

---

## 🚀 Quick Start

To launch the application locally in your browser:
- **Double click**: `run_app.bat`
- **Or run in terminal**:
  ```bash
  npm run dev
  # Then open http://localhost:3000 in your browser
  ```

---

## 🌟 Key Features & Improvements

### 1. Same-Fraction & Co-Eluting Proteins Explorer
- **Instant Protein Search**: Search by Gene name (e.g. `dnaN`, `recF`, `gyrB`), UniProt Accession, or Description.
- **Apex Fraction Detection**: Automatically detects the primary peak elution fraction for each condition.
- **Interactive Fraction Slicing**: Click any fraction on the chromatogram to immediately slice the gradient and inspect all proteins co-eluting in that fraction slice.
- **Co-Elution Scoring**:
  - **Pearson Correlation ($R$)**: Calculates full-gradient elution curve similarity against the query protein.
  - **Dot Product / Cosine Similarity**: Measures shape agreement.
  - **Apex Offset ($\Delta F$)**: Shows exact fraction distance ($\pm 0, \pm 1, \pm 2$).
  - **Visual Trace Overlay**: Toggle checkboxes to instantly overlay candidate elution curves onto the primary chromatogram.

### 2. PCprophet Complexes Hub
- **Complex Browser**: Search and filter 7,829+ complexes by ID (`cmplx__...`), protein subunit, condition, or Random Forest probability score ($RF \ge 0.5 - 0.99$).
- **Subunit Co-Migration Plots**: Visualizes all subunits of a predicted complex simultaneously on a single chromatogram to inspect co-migration and complex integrity.
- **Stoichiometry & Molecular Weights**: Displays subunit counts, stoichiometry ratios, and estimated vs. observed native complex molecular weights.

### 3. Interactors & Protein Interaction Network (PPI)
- **Direct PPI Mapping**: Cross-references 13,382+ PCprophet physical interaction pairs.
- **Interactive Radial Network Graph**: Displays the queried protein at the center surrounded by its direct interacting partners, with edge weight and color scaled by elution profile Pearson correlation.
- **Multi-Interactor Chromatogram Overlay**: Plots all interaction partners simultaneously with the target protein to confirm physical complex assembly.

### 4. Unified & Intelligent Dataset Ingestion
- **Combined Single CSV**: Generates and natively accepts `report_pg_matrix_combined_app.csv` (10,484 rows x 75 columns) containing stacked runs (`60min` and `120min`) distinguished by a clean `Condition` column.
- **Dynamic Fraction Counts**: Fully decoupled from fixed fraction sizes—accepts 24, 48, 70, 96, or arbitrary fraction counts automatically.
- **Multi-File Batch Ingestion**: Drag and drop `report_pg_matrix_60min_app.csv` and `report_pg_matrix_120min_app.csv` together; condition names are automatically inferred from filenames.
- **Multi-Replicate & Plate Intelligence**: Automatically parses metadata columns (`Condition`, `Replicate`, `Plate`) as well as wide prefixed columns (e.g. `60min_Fraction_1` or `Rep1_F01`).
- **Flexible Normalization**: Toggle between **Raw Intensity**, **Peak-Normalized (0 – 1)**, and **Area Percentage (%)**.
- **Publication Exports**: Download high-resolution vector SVGs of any chromatogram, interaction network, or filtered candidate table.

### 5. GDPR De-Identification & Anonymization Engine
- **In-App Anonymization Shield**: Automatically pseudonymizes gene symbols (`PRT_0001`), UniProt accessions (`UP_0001`), and functional annotations (`DESC_0001`) on import or export while preserving all fraction intensities, peak profiles, and PCprophet correlation networks.
- **Confidential Mapping Keys**: The private mapping key (`anonymization_key.csv`) is strictly maintained on your local system and excluded from Git tracking via `.gitignore`.
- **Local De-Anonymization Utility**: Restore original identifiers at any time offline:
  ```bash
  python deanonymize.py report_pg_matrix_combined_app.csv restored_matrix.csv
  ```
