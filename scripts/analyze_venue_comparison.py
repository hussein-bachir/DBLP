import os

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

sns.set_theme(style="whitegrid")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO_ROOT, "data", "processed", "dblp_after_2018.csv")
CHARTS_DIR = os.path.join(REPO_ROOT, "charts")
os.makedirs(CHARTS_DIR, exist_ok=True)

# Edit this dict to compare whichever venues you want. Keys must match the
# 'namespace/venue' prefix from a DBLP key, e.g. 'conf/cvpr' or 'journals/tvt'.
VENUES = {
    "conf/cvpr": "Computer Vision (CVPR)",
    "conf/acl": "NLP (ACL)",
    "conf/cdc": "Control Theory (CDC)",
    "conf/sigir": "Information Retrieval (SIGIR)",
    "journals/remotesensing": "Remote Sensing (journal)",
}


def extract_venue(key):
    if not isinstance(key, str):
        return None
    parts = key.split('/')
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    return None


df = pd.read_csv(CSV_PATH)
df['year'] = pd.to_numeric(df['year'], errors='coerce')
df = df[(df['year'] >= 2019) & (df['year'] <= 2025)]
df['venue'] = df['key'].apply(extract_venue)

plt.figure(figsize=(11, 6))
for venue_key, label in VENUES.items():
    subset = df[df['venue'] == venue_key]
    counts = subset.groupby('year').size()

    if counts.empty:
        print(f"Warning: no records found for venue '{venue_key}' -- "
              f"skipping (check the key is right, or that venue may not "
              f"be present in your sample).")
        continue

    plt.plot(counts.index, counts.values, marker='o', label=label)
    print(f"{label}: {counts.sum()} papers total, "
          f"{counts.iloc[0]} in {counts.index[0]:.0f} -> "
          f"{counts.iloc[-1]} in {counts.index[-1]:.0f}")

plt.title("Publication Growth by Venue / Subfield")
plt.xlabel("Year")
plt.ylabel("Number of papers")
plt.legend()
plt.tight_layout()
plt.savefig(os.path.join(CHARTS_DIR, "chart_12_venue_comparison.png"), dpi=150)
plt.close()
print("\nSaved chart_12_venue_comparison.png")
