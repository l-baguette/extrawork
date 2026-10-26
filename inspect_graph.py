import json
from pathlib import Path

G = json.loads(Path('graphify-out/graph.json').read_text())
print('Type:', type(G))
if isinstance(G, dict):
    print('Keys:', list(G.keys())[:10])
    if 'nodes' in G:
        print('Nodes count:', len(G['nodes']))
        print('First node:', G['nodes'][0] if G['nodes'] else 'empty')
    if 'edges' in G:
        print('Edges count:', len(G['edges']))
    if 'communities' in G:
        print('Communities:', len(G['communities']))
