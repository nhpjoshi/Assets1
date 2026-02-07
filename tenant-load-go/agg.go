package main

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

//
// Build aggregation pipeline
//
func aggPipeline(tenantId string) []bson.M {
	return []bson.M{
		{"$match": bson.M{"tenantId": tenantId}},
		{"$unwind": "$items"},
		{"$group": bson.M{
			"_id":   "$items.productId",
			"total": bson.M{"$sum": "$items.quantity"},
		}},
		{"$sort": bson.M{"total": -1}},
		{"$limit": 5},
	}
}

//
// Retry wrapper – exponential backoff
//
func retry(ctx context.Context, attempts int, fn func(context.Context) error) error {
	var last error
	for i := 0; i < attempts; i++ {
		// child context per attempt
		attemptCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		last = fn(attemptCtx)
		cancel()

		if last == nil {
			return nil
		}

		// retry only network-ish errors
		if mongo.IsNetworkError(last) || mongo.IsTimeout(last) {
			backoff := time.Duration(500*(i+1)) * time.Millisecond
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
			continue
		}

		return last // non-network error → no retry
	}
	return last
}

//
// Main aggregation read function
//
func RunAggregation(parentCtx context.Context, t *TenantCollections, tenantId string) error {
	pipeline := aggPipeline(tenantId)

	// Enable batchSize to reduce getMore frequency
	opts := options.Aggregate().SetBatchSize(50)

	// Retry wrapper to handle heavy load cases
	return retry(parentCtx, 3, func(ctx context.Context) error {

		cur, err := t.Orders.Aggregate(ctx, pipeline, opts)
		if err != nil {
			return err
		}
		defer cur.Close(ctx)

		// Scan and discard results – lightweight client side
		for cur.Next(ctx) {
		}

		return cur.Err()
	})
}

