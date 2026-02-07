Kafka → MongoDB Bulk Insert Benchmark

Build:
  go build -o producer ./cmd/producer
  go build -o consumer ./cmd/consumer

Run with PM2:
  pm2 start ecosystem.config.js
