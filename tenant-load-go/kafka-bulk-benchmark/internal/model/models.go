package model

import "time"

// Customer
type Customer struct {
	TenantId   string    `bson:"tenantId" json:"tenantId"`
	CustomerId string    `bson:"customerId" json:"customerId"`
	Name       string    `bson:"name" json:"name"`
	CreatedAt  time.Time `bson:"createdAt" json:"createdAt"`
}

// Inventory
type Inventory struct {
	TenantId  string    `bson:"tenantId" json:"tenantId"`
	ProductId string    `bson:"productId" json:"productId"`
	SkuId     string    `bson:"skuId" json:"skuId"`
	Price     int       `bson:"price" json:"price"`
	Stock     int       `bson:"stock" json:"stock"`
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
}

// Order Item
type OrderItem struct {
	ProductId string `bson:"productId" json:"productId"`
	SkuId     string `bson:"skuId" json:"skuId"`
	Quantity  int    `bson:"quantity" json:"quantity"`
	Price     int    `bson:"price" json:"price"`
}

// Order
type Order struct {
	TenantId    string      `bson:"tenantId" json:"tenantId"`
	OrderId     string      `bson:"orderId" json:"orderId"`
	CustomerId  string      `bson:"customerId" json:"customerId"`
	Items       []OrderItem `bson:"items" json:"items"`
	TotalAmount int         `bson:"totalAmount" json:"totalAmount"`
	OrderStatus string      `bson:"orderStatus" json:"orderStatus"`
	CreatedAt   time.Time   `bson:"createdAt" json:"createdAt"`
}

// Payment
type Payment struct {
	TenantId      string    `bson:"tenantId" json:"tenantId"`
	OrderId       string    `bson:"orderId" json:"orderId"`
	PaymentMode   string    `bson:"paymentMode" json:"paymentMode"`
	TransactionId string    `bson:"transactionId" json:"transactionId"`
	Amount        int       `bson:"amount" json:"amount"`
	Status        string    `bson:"status" json:"status"`
	CreatedAt     time.Time `bson:"createdAt" json:"createdAt"`
}

// Shipment
type Shipment struct {
	TenantId       string    `bson:"tenantId" json:"tenantId"`
	OrderId        string    `bson:"orderId" json:"orderId"`
	Carrier        string    `bson:"carrier" json:"carrier"`
	TrackingNumber string    `bson:"trackingNumber" json:"trackingNumber"`
	Status         string    `bson:"status" json:"status"`
	ShippedDate    time.Time `bson:"shippedDate" json:"shippedDate"`
}
