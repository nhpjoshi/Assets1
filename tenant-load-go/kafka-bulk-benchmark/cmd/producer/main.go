package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/segmentio/kafka-go"

	"kafka-bulk-benchmark/internal/config"
	"kafka-bulk-benchmark/internal/random"
)

func main() {
	log.Println("🚀 Go Kafka Producer starting")

writer := kafka.NewWriter(kafka.WriterConfig{
	Brokers:      config.Brokers(),
	Topic:        config.Topic(),
	Balancer:     &kafka.Hash{},
	BatchSize:    1,
	BatchTimeout: 10 * time.Millisecond,
	RequiredAcks: 1, // <-- FIX
})
	defer writer.Close()

	ticker := time.NewTicker(config.Interval())
	defer ticker.Stop()

	var count int64

	for range ticker.C {
		tenant := "T1001" // simple baseline (matches node test)

		doc := random.Document(tenant)
		bytes, err := json.Marshal(doc)
		if err != nil {
			log.Println("❌ marshal failed:", err)
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err = writer.WriteMessages(ctx, kafka.Message{
			Key:   []byte(tenant),
			Value: bytes,
		})
		cancel()

		if err != nil {
			log.Println("❌ kafka write failed:", err)
			time.Sleep(500 * time.Millisecond)
			continue
		}

		count++
		log.Printf("📨 produced message #%d (%d bytes)\n", count, len(bytes))
	}
}
