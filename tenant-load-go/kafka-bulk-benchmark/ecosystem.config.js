module.exports = {
  apps: [
    {
      name: "kafka-producer",
      script: "./producer",
      env: {
        KAFKA_BROKERS: "localhost:9092",
        TENANTS: "T1001,T1002,T1003,T1004,T1005,T1006,T1007,T1008,T1009,T1010",
        PRODUCE_INTERVAL_MS: "2"
      }
    },
    {
      name: "kafka-burst-consumer",
      script: "./consumer",
      env: {
        KAFKA_BROKERS: "localhost:9092",
        TOPICS: "customers,inventory,orders,payments,shipments",
        KAFKA_GROUP_ID: "mongo-burst-consumer",
        MONGO_URI: "mongodb+srv://admin:admin@cluster1.n2msm.mongodb.net",
        MONGO_DB: "benchdb",
        MONGO_BURST_SIZE: "5000",
        MONGO_BURST_MAX_WAIT_MS: "5000"
      }
    }
  ]
};
