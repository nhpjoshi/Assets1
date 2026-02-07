#!/bin/bash
set -e

echo "🚀 Creating Kafka Bulk Benchmark project..."

# ---- folders ----
mkdir -p cmd/producer
mkdir -p cmd/consumer
mkdir -p internal/config
mkdir -p internal/model
mkdir -p internal/random

# ---- go.mod ----
cat <<EOF > go.mod
module kafka-bulk-benchmark

go 1.21

require (
	github.com/segmentio/kafka-go v0.4.47
	go.mongodb.org/mongo-driver v1.14.0
)
EOF

# ---- config ----
cat <<EOF > internal/config/config.go
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

func Tenants() []string {
	return strings.Split(os.Getenv("TENANTS"), ",")
}

func KafkaBrokers() []string {
	return strings.Split(os.Getenv("KAFKA_BROKERS"), ",")
}

func Topic() string {
	return os.Getenv("KAFKA_TOPIC")
}

func MongoURI() string {
	return os.Getenv("MONGO_URI")
}

func BatchSize() int {
	v, _ := strconv.Atoi(os.Getenv("BATCH_SIZE"))
	if v == 0 {
		return 1000
	}
	return v
}

func Interval() time.Duration {
	d, err := time.ParseDuration(os.Getenv("INGEST_INTERVAL"))
	if err != nil {
		return time.Second
	}
	return d
}
EOF

# ---- model ----
cat <<EOF > internal/model/event.go
package model

import "time"

type Event struct {
	TenantId string    \`json:"tenantId" bson:"tenantId"\`
	EventId  string    \`json:"eventId" bson:"eventId"\`
	Type     string    \`json:"type" bson:"type"\`
	Payload  string    \`json:"payload" bson:"payload"\`
	Created  time.Time \`json:"createdAt" bson:"createdAt"\`
}
EOF

# ---- random generator ----
cat <<EOF > internal/random/generator.go
package random

import (
	"fmt"
	"math/rand"
	"time"

	"kafka-bulk-benchmark/internal/model"
)

var types = []string{"orders", "payments", "shipments"}

func Event(tenant string) model.Event {
	return model.Event{
		TenantId: tenant,
		EventId:  fmt.Sprintf("%s-%d", tenant, time.Now().UnixNano()),
		Type:     types[rand.Intn(len(types))],
		Payload:  randString(64),
		Created:  time.Now(),
	}
}

func randString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}
EOF

# ---- producer ----
cat <<EOF > cmd/producer/main.go
package main

import (
	"context"
	"encoding/json"
	"time"

	"github.com/segmentio/kafka-go"

	"kafka-bulk-benchmark/internal/config"
	"kafka-bulk-benchmark/internal/random"
)

func main() {
	writer := kafka.NewWriter(kafka.WriterConfig{
		Brokers:  config.KafkaBrokers(),
		Topic:    config.Topic(),
		Balancer: &kafka.Hash{},
	})
	defer writer.Close()

	ticker := time.NewTicker(config.Interval())
	defer ticker.Stop()

	for _, tenant := range config.Tenants() {
		go func(t string) {
			for range ticker.C {
				ev := random.Event(t)
				b, _ := json.Marshal(ev)

				_ = writer.WriteMessages(context.Background(), kafka.Message{
					Key:   []byte(t),
					Value: b,
				})
			}
		}(tenant)
	}

	select {}
}
EOF

# ---- consumer ----
cat <<EOF > cmd/consumer/main.go
package main

import (
	"context"
	"encoding/json"
	"time"

	"github.com/segmentio/kafka-go"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"kafka-bulk-benchmark/internal/config"
)

func main() {
	ctx := context.Background()

	client, err := mongo.Connect(
		ctx,
		options.Client().
			ApplyURI(config.MongoURI()).
			SetMaxPoolSize(300),
	)
	if err != nil {
		panic(err)
	}
	defer client.Disconnect(ctx)

	db := client.Database("benchdb")

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  config.KafkaBrokers(),
		Topic:    config.Topic(),
		GroupID:  "bulk-writer-" + config.Topic(),
		MinBytes: 1e6,
		MaxBytes: 10e6,
	})
	defer reader.Close()

	buffers := map[string][]interface{}{}
	lastFlush := time.Now()

	for {
		msg, err := reader.ReadMessage(ctx)
		if err != nil {
			panic(err)
		}

		var doc bson.M
		if err := json.Unmarshal(msg.Value, &doc); err != nil {
			continue
		}

		tenant := doc["tenantId"].(string)
		buffers[tenant] = append(buffers[tenant], doc)

		if len(buffers[tenant]) >= config.BatchSize() {
			flush(db, tenant, buffers[tenant])
			buffers[tenant] = nil
		}

		if time.Since(lastFlush) >= 2*time.Second {
			for t, docs := range buffers {
				if len(docs) > 0 {
					flush(db, t, docs)
					buffers[t] = nil
				}
			}
			lastFlush = time.Now()
		}
	}
}

func flush(db *mongo.Database, tenant string, docs []interface{}) {
	coll := db.Collection(tenant + "_events")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, _ = coll.InsertMany(
		ctx,
		docs,
		options.InsertMany().SetOrdered(false),
	)
}
EOF

# ---- ecosystem ----
cat <<EOF > ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "kafka-producer",
      script: "./producer",
      env: {
        TENANTS: "T1001,T1002,T1003",
        INGEST_INTERVAL: "2ms",
        KAFKA_BROKERS: "localhost:9092",
        KAFKA_TOPIC: "events"
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
EOF

# ---- README ----
cat <<EOF > README.md
Kafka → MongoDB Bulk Insert Benchmark

Build:
  go build -o producer ./cmd/producer
  go build -o consumer ./cmd/consumer

Run with PM2:
  pm2 start ecosystem.config.js
EOF

echo "✅ Project created successfully"
