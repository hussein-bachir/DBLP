import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from collections import Counter

sns.set_theme(style="whitegrid")

CSV_PATH = "dblp_after_2018.csv"

df = pd.read_csv(CSV_PATH)

# Trim to a complete year range: drops the tail end (2026+), which is
# undercounted because DBLP is still actively indexing those years.
df['year'] = pd.to_numeric(df['year'], errors='coerce')
df = df[(df['year'] >= 2019) & (df['year'] <= 2025)]

print("=== Basic dataset overview ===")
print(f"Total records: {len(df)}")
print(f"Columns: {list(df.columns)}")
print(f"Year range: {df['year'].min()} - {df['year'].max()}")
print(f"Missing values per column:\n{df.isna().sum()}\n")


# ---------- 1. Publications per year ----------
year_counts = df['year'].dropna().astype(int).value_counts().sort_index()

plt.figure(figsize=(10, 5))
plt.plot(year_counts.index, year_counts.values, marker='o', linewidth=1.5)
plt.title("Publications per Year (sample)")
plt.xlabel("Year")
plt.ylabel("Number of publications")
plt.tight_layout()
plt.savefig("chart_1_publications_per_year.png", dpi=150)
plt.close()
print("Saved chart_1_publications_per_year.png")


# ---------- 2. Article vs Inproceedings ----------
type_counts = df['type'].value_counts()

plt.figure(figsize=(6, 6))
plt.pie(type_counts.values, labels=type_counts.index, autopct='%1.1f%%', startangle=90)
plt.title("Journal Articles vs Conference Papers")
plt.tight_layout()
plt.savefig("chart_2_type_distribution.png", dpi=150)
plt.close()
print("Saved chart_2_type_distribution.png")
print(f"Type counts:\n{type_counts}\n")


# ---------- 3. Top prolific authors ----------
all_authors = []
for authors_str in df['authors'].dropna():
    all_authors.extend(a.strip() for a in authors_str.split(';') if a.strip())

author_counts = Counter(all_authors)
top_authors = author_counts.most_common(15)
names, counts = zip(*top_authors) if top_authors else ([], [])

plt.figure(figsize=(9, 7))
plt.barh(names[::-1], counts[::-1])
plt.title("Top 15 Most Prolific Authors (in this sample)")
plt.xlabel("Number of papers")
plt.tight_layout()
plt.savefig("chart_3_top_authors.png", dpi=150)
plt.close()
print("Saved chart_3_top_authors.png")


# ---------- 4. Co-author count distribution ----------
coauthor_counts = df['authors'].dropna().apply(
    lambda s: len([a for a in s.split(';') if a.strip()])
)

plt.figure(figsize=(9, 5))
sns.histplot(coauthor_counts, bins=range(1, coauthor_counts.max() + 2), discrete=True)
plt.title("Distribution of Number of Authors per Paper")
plt.xlabel("Number of authors")
plt.ylabel("Number of papers")
plt.tight_layout()
plt.savefig("chart_4_coauthor_distribution.png", dpi=150)
plt.close()
print("Saved chart_4_coauthor_distribution.png")
print(f"Average authors per paper: {coauthor_counts.mean():.2f}")
print(f"Median authors per paper: {coauthor_counts.median()}\n")


# ---------- 5. Top venues (from DBLP key prefix) ----------
# DBLP keys look like 'conf/venue/PaperID' or 'journals/venue/PaperID'
def extract_venue(key):
    if not isinstance(key, str):
        return None
    parts = key.split('/')
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    return None

df['venue'] = df['key'].apply(extract_venue)
venue_counts = df['venue'].value_counts().head(15)

plt.figure(figsize=(9, 7))
plt.barh(venue_counts.index[::-1], venue_counts.values[::-1])
plt.title("Top 15 Venues by Paper Count (in this sample)")
plt.xlabel("Number of papers")
plt.tight_layout()
plt.savefig("chart_5_top_venues.png", dpi=150)
plt.close()
print("Saved chart_5_top_venues.png")

print("\nAll charts saved to the current folder. Done.")
