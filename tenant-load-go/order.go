package main

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

type OrderItem struct {
	ProductID string  `bson:"productId"`
	SKUID     string  `bson:"skuId"`
	Quantity  int     `bson:"quantity"`
	Price     float64 `bson:"price"`
}

type OrderDoc struct {
	TenantID string      `bson:"tenantId"`
	OrderID  string      `bson:"orderId"`
	Customer string      `bson:"customerId"`
	Items    []OrderItem `bson:"items"`
	Total    float64     `bson:"totalAmount"`
	Status   string      `bson:"orderStatus"`
	Created  time.Time   `bson:"createdAt"`
}

func CreateOrder(ctx context.Context, t *TenantCollections, tenantId string) (*OrderDoc, error) {
	customer := randomCustomer(ctx, t)
	if customer == "" {
		return nil, fmt.Errorf("no customer found")
	}
	item := randomInventoryItem(ctx, t)
	if item == nil {
		return nil, fmt.Errorf("no inventory found")
	}

	orderID := fmt.Sprintf("%s-ORD-%d", tenantId, time.Now().UnixNano()/1e6)
	qty := 1 + rand.Intn(3)
	price := 100.0 + float64(rand.Intn(400))
	total := float64(qty) * price

	order := &OrderDoc{
		TenantID: tenantId,
		OrderID:  orderID,
		Customer: customer,
		Items: []OrderItem{
			{ProductID: item.ProductID, SKUID: item.SKUID, Quantity: qty, Price: price},
		},
		Total:   total,
		Status:  "Placed",
		Created: time.Now(),
	}

	_, err := t.Orders.InsertOne(ctx, order)
	return order, err
}

func CreateShipment(ctx context.Context, t *TenantCollections, tenantId, orderId string) error {
	doc := bson.M{
		"tenantId":       tenantId,
		"orderId":        orderId,
		"carrier":        "DHL",
		"trackingNumber": fmt.Sprintf("TRK-%s", orderId),
		"status":         "Packed",
		"shippedDate":    time.Now(),
	}
	_, err := t.Shipments.InsertOne(ctx, doc)
	return err
}

func CreatePayment(ctx context.Context, t *TenantCollections, tenantId, orderId string, amount float64) error {
	doc := bson.M{
		"tenantId":     tenantId,
		"orderId":      orderId,
		"paymentMode":  "CreditCard",
		"transactionId": fmt.Sprintf("TXN-%s", orderId),
		"amount":       amount,
		"status":       "Success",
		"createdAt":    time.Now(),
	}
	_, err := t.Payments.InsertOne(ctx, doc)
	return err
}

// Helpers
type invItem struct {
	SKUID     string
	ProductID string
}

func randomInventoryItem(ctx context.Context, t *TenantCollections) *invItem {
	cur, err := t.Inventory.Find(ctx, bson.M{})
	if err != nil {
		return nil
	}
	defer cur.Close(ctx)

	var items []invItem
	for cur.Next(ctx) {
		var doc struct {
			SKUID     string `bson:"skuId"`
			ProductID string `bson:"productId"`
		}
		if err := cur.Decode(&doc); err == nil {
			items = append(items, invItem{SKUID: doc.SKUID, ProductID: doc.ProductID})
		}
	}
	if len(items) == 0 {
		return nil
	}
	p := items[rand.Intn(len(items))]
	return &p
}

func randomCustomer(ctx context.Context, t *TenantCollections) string {
	cur, err := t.Customers.Find(ctx, bson.M{})
	if err != nil {
		return ""
	}
	defer cur.Close(ctx)

	var ids []string
	for cur.Next(ctx) {
		var doc struct {
			CustomerID string `bson:"customerId"`
		}
		if err := cur.Decode(&doc); err == nil {
			ids = append(ids, doc.CustomerID)
		}
	}
	if len(ids) == 0 {
		return ""
	}
	return ids[rand.Intn(len(ids))]
}
