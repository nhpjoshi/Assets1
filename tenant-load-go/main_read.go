// main_read.go
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

// envOr returns env or default
func envOr(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

// parseMapEnv parses "T1001=100,T1002=50" into map
func parseMapEnv(s string) map[string]string {
	m := map[string]string{}
	if s == "" {
		return m
	}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		kv := strings.SplitN(part, "=", 2)
		if len(kv) == 2 {
			m[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
		}
	}
	return m
}

func usersForTenant(tenant string, usersMap map[string]string) int {
	if v, ok := usersMap[tenant]; ok {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	if v := envOr("USERS", "1"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 1
}

func rateForTenant(tenant string, rateMap map[string]string) string {
	if v, ok := rateMap[tenant]; ok && v != "" {
		return v
	}
	return envOr("RATE", "low")
}

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

// readWorker runs only aggregation reads in a loop
func readWorker(ctx context.Context, wg *sync.WaitGroup, client *MongoClient, tenant string, uid int, interval time.Duration) {
	defer wg.Done()
	cols := client.GetTenantCollections(tenant)

	for {
		select {
		case <-ctx.Done():
			return
		default:
			if err := RunAggregation(ctx, cols, tenant); err != nil {
				// keep error logging concise
				log.Printf("[TENANT %s][user-%d] Aggregation error: %v", tenant, uid, err)
			}
			JitterSleep(ctx, interval)
		}
	}
}

// tenantReadRunner starts N read workers for one tenant
func tenantReadRunner(ctx context.Context, wg *sync.WaitGroup, client *MongoClient, tenant string, users int, interval time.Duration) {
	defer wg.Done()
	log.Printf("[TENANT %s] starting %d read users, interval=%v", tenant, users, interval)

	var uWg sync.WaitGroup
	uWg.Add(users)
	for i := 1; i <= users; i++ {
		go readWorker(ctx, &uWg, client, tenant, i, interval)
	}
	uWg.Wait()
	log.Printf("[TENANT %s] all read users exited", tenant)
}

func main() {
	tenantsEnv := envOr("TENANTS", "")
	if tenantsEnv == "" {
		log.Fatal("TENANTS env required, e.g. TENANTS=T1001,T1002")
	}

	tenants := []string{}
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

	mongoURI := envOr("MONGO_URI", "mongodb+srv://admin:admin@cluster2.n2msm.mongodb.net/?appName=Cluster2")

	// connect
	ctxConn, cancelConn := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelConn()

	client, err := NewMongoClient(ctxConn, mongoURI)
	if err != nil {
		log.Fatalf("mongo connect error: %v", err)
	}
	defer client.Disconnect(context.Background())

	// validate seed data for each tenant (orders collection may exist; aggregation uses orders)
	for _, tenant := range tenants {
		cols := client.GetTenantCollections(tenant)
		ok, err := EnsureSeedData(ctxConn, cols, tenant)
		if err != nil {
			log.Fatalf("seed check error for %s: %v", tenant, err)
		}
		if !ok {
			log.Fatalf("Missing customers/inventory for tenant %s. Seed required before read test.", tenant)
		}
	}

	runCtx, runCancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup

	// start tenant read runners
	for _, tenant := range tenants {
		users := usersForTenant(tenant, usersMap)
		rate := rateForTenant(tenant, rateMap)
		interval := intervalForRate(rate)

		wg.Add(1)
		go tenantReadRunner(runCtx, &wg, client, tenant, users, interval)
	}

	// graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh
	log.Println("shutdown requested — stopping read workers...")
	runCancel()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		log.Println("all read workers stopped cleanly")
	case <-time.After(20 * time.Second):
		log.Println("timeout waiting for workers; exiting")
	}
}

