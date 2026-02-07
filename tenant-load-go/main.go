package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

//
// ----------------------------
// Environment Helpers
// ----------------------------
//

func envOr(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

func parseMapEnv(s string) map[string]string {
	m := map[string]string{}
	if s == "" {
		return m
	}
	pairs := strings.Split(s, ",")
	for _, p := range pairs {
		kv := strings.SplitN(strings.TrimSpace(p), "=", 2)
		if len(kv) == 2 {
			m[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
		}
	}
	return m
}

func usersForTenant(tenant string, usersMap map[string]string) int {
	if val, ok := usersMap[tenant]; ok {
		if n, err := strconv.Atoi(val); err == nil && n > 0 {
			return n
		}
	}
	n, _ := strconv.Atoi(envOr("USERS", "1"))
	if n < 1 {
		return 1
	}
	return n
}

func rateForTenant(tenant string, rateMap map[string]string) string {
	if val, ok := rateMap[tenant]; ok && val != "" {
		return val
	}
	return envOr("RATE", "low")
}

//
// ----------------------------
// Rate & Ingestion Interval
// ----------------------------
//

// Old rate mapping (fallback)
func intervalForRate(rate string) time.Duration {
	switch strings.ToLower(rate) {
	case "high":
		return 10 * time.Second
	case "medium":
		return 30 * time.Second
	default:
		return 60 * time.Second
	}
}

// NEW: explicit ingestion interval override
func ingestIntervalFromEnv() time.Duration {
	v := envOr("INGEST_INTERVAL", "")
	if v == "" {
		return 0
	}

	d, err := time.ParseDuration(v)
	if err != nil {
		log.Fatalf("Invalid INGEST_INTERVAL: %v (use 1s–50s)", err)
	}

	if d < 1*time.Second || d > 50*time.Second {
		log.Fatalf("INGEST_INTERVAL must be between 1s and 50s")
	}

	return d
}

//
// ----------------------------
// Worker Logic
// ----------------------------
//

func tenantWorker(
	ctx context.Context,
	wg *sync.WaitGroup,
	client *MongoClient,
	tenant string,
	users int,
	interval time.Duration,
) {
	defer wg.Done()

	cols := client.GetTenantCollections(tenant)
	log.Printf("[TENANT %s] Starting %d users, ingest interval=%v", tenant, users, interval)

	var userWG sync.WaitGroup
	userWG.Add(users)

	for u := 1; u <= users; u++ {
		go func(uid int) {
			defer userWG.Done()

			for {
				select {
				case <-ctx.Done():
					return
				default:
					// ------------------
					// WRITE workload
					// ------------------
					order, err := CreateOrder(ctx, cols, tenant)
					if err != nil {
						log.Printf("[TENANT %s][user-%d] CreateOrder error: %v", tenant, uid, err)
					} else {
						_ = CreateShipment(ctx, cols, tenant, order.OrderID)
						_ = CreatePayment(ctx, cols, tenant, order.OrderID, order.Total)
						log.Printf(
							"[TENANT %s][user-%d] Order %s | ₹%.2f",
							tenant, uid, order.OrderID, order.Total,
						)
					}

					// ------------------
					// READ workload
					// ------------------
					if err := RunAggregation(ctx, cols, tenant); err != nil {
						log.Printf("[TENANT %s][user-%d] Aggregation error: %v", tenant, uid, err)
					}

					// ------------------
					// INGESTION THROTTLE
					// ------------------
					JitterSleep(ctx, interval)
				}
			}
		}(u)
	}

	userWG.Wait()
	log.Printf("[TENANT %s] All users exited", tenant)
}

//
// ----------------------------
// Main Program
// ----------------------------
//

func main() {
	// TENANTS is required
	tenantsEnv := envOr("TENANTS", "")
	if tenantsEnv == "" {
		log.Fatal("TENANTS env is required, e.g. TENANTS=T1001,T1002")
	}

	var tenants []string
	for _, t := range strings.Split(tenantsEnv, ",") {
		if tt := strings.TrimSpace(t); tt != "" {
			tenants = append(tenants, tt)
		}
	}
	if len(tenants) == 0 {
		log.Fatal("No tenants parsed from TENANTS")
	}

	usersMap := parseMapEnv(envOr("USERS_MAP", ""))
	rateMap := parseMapEnv(envOr("RATE_MAP", ""))

	// NEW ingestion override
	ingestInterval := ingestIntervalFromEnv()

	mongoURI := envOr(
		"MONGO_URI",
		"mongodb+srv://admin:admin@cluster2.n2msm.mongodb.net/?appName=Cluster2",
	)

	// MongoDB connect
	ctxConn, cancelConn := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelConn()

	client, err := NewMongoClient(ctxConn, mongoURI)
	if err != nil {
		log.Fatalf("Mongo connect error: %v", err)
	}
	defer client.Disconnect(context.Background())

	// Seed validation
	for _, tenant := range tenants {
		cols := client.GetTenantCollections(tenant)
		ok, err := EnsureSeedData(ctxConn, cols, tenant)
		if err != nil {
			log.Fatalf("Seed check error for %s: %v", tenant, err)
		}
		if !ok {
			log.Fatalf("Missing seed data for tenant %s", tenant)
		}
	}

	runCtx, stop := context.WithCancel(context.Background())
	var wg sync.WaitGroup

	for _, tenant := range tenants {
		users := usersForTenant(tenant, usersMap)

		interval := ingestInterval
		if interval == 0 {
			rate := rateForTenant(tenant, rateMap)
			interval = intervalForRate(rate)
		}

		wg.Add(1)
		go tenantWorker(runCtx, &wg, client, tenant, users, interval)
	}

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	<-sigCh
	log.Println("Shutdown requested — stopping all tenant workers...")
	stop()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		log.Println("All tenants stopped cleanly")
	case <-time.After(20 * time.Second):
		log.Println("Forced shutdown after timeout")
	}
}
