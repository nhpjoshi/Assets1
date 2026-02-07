module.exports = {
  apps: [
    {
      name: "kafka-producer",
      script: "./producer",
      env: {
        TENANTS: "T1001,T1002,T1003",
        INGEST_INTERVAL: "2ms",
        KAFKA_BROKERS: "localhost:9092",
        KAFKA_TOPIC: "test"
      }
    },
    {
      name: "kafka-bulk-consumer",
      script: "./consumer",
      env: {
        KAFKA_BROKERS: "localhost:9092",
        KAFKA_TOPIC: "events",
        MONGO_URI: "mongodb+srv://admin:admin@cluster1.n2msm.mongodb.net/?appName=Cluster1",
        BATCH_SIZE: "1000"
      }
    }
  ]
};
