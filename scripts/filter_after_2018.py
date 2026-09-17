import os

import pandas as pd

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_CSV = os.path.join(REPO_ROOT, "data", "processed", "dblp_sample.csv")      # change to whichever file you want to filter
OUTPUT_CSV = os.path.join(REPO_ROOT, "data", "processed", "dblp_after_2018.csv")

df = pd.read_csv(INPUT_CSV)
df['year'] = pd.to_numeric(df['year'], errors='coerce')

filtered = df[df['year'] > 2018]

filtered.to_csv(OUTPUT_CSV, index=False)
print(f"Original rows: {len(df)}")
print(f"Rows after 2018: {len(filtered)}")
print(f"Saved to '{OUTPUT_CSV}'")
