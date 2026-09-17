import os

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

sns.set_theme(style="whitegrid")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO_ROOT, "data", "processed", "dblp_after_2018.csv")
CHARTS_DIR = os.path.join(REPO_ROOT, "charts")
os.makedirs(CHARTS_DIR, exist_ok=True)

# Edit this list to whatever topics you want to track
KEYWORDS = ["neural", "transformer", "blockchain", "quantum",
            "privacy", "robot", "graph", "large language"]

df = pd.read_csv(CSV_PATH)
df['year'] = pd.to_numeric(df['year'], errors='coerce')
df = df[(df['year'] >= 2019) & (df['year'] <= 2025)]

df['title_lower'] = df['title'].fillna("").str.lower()
papers_per_year = df.groupby('year').size()

plt.figure(figsize=(11, 6))
for kw in KEYWORDS:
    pattern = r'\b' + kw.replace(' ', r'\s+') + r'\b'
    matches = df[df['title_lower'].str.contains(pattern, regex=True, na=False)]
    counts_per_year = matches.groupby('year').size()

    # Normalize by total papers that year -> % of titles mentioning the keyword.
    # This matters because raw counts would just track overall dataset growth,
    # not whether the TOPIC itself is becoming more or less prominent.
    pct_per_year = (counts_per_year / papers_per_year * 100).reindex(
        sorted(papers_per_year.index)
    ).fillna(0)

    plt.plot(pct_per_year.index, pct_per_year.values, marker='o', label=kw)
    print(f"'{kw}': {pct_per_year.iloc[0]:.2f}% -> {pct_per_year.iloc[-1]:.2f}% "
          f"({pct_per_year.index[0]:.0f} to {pct_per_year.index[-1]:.0f})")

plt.title("Keyword Prevalence in Paper Titles Over Time")
plt.xlabel("Year")
plt.ylabel("% of papers with keyword in title")
plt.legend()
plt.tight_layout()
plt.savefig(os.path.join(CHARTS_DIR, "chart_11_topic_trends.png"), dpi=150)
plt.close()
print("\nSaved chart_11_topic_trends.png")
