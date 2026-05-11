from redisvl.index import SearchIndex

FAQ_INDEX_SCHEMA = {
    "index": {
        "name": "faq_index",
        "prefix": "faq:"
    },
    "fields": [
        {"name": "question", "type": "text"},
        {"name": "answer", "type": "text"},
        {"name": "category", "type": "tag"},
        {
            "name": "embedding",
            "type": "vector",
            "attrs": {
                "dims": 384,
                "algorithm": "hnsw",
                "distance_metric": "cosine"
            }
        }
    ]
}

def get_faq_index(redis_url: str = "redis://localhost:6380") -> SearchIndex:
    return SearchIndex.from_dict(
        FAQ_INDEX_SCHEMA,
        redis_url=redis_url   
    )