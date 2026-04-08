from typing import List
from sentence_transformers import SentenceTransformer
from faq_data import FAQ_DOCS
import numpy as np
from faq_index import get_faq_index

def build_embeddings(texts: List[str]) -> List[list]:
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    vectors = model.encode(texts)
    return vectors.tolist()

def main():
    index = get_faq_index()

    if index.exists():
        index.delete()

    index.create()
    print("Created index:", index.name)

    texts = [f"{doc['question']} {doc['answer']}" for doc in FAQ_DOCS]
    vectors = build_embeddings(texts)

    docs = []
    for doc, vec in zip(FAQ_DOCS, vectors):
        docs.append({
            "id": doc["id"],
            "question": doc["question"],
            "answer": doc["answer"],
            "category": doc["category"],
            "embedding": np.array(vec, dtype=np.float32).tobytes()
        })

    index.load(docs)
    print(f"Ingested {len(docs)} FAQ documents into Redis.")

if __name__ == "__main__":
    main()
