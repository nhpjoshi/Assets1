from sentence_transformers import SentenceTransformer
from faq_index import get_faq_index
import numpy as np
from redisvl.query import VectorQuery

def pretty_print_results(results):
    print("\nTop matches:")
    for i, doc in enumerate(results, start=1):
        print(f"\n[{i}] Question: {doc['question']}")
        print(f" Category: {doc.get('category', 'n/a')}")
        print(f" Answer: {doc['answer']}")

def main():
    index = get_faq_index()
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    while True:
        user_query = input("\nAsk a question (or 'quit'): ").strip()
        if user_query.lower() in ("quit", "exit"):
            break

        q_vec = np.array(
          model.encode([user_query])[0],
          dtype=np.float32
        ).tobytes()

        query = VectorQuery(
            vector=q_vec,
            vector_field_name="embedding",
            num_results=3,
            return_fields=["question", "answer", "category"]
        )
        results = index.query(query)

        pretty_print_results(results)

if __name__ == "__main__":
    main()
