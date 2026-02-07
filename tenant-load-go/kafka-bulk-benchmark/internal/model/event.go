package model

import "time"

type Event struct {
	TenantId string    `json:"tenantId" bson:"tenantId"`
	EventId  string    `json:"eventId" bson:"eventId"`
	Type     string    `json:"type" bson:"type"`
	Payload  string    `json:"payload" bson:"payload"`
	Created  time.Time `json:"createdAt" bson:"createdAt"`
}
