package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/segmentio/kafka-go"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"kafka-bulk-benchmark/internal/config"
)

func main() {
	log.Println("🚀 Go Kafka Bulk Consumer starting")

	// ---- MongoDB ----
	client, err := mongo.Connect(
		context.Background(),
		options.Client().
			ApplyURI(config.MongoURI()).
			SetMaxPoolSize(200),
	)
	if err != nil {
		log.Fatal(err)
	}
	defer client.Disconnect(context.Background())

	db := client.Database("benchdb")

	// ---- Kafka ----
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  config.Brokers(),
		Topic:    config.Topic(),
		GroupID:  "bulk-consumer-" + config.Topic(),
		MinBytes: 1e6,
		MaxBytes: 10e6,
	})
	defer reader.Close()

	buffer := make([]interface{}, 0, config.BatchSize())
	lastFlush := time.Now()

	for {
		msg, err := reader.ReadMessage(context.Background())
		if err != nil {
			// NORMAL in Kafka (rebalance / idle)
			time.Sleep(500 * time.Millisecond)
			continue
		}

		var doc bson.M
		if err := json.Unmarshal(msg.Value, &doc); err != nil {
			continue
		}

		buffer = append(buffer, doc)

		if len(buffer) >= config.BatchSize() ||
			time.Since(lastFlush) >= 2*time.Second {

			if len(buffer) > 0 {
				_, err := db.
					Collection("events").
					InsertMany(
						context.Background(),
						buffer,
						options.InsertMany().SetOrdered(false),
					)
				if err != nil {
					log.Println("❌ mongo bulk insert failed:", err)
				} else {
					log.Printf("✅ inserted batch of %d docs\n", len(buffer))
				}
			}

			buffer = buffer[:0]
			lastFlush = time.Now()
		}
	}
}
