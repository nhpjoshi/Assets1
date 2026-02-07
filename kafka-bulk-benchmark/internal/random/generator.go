package generator

import (
	"fmt"
	"math/rand"
	"time"

	"kafka-mongo-benchmark/internal/model"
)

func Customer(tenant string, i int) model.Customer {
	return model.Customer{
		TenantId:   tenant,
		CustomerId: fmt.Sprintf("%s-CUST-%03d", tenant, i),
		Name:       fmt.Sprintf("Customer %d", i),
		CreatedAt:  time.Now(),
	}
}

func Inventory(tenant string, i int) model.Inventory {
	return model.Inventory{
		TenantId:  tenant,
		ProductId: fmt.Sprintf("%s-PROD-%03d", tenant, i),
		SkuId:     fmt.Sprintf("%s-SKU-%03d", tenant, i),
		Price:     100 + rand.Intn(200),
		Stock:     500 + rand.Intn(1000),
		CreatedAt: time.Now(),
	}
}

func Order(tenant string, i int) model.Order {
	item := model.OrderItem{
		ProductId: fmt.Sprintf("%s-PROD-%03d", tenant, rand.Intn(50)),
		SkuId:     fmt.Sprintf("%s-SKU-%03d", tenant, rand.Intn(50)),
		Quantity:  1 + rand.Intn(3),
		Price:     100 + rand.Intn(200),
	}
	return model.Order{
		TenantId:    tenant,
		OrderId:     fmt.Sprintf("%s-ORD-%d", tenant, time.Now().UnixNano()),
		CustomerId:  fmt.Sprintf("%s-CUST-%03d", tenant, rand.Intn(50)),
		Items:       []model.OrderItem{item},
		TotalAmount: item.Quantity * item.Price,
		OrderStatus: "Placed",
		CreatedAt:   time.Now(),
	}
}

func Payment(tenant string, orderId string, amount int) model.Payment {
	return model.Payment{
		TenantId:      tenant,
		OrderId:       orderId,
		PaymentMode:   "CreditCard",
		TransactionId: fmt.Sprintf("TXN-%s", orderId),
		Amount:        amount,
		Status:        "Success",
		CreatedAt:     time.Now(),
	}
}

func Shipment(tenant string, orderId string) model.Shipment {
	return model.Shipment{
		TenantId:       tenant,
		OrderId:        orderId,
		Carrier:        "DHL",
		TrackingNumber: fmt.Sprintf("TRK-%s", orderId),
		Status:         "Packed",
		ShippedDate:    time.Now(),
	}
}
