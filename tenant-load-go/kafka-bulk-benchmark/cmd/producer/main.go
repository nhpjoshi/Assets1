package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"

	"kafka-bulk-benchmark/internal/config"
	"kafka-bulk-benchmark/internal/generator"
)

func main() {
	log.Println("🚀 Go Kafka Producer starting")

	// ---- tenants ----
	tenants := strings.Split(os.Getenv("TENANTS"), ",")
	if len(tenants) == 0 {
		log.Fatal("TENANTS env not set")
	}

	// ---- topics ----
	topics := []string{
		"customers",
		"inventory",
		"orders",
		"payments",
		"shipments",
	}

	// ---- writers per topic ----
	writers := map[string]*kafka.Writer{}
	for _, topic := range topics {
		writers[topic] = kafka.NewWriter(kafka.WriterConfig{
			Brokers:      config.Brokers(),
			Topic:        topic,
			Balancer:     &kafka.Hash{},
			BatchSize:    1,
			BatchTimeout: 10 * time.Millisecond,
			RequiredAcks: 1,
		})
		defer writers[topic].Close()
	}

	ticker := time.NewTicker(config.Interval())
	defer ticker.Stop()

	var seq int
	var count int64

	for range ticker.C {
		tenant := tenants[seq%len(tenants)]
		seq++

		// ---- Customer ----
		customer := generator.Customer(tenant, seq)
		produce(writers["customers"], tenant, customer)

		// ---- Inventory ----
		inv := generator.Inventory(tenant, seq)
		produce(writers["inventory"], tenant, inv)

		// ---- Order ----
		order := generator.Order(tenant, seq)
		produce(writers["orders"], tenant, order)

		// ---- Payment (linked to order) ----
		payment := generator.Payment(tenant, order.OrderId, order.TotalAmount)
		produce(writers["payments"], tenant, payment)

		// ---- Shipment (linked to order) ----
		shipment := generator.Shipment(tenant, order.OrderId)
		produce(writers["shipments"], tenant, shipment)

		count += 5
		log.Printf("📨 produced %d messages (tenant=%s)\n", count, tenant)
	}
}

// ---- helper ----
func produce(writer *kafka.Writer, tenant string, doc interface{}) {
	b, err := json.Marshal(doc)
	if err != nil {
		log.Println("❌ marshal failed:", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(tenant),
		Value: b,
	}); err != nil {
		log.Println("❌ kafka write failed:", err)
	}
}
