package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ---------- config ----------
func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ---------- models ----------
type Customer struct {
	TenantID   string `bson:"tenantId"`
	CustomerID string `bson:"customerId"`
	Name       string `bson:"name"`
	CreatedAt  time.Time `bson:"createdAt"`
}

type Inventory struct {
	TenantID  string `bson:"tenantId"`
	ProductID string `bson:"productId"`
	SKUID     string `bson:"skuId"`
	Price     float64 `bson:"price"`
	Stock     int `bson:"stock"`
	CreatedAt time.Time `bson:"createdAt"`
}

// ---------- main ----------
func main() {
	tenantsEnv := envOr("TENANTS", "")
	if tenantsEnv == "" {
		log.Fatal("TENANTS env required (e.g. T1001,T1002)")
	}

	mongoURI := envOr(
		"MONGO_URI",
		"mongodb+srv://admin:admin@cluster1.n2msm.mongodb.net/?appName=Cluster1",
	)

	tenants := strings.Split(tenantsEnv, ",")

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		log.Fatalf("mongo connect failed: %v", err)
	}
	defer client.Disconnect(context.Background())

        db := client.Database("orderdb")
	for _, t := range tenants {
		tenant := strings.TrimSpace(t)
		if tenant == "" {
			continue
		}

		log.Printf("Seeding tenant %s", tenant)

		customers := db.Collection(fmt.Sprintf("%s_customers", tenant))
		inventory := db.Collection(fmt.Sprintf("%s_inventory", tenant))

		// ---- customers ----
		var custDocs []interface{}
		for i := 1; i <= 100; i++ {
			custDocs = append(custDocs, Customer{
				TenantID:   tenant,
				CustomerID: fmt.Sprintf("%s-CUST-%03d", tenant, i),
				Name:       fmt.Sprintf("Customer %d", i),
				CreatedAt:  time.Now(),
			})
		}

		if _, err := customers.InsertMany(ctx, custDocs); err != nil {
			log.Fatalf("customer seed failed for %s: %v", tenant, err)
		}

		// ---- inventory ----
		var invDocs []interface{}
		for i := 1; i <= 200; i++ {
			invDocs = append(invDocs, Inventory{
				TenantID:  tenant,
				ProductID: fmt.Sprintf("%s-PROD-%03d", tenant, i),
				SKUID:     fmt.Sprintf("%s-SKU-%03d", tenant, i),
				Price:     100 + float64(i),
				Stock:     1000,
				CreatedAt: time.Now(),
			})
		}

		if _, err := inventory.InsertMany(ctx, invDocs); err != nil {
			log.Fatalf("inventory seed failed for %s: %v", tenant, err)
		}

		// indexes (recommended)
		customers.Indexes().CreateOne(ctx, mongo.IndexModel{
			Keys: bson.M{"tenantId": 1, "customerId": 1},
		})
		inventory.Indexes().CreateOne(ctx, mongo.IndexModel{
			Keys: bson.M{"tenantId": 1, "skuId": 1},
		})

		log.Printf("Tenant %s seeded successfully", tenant)
	}

	log.Println("Seed data insertion completed")
}
