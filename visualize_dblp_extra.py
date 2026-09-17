import re
from collections import Counter

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

sns.set_theme(style="whitegrid")

CSV_PATH = "dblp_after_2018.csv"  # change if your file is named differently

df = pd.read_csv(CSV_PATH)
df['year'] = pd.to_numeric(df['year'], errors='coerce')

# Trim to a complete year range: drops the tail end (2026+), which is
# undercounted because DBLP is still actively indexing those years.
df = df[(df['year'] >= 2019) & (df['year'] <= 2025)]


# ---------- 6. Author productivity distribution ----------
all_authors = []
for authors_str in df['authors'].dropna():
    all_authors.extend(a.strip() for a in authors_str.split(';') if a.strip())

paper_counts_per_author = pd.Series(Counter(all_authors))

# Bucket into readable groups since raw counts are extremely long-tailed
bins = [0, 1, 2, 3, 5, 10, 20, paper_counts_per_author.max()]
labels = ["1", "2", "3", "4-5", "6-10", "11-20", "20+"]
bucketed = pd.cut(paper_counts_per_author, bins=bins, labels=labels, include_lowest=True)
bucket_counts = bucketed.value_counts().reindex(labels)

plt.figure(figsize=(9, 5))
plt.bar(bucket_counts.index.astype(str), bucket_counts.values)
plt.yscale('log')
plt.title("Author Productivity Distribution (log scale)")
plt.xlabel("Papers published (in this sample)")
plt.ylabel("Number of authors (log scale)")
plt.tight_layout()
plt.savefig("chart_6_author_productivity.png", dpi=150)
plt.close()
print("Saved chart_6_author_productivity.png")
print(f"Total distinct authors: {len(paper_counts_per_author)}")
print(f"Authors with exactly 1 paper: {(paper_counts_per_author == 1).sum()} "
      f"({(paper_counts_per_author == 1).mean() * 100:.1f}%)\n")


# ---------- 7. Average team size over time ----------
df['n_authors'] = df['authors'].dropna().apply(
    lambda s: len([a for a in s.split(';') if a.strip()])
)
team_size_by_year = df.groupby('year')['n_authors'].mean().dropna()
team_size_by_year = team_size_by_year[team_size_by_year.index >= 1970]  # trim sparse early years

plt.figure(figsize=(10, 5))
plt.plot(team_size_by_year.index, team_size_by_year.values, marker='o', linewidth=1.5)
plt.title("Average Number of Authors per Paper, by Year")
plt.xlabel("Year")
plt.ylabel("Average authors per paper")
plt.tight_layout()
plt.savefig("chart_7_avg_team_size_over_time.png", dpi=150)
plt.close()
print("Saved chart_7_avg_team_size_over_time.png")


# ---------- 8. Distinct venues per year ----------
def extract_venue(key):
    if not isinstance(key, str):
        return None
    parts = key.split('/')
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    return None

df['venue'] = df['key'].apply(extract_venue)
venues_by_year = df.groupby('year')['venue'].nunique().dropna()
venues_by_year = venues_by_year[venues_by_year.index >= 1970]

plt.figure(figsize=(10, 5))
plt.plot(venues_by_year.index, venues_by_year.values, marker='o', linewidth=1.5, color='darkorange')
plt.title("Number of Distinct Venues per Year (in this sample)")
plt.xlabel("Year")
plt.ylabel("Distinct venues")
plt.tight_layout()
plt.savefig("chart_8_distinct_venues_per_year.png", dpi=150)
plt.close()
print("Saved chart_8_distinct_venues_per_year.png")


# ---------- 9. Most common words in titles ----------
STOPWORDS = set("""
a an the of for on in to and with using towards from by via approach based
study analysis review survey new novel systems system model models method
methods framework case a1 an1 into over under between across
""".split())

word_counter = Counter()
for title in df['title'].dropna():
    words = re.findall(r"[a-zA-Z']+", title.lower())
    for w in words:
        if len(w) > 2 and w not in STOPWORDS:
            word_counter[w] += 1

top_words = word_counter.most_common(20)
words, counts = zip(*top_words) if top_words else ([], [])

plt.figure(figsize=(9, 7))
plt.barh(words[::-1], counts[::-1], color='seagreen')
plt.title("Top 20 Most Common Words in Paper Titles")
plt.xlabel("Occurrences")
plt.tight_layout()
plt.savefig("chart_9_common_title_words.png", dpi=150)
plt.close()
print("Saved chart_9_common_title_words.png")

print("\nAll additional charts saved. Done.")
