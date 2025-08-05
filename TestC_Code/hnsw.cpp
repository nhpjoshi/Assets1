#include <iostream>
#include <vector>
#include <cmath>
#include <limits>
#include <map>
#include <iomanip>
#include <fstream>

using namespace std;

// ---------- Cosine Similarity Function ----------
float cosineSimilarity(const vector<float> &a, const vector<float> &b)
{
    float dot = 0.0, normA = 0.0, normB = 0.0;
    for (size_t i = 0; i < a.size(); ++i)
    {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (sqrt(normA) * sqrt(normB));
}

// ---------- Node Structure ----------
struct Node
{
    int id;
    vector<float> embedding; // 🟢 Renamed from `vector`
    map<int, vector<int>> neighbors;
};

// ---------- HNSW Class ----------
class HNSW
{
    vector<Node> nodes;
    int maxLevel;
    int ef;

public:
    HNSW(int maxLevel = 2, int ef = 2) : maxLevel(maxLevel), ef(ef) {}

    void addNode(const vector<float> &vec)
    {
        int id = nodes.size();
        Node node = {id, vec, {}};
        int level = rand() % (maxLevel + 1);

        cout << "\n🔷 Inserting Node " << id << " [";
        for (auto v : vec)
            cout << fixed << setprecision(2) << v << " ";
        cout << "] at level " << level << "\n";

        if (!nodes.empty())
        {
            for (int l = maxLevel; l >= 0; --l)
            {
                int bestId = searchAtLayer(vec, l);
                if (bestId != -1)
                {
                    node.neighbors[l].push_back(bestId);
                    nodes[bestId].neighbors[l].push_back(id);

                    cout << "  ↳ Connected at level " << l
                         << " with Node " << bestId
                         << " (Similarity: "
                         << fixed << setprecision(3)
                         << cosineSimilarity(vec, nodes[bestId].embedding) << ")\n";
                }
            }
        }

        nodes.push_back(node);
    }

    int searchAtLayer(const vector<float> &query, int level)
    {
        float bestSim = -1.0;
        int bestId = -1;
        for (const auto &node : nodes)
        {
            if (node.neighbors.count(level))
            {
                float sim = cosineSimilarity(query, node.embedding);
                if (sim > bestSim)
                {
                    bestSim = sim;
                    bestId = node.id;
                }
            }
        }
        return bestId;
    }

    int search(const vector<float> &query)
    {
        int current = 0;
        float currentSim = cosineSimilarity(query, nodes[current].embedding);

        cout << "\n🔍 Starting search from Node " << current << " [";
        for (auto v : nodes[current].embedding)
            cout << fixed << setprecision(2) << v << " ";
        cout << "] → Similarity: " << fixed << setprecision(3) << currentSim << "\n";

        for (int l = maxLevel; l >= 0; --l)
        {
            cout << "\n⬇️  Level " << l << ": Navigating...\n";
            bool improved = true;
            while (improved)
            {
                improved = false;
                for (int neighborId : nodes[current].neighbors[l])
                {
                    float sim = cosineSimilarity(query, nodes[neighborId].embedding);
                    cout << "    Comparing with Node " << neighborId
                         << " → Similarity: " << fixed << setprecision(3) << sim;

                    if (sim > currentSim)
                    {
                        cout << " ✅ Better! Moving to Node " << neighborId << "\n";
                        current = neighborId;
                        currentSim = sim;
                        improved = true;
                        break;
                    }
                    else
                    {
                        cout << " ❌ Not better.\n";
                    }
                }
            }
        }

        cout << "\n✅ Final Result → Best match: Node " << current
             << " with Similarity: " << fixed << setprecision(4) << currentSim << "\n";

        return current;
    }

    void generateDot(const string &filename)
    {
        ofstream out(filename);
        out << "digraph HNSW {\n";
        out << "  rankdir=LR;\n";
        out << "  node [shape=circle, style=filled, fillcolor=lightyellow];\n";

        for (int l = maxLevel; l >= 0; --l)
        {
            out << "  subgraph cluster_" << l << " {\n";
            out << "    label=\"Level " << l << "\";\n";
            out << "    style=dashed;\n";
            for (const auto &node : nodes)
            {
                if (node.neighbors.count(l))
                {
                    out << "    n" << node.id << " [label=\""
                        << node.id << "\"];\n";
                }
            }
            out << "  }\n";
        }

        for (const auto &node : nodes)
        {
            for (const auto &[level, neighbors] : node.neighbors)
            {
                for (int nId : neighbors)
                {
                    string color = (level == 2 ? "red" : level == 1 ? "blue"
                                                                    : "black");
                    out << "  n" << node.id << " -> n" << nId
                        << " [label=\"L" << level << "\", color=" << color << "];\n";
                }
            }
        }

        out << "}\n";
        out.close();
        cout << "📦 Graphviz DOT file generated: " << filename << endl;
    }
};

// ---------- Main ----------
int main()
{
    srand(time(NULL));
    HNSW hnsw;

    vector<vector<float>> data = {
        {1, 0}, {0.5, 0.5}, {0, 1}, {-1, 0}, {0.6, 0.8}};

    for (const auto &vec : data)
    {
        hnsw.addNode(vec);
    }

    vector<float> query = {0.7f, 0.7f};
    hnsw.search(query);
    hnsw.generateDot("hnsw_graph.dot");

    return 0;
}
