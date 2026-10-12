"""
GDPR De-Anonymization Utility
Restore original Gene symbols, UniProt accessions, and Descriptions from an anonymized matrix
using your private local anonymization_key.csv.
"""
import sys
import os
import pandas as pd

def deanonymize(input_csv: str, output_csv: str, key_csv: str = 'anonymization_key.csv'):
    if not os.path.exists(key_csv):
        print(f"Error: Anonymization key '{key_csv}' not found. Keep this file confidential.")
        sys.exit(1)

    key_df = pd.read_csv(key_csv)
    gene_map = dict(zip(key_df['Anonymized_Gene'], key_df['Original_Gene']))
    uniprot_map = dict(zip(key_df['Anonymized_UniProt'], key_df['Original_UniProt']))
    desc_map = dict(zip(key_df['Anonymized_Description'], key_df['Original_Description']))

    df = pd.read_csv(input_csv)
    if 'Gene' in df.columns:
        df['Gene'] = df['Gene'].map(lambda g: gene_map.get(str(g), g))
    if 'UniProt' in df.columns:
        df['UniProt'] = df['UniProt'].map(lambda u: uniprot_map.get(str(u), u))
    if 'Complex' in df.columns:
        df['Complex'] = df['Complex'].map(lambda d: desc_map.get(str(d), d))

    df.to_csv(output_csv, index=False)
    print(f"Successfully restored {len(df)} rows from '{input_csv}' -> '{output_csv}'.")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python deanonymize.py <input_anonymized.csv> <output_restored.csv> [key.csv]")
        print("Example: python deanonymize.py report_pg_matrix_combined_app.csv restored_matrix.csv")
    else:
        k = sys.argv[3] if len(sys.argv) > 3 else 'anonymization_key.csv'
        deanonymize(sys.argv[1], sys.argv[2], k)
