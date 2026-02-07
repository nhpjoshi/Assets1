package main

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type MongoClient struct {
	Client *mongo.Client
	DB     *mongo.Database
}

type TenantCollections struct {
	Orders    *mongo.Collection
	Inventory *mongo.Collection
	Shipments *mongo.Collection
	Payments  *mongo.Collection
	Customers *mongo.Collection
	Products  *mongo.Collection
}

func NewMongoClient(ctx context.Context, uri string) (*MongoClient, error) {
	clientOpts := options.Client().ApplyURI(uri).SetMaxPoolSize(300)
	c, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		return nil, err
	}
	ctxPing, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Ping(ctxPing, nil); err != nil {
		return nil, err
	}
	return &MongoClient{Client: c, DB: c.Database("orderdb")}, nil
}

func (m *MongoClient) Disconnect(ctx context.Context) {
	_ = m.Client.Disconnect(ctx)
}

func (m *MongoClient) GetTenantCollections(tenantId string) *TenantCollections {
	p := tenantId + "_"
	return &TenantCollections{
		Orders:    m.DB.Collection(p + "orders"),
		Inventory: m.DB.Collection(p + "inventory"),
		Shipments: m.DB.Collection(p + "shipments"),
		Payments:  m.DB.Collection(p + "payments"),
		Customers: m.DB.Collection(p + "customers"),
		Products:  m.DB.Collection(p + "products"),
	}
}

func EnsureSeedData(ctx context.Context, t *TenantCollections, tenantId string) (bool, error) {
	cctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	cn, err := t.Customers.CountDocuments(cctx, map[string]interface{}{"tenantId": tenantId})
	if err != nil {
		return false, err
	}
	in, err := t.Inventory.CountDocuments(cctx, map[string]interface{}{"tenantId": tenantId})
	if err != nil {
		return false, err
	}
	return cn > 0 && in > 0, nil
}
