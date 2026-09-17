import pandas as pd
import networkx as nx
import matplotlib.pyplot as plt
from itertools import combinations
from collections import Counter

CSV_PATH = "dblp_after_2018.csv"
TOP_N_AUTHORS = 300  # restrict the network to the most prolific authors to keep it tractable

df = pd.read_csv(CSV_PATH)
df['year'] = pd.to_numeric(df['year'], errors='coerce')
df = df[(df['year'] >= 2019) & (df['year'] <= 2025)]

df['author_list'] = df['authors'].fillna("").apply(
    lambda s: [a.strip() for a in s.split(';') if a.strip()]
)

# Find the most prolific authors first -- the full graph (hundreds of
# thousands of authors) is too large to compute centrality/communities on
# in reasonable time, so we restrict to a tractable "who matters most" subset.
all_authors = Counter()
for lst in df['author_list']:
    all_authors.update(lst)

top_authors = set(a for a, _ in all_authors.most_common(TOP_N_AUTHORS))
print(f"Restricting network to the {TOP_N_AUTHORS} most prolific authors "
      f"(out of {len(all_authors)} distinct authors total).")

# Build the graph: an edge between two authors, weighted by how many
# papers they co-authored together (within the top-N set).
G = nx.Graph()
G.add_nodes_from(top_authors)

edge_weights = Counter()
for lst in df['author_list']:
    filtered = sorted(set(a for a in lst if a in top_authors))
    if len(filtered) < 2:
        continue
    for a, b in combinations(filtered, 2):
        edge_weights[(a, b)] += 1

for (a, b), w in edge_weights.items():
    G.add_edge(a, b, weight=w)

print(f"Network built: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges\n")

# ---------- Centrality measures ----------
degree_centrality = nx.degree_centrality(G)
betweenness_centrality = nx.betweenness_centrality(G, weight='weight', normalized=True)

top_degree = sorted(degree_centrality.items(), key=lambda x: -x[1])[:15]
top_betweenness = sorted(betweenness_centrality.items(), key=lambda x: -x[1])[:15]

print("Top 15 by DEGREE centrality (most directly connected -- broadest collaborator network):")
for name, val in top_degree:
    print(f"  {name}: {val:.4f}")

print("\nTop 15 by BETWEENNESS centrality (bridges between different research groups):")
for name, val in top_betweenness:
    print(f"  {name}: {val:.4f}")

# ---------- Community detection ----------
communities = list(nx.community.greedy_modularity_communities(G, weight='weight'))
print(f"\nDetected {len(communities)} communities (clusters of frequent collaborators)")
for i, comm in enumerate(communities[:10]):
    sample = ', '.join(list(comm)[:5])
    print(f"  Community {i + 1} ({len(comm)} authors): {sample}...")

community_map = {}
for i, comm in enumerate(communities):
    for node in comm:
        community_map[node] = i

# ---------- Visualization ----------
plt.figure(figsize=(14, 14))
pos = nx.spring_layout(G, k=0.3, seed=42, weight='weight')

node_colors = [community_map.get(n, -1) for n in G.nodes()]
node_sizes = [degree_centrality[n] * 3000 + 20 for n in G.nodes()]

nx.draw_networkx_nodes(G, pos, node_size=node_sizes, node_color=node_colors,
                        cmap=plt.cm.tab20, alpha=0.85)
nx.draw_networkx_edges(G, pos, alpha=0.15)

# Label only the most central authors to keep the plot readable
top_labels = {n: n for n, _ in top_degree[:20]}
nx.draw_networkx_labels(G, pos, labels=top_labels, font_size=8)

plt.title(f"Co-authorship Network -- Top {TOP_N_AUTHORS} Authors, "
          f"{len(communities)} Detected Communities")
plt.axis('off')
plt.tight_layout()
plt.savefig("chart_10_coauthorship_network.png", dpi=150)
plt.close()
print("\nSaved chart_10_coauthorship_network.png")
