package random

import (
	"fmt"
	"math/rand"
	"time"
)

func Document(tenant string) map[string]interface{} {
	return map[string]interface{}{
		"tenantId":  tenant,
		"eventId":   fmt.Sprintf("%s-%d", tenant, time.Now().UnixNano()),
		"payload":   randString(128),
		"createdAt": time.Now(),
	}
}

func randString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}
