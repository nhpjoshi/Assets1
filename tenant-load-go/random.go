package main

import (
	"context"
	"math/rand"
	"time"
)

func JitterSleep(ctx context.Context, base time.Duration) {
	j := float64(base) * 0.25
	delta := time.Duration((rand.Float64()*2 - 1) * j)
	sleep := base + delta

	t := time.NewTimer(sleep)
	select {
	case <-ctx.Done():
		t.Stop()
	case <-t.C:
	}
}
