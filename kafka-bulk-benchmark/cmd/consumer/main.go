package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func main() {
	log.Println("🚀 Kafka → Mongo Burst Consumer started")

	brokers := strings.Split(os.Getenv("KAFKA_BROKERS"), ",")
	topics := strings.Split(os.Getenv("TOPICS"), ",")
	group := os.Getenv("KAFKA_GROUP_ID")
	if group == "" {
		group = "mongo-burst-consumer"
	}

	burstSize := getEnvInt("MONGO_BURST_SIZE", 5000)
	maxWait := time.Duration(getEnvInt("MONGO_BURST_MAX_WAIT_MS", 5000)) * time.Millisecond

	mongoURI := os.Getenv("MONGO_URI")
	dbName := os.Getenv("MONGO_DB")
	if dbName == "" {
		dbName = "benchdb"
	}

	client, _ := mongo.Connect(context.Background(),
		options.Client().ApplyURI(mongoURI).SetMaxPoolSize(200))
	db := client.Database(dbName)

	readers := []*kafka.Reader{}
	for _, t := range topics {
		r := kafka.NewReader(kafka.ReaderConfig{
			Brokers: brokers,
			Topic: t,
			GroupID: group + "-" + t,
		})
		readers = append(readers, r)
		defer r.Close()
	}

	buffers := map[string][]interface{}{}
	last := map[string]time.Time{}
	for _, t := range topics {
		buffers[t] = []interface{}{}
		last[t] = time.Now()
	}

	for {
		for _, r := range readers {
			msg, err := r.ReadMessage(context.Background())
			if err != nil {
				continue
			}

			var doc bson.M
			_ = json.Unmarshal(msg.Value, &doc)

			t := msg.Topic
			buffers[t] = append(buffers[t], doc)

			if len(buffers[t]) >= burstSize ||
				time.Since(last[t]) >= maxWait {

				_, err := db.Collection(t).InsertMany(
					context.Background(),
					buffers[t],
					options.InsertMany().SetOrdered(false),
				)

				if err == nil {
					log.Printf("🚀 Burst inserted %d docs into %s\n", len(buffers[t]), t)
				}
				buffers[t] = nil
				last[t] = time.Now()
			}
		}
	}
}

func getEnvInt(k string, d int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return d
}

