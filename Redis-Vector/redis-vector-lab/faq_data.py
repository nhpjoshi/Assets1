FAQ_DOCS = [
    {
        "id": "faq:1",
        "question": "Is Redis just a cache or can it be a primary database?",
        "answer": (
            "Redis is commonly used as a cache, but it can also serve as a primary "
            "database for many workloads. It supports persistence, replication, and "
            "high availability."
        ),
        "category": "concepts"
    },
    {
        "id": "faq:2",
        "question": "How do I connect to Redis from Python?",
        "answer": (
            "Use the redis-py client. Example: import redis; "
            "r = redis.Redis(host='localhost', port=6379, decode_responses=True); "
            "r.set('key', 'value')."
        ),
        "category": "client"
    },
    {
        "id": "faq:3",
        "question": "How does Redis store data in memory and still persist it?",
        "answer": (
            "Redis stores data in memory and uses persistence mechanisms like RDB "
            "snapshots and AOF logs to persist data to disk."
        ),
        "category": "persistence"
    },
    {
        "id": "faq:4",
        "question": "What are some common use cases for Redis?",
        "answer": (
            "Common use cases include caching, session storage, real-time analytics, "
            "leaderboards, queues, and vector database applications."
        ),
        "category": "use-cases"
    },
    {
        "id": "faq:5",
        "question": "Can Redis store vectors for semantic search?",
        "answer": (
            "Yes. Redis supports vector fields and vector indices for similarity search."
        ),
        "category": "vectors"
    }
]
