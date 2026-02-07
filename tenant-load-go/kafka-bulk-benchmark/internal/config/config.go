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

func Brokers() []string {
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
