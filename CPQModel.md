x# CPQ System - MongoDB Data Model Documentation

**Version:** 3.0  
**Date:** February 2025  
**Database:** MongoDB  
**Application:** Configure-Price-Quote (CPQ) System

---

## Table of Contents

1. [Overview](#overview)
2. [Database Configuration](#database-configuration)
3. [Collections](#collections)
   - [Prices Collection](#1-prices-collection)
   - [Pricing Rule Collection](#2-pricing-rule-collection)
   - [Discount Collection](#3-discount-collection)
   - [Tax Collection](#4-tax-collection)
   - [Quote Collection](#5-quote-collection)
   - [Quote Line Item Collection](#6-quote-line-item-collection)
   - [Quote Version Collection](#7-quote-version-collection)
   - [CPQ Configuration Collection](#8-cpq-configuration-collection)
   - [User Collection](#9-user-collection)
4. [Indexes](#indexes)
5. [Relationships](#relationships)
6. [Design Decisions](#design-decisions)
7. [Example Documents](#example-documents)

---

## Overview

This document describes the complete MongoDB data model for the CPQ (Configure-Price-Quote) system. The system manages product pricing, discounts, taxes, and sales quotes with support for versioning, approval workflows, and frequent line item state updates.

### Database Name
`cpq`

### Collections Overview

| Collection | Purpose | Update Frequency |
|------------|---------|------------------|
| `prices` | Product, Plan, and Price hierarchy | Medium |
| `pricing_rules` | Tiered pricing and volume discounts | Low |
| `discounts` | Discount codes and rules | Low |
| `taxes` | Tax calculation rules | Low |
| `quotes` | Sales quotes | Medium |
| `quote_line_items` | Quote line items with state | **High** |
| `quote_versions` | Quote version history | Medium |
| `cpq_configurations` | CPQ configuration snapshots | Medium |
| `users` | User accounts for authentication | Low |

---

## Database Configuration

### Connection Settings
```properties
spring.data.mongodb.uri=mongodb://localhost:27017
spring.data.mongodb.database=cpq
spring.data.mongodb.authentication-database=admin
spring.data.mongodb.auto-index-creation=true
```

### Connection Pool Settings
```properties
spring.data.mongodb.connect-timeout=10000
spring.data.mongodb.socket-timeout=30000
spring.data.mongodb.max-pool-size=100
spring.data.mongodb.min-pool-size=10
spring.data.mongodb.max-idle-time=600000
spring.data.mongodb.max-wait-time=120000
```

### Transaction Support
- MongoDB transactions enabled via `MongoTransactionManager` // Why we are using it ?
- Supports multi-document transactions for consistency

---

## Collections

### 1. Prices Collection

**Collection Name:** `prices`

**Description:** Stores the complete Product → Plan → Price hierarchy in a single collection. Documents are differentiated by the `object` field (PRODUCT, PLAN, PRICE). This unified approach allows for efficient hierarchical queries and maintains referential integrity.

**Hierarchy:**
- **Product**: Top-level product definition (no `lookupKey`)
- **Plan**: Belongs to a Product (via `lookupKey` referencing product `code`)
- **Price**: Belongs to a Plan (via `lookupKey` referencing plan `code`)

**Data Integrity Rules:**
- Prices cannot be stored without a plan
- Plans cannot be stored without a product
- Products must have at least one plan when created
- Each plan must have at least one price when created

#### Schema

| Field | Type | Required | Indexed | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId/String | Yes | Primary | Unique identifier |
| `object` | Enum | Yes | Yes | Type: `PRODUCT`, `PLAN`, `PRICE` |
| `code` | String | Yes | Yes (Unique) | Unique code for product/plan/price |
| `lookupKey` | String | No | Yes | For PLAN: references product code. For PRICE: references plan code. For PRODUCT: null |
| `active` | Boolean | Yes | Yes | Whether object is active |
| `created` | DateTime | Yes | No | Creation timestamp |
| `updated` | DateTime | Yes | No | Last update timestamp |
| `priceEffectiveFrom` | DateTime | No | No | Price effective start date |
| `priceEffectiveTo` | DateTime | No | No | Price effective end date (null = no expiration) |
| `name` | String | Yes | No | Name of the product/plan/price |
| `description` | String | No | No | Description |
| `categories` | Array[String] | No | No | Categories (for products only) |
| `images` | Array[String] | No | No | Image URLs |
| `attributes` | Object | No | No | Custom attributes (key-value pairs) | How deep this custom attribute can go ?
| `url` | String | No | No | URL (optional) |
| `defaultPrice` | String | No | No | Default price code for the plan (PLAN only) |
| `currency` | String | No | No | Currency code (ISO 4217, e.g., "usd", "eur", "inr") (PRICE only) |
| `type` | Enum | No | No | Price type: `RECURRING`, `ONE_TIME`, `USAGE` (PRICE only) |
| `unitAmount` | Decimal | No | No | Unit amount in decimal format (e.g., 10.10 for $10.10 USD) (PRICE only) |
| `recurring` | Object | No | No | Recurring details (PRICE only, for RECURRING type) |
| `recurring.interval` | String | No | No | Billing interval: `day`, `week`, `month`, `year` |
| `recurring.intervalCount` | Integer | No | No | Number of intervals between each billing (e.g., 1 for monthly, 3 for quarterly) |
| `recurring.trialPeriodDays` | Integer | No | No | Trial period in days |
| `recurring.usageType` | String | No | No | Usage type: `licensed` or `metered` |
| `taxBehavior` | String | No | No | Tax behavior: `unspecified`, `inclusive`, `exclusive` (PRICE only) |
| `tiersMode` | String | No | No | Tiers mode: `graduated`, `volume`, or null (PRICE only) |
| `discountCode` | String | No | No | Applied discount code (PRICE only) |
| `taxCode` | String | No | No | Applied tax code (PRICE only) |

#### Indexes
- `_id` (Primary Key)
- `object` (Indexed for filtering by type)
- `code` (Unique index for all object types)
- `lookupKey` (Indexed for hierarchical queries)
- `active` (Indexed for filtering active objects)

#### Example Documents

**Product Document:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "object": "PRODUCT",
  "code": "prod_NWjs8kKbJWmuuc",
  "lookupKey": null,
  "active": true,
  "created": "2025-01-12T12:00:00Z",
  "updated": "2025-01-12T12:00:00Z",
  "priceEffectiveFrom": "2025-01-12T12:00:00Z",
  "priceEffectiveTo": null,
  "name": "Gold product",
  "description": "Premium gold tier product",
  "categories": ["cat100", "cat101"],
  "images": ["https://example.com/image1.jpg"],
  "attributes": {
    "brand": "Premium",
    "tier": "Gold"
  },
  "url": "https://example.com/products/gold"
}
```

**Plan Document:**
```json
{
  "_id": "507f1f77bcf86cd799439012",
  "object": "PLAN",
  "code": "plan_NWjs8kKbJWmuuc",
  "lookupKey": "prod_NWjs8kKbJWmuuc",
  "active": true,
  "created": "2025-01-12T12:00:00Z",
  "updated": "2025-01-12T12:00:00Z",
  "priceEffectiveFrom": "2025-01-12T12:00:00Z",
  "priceEffectiveTo": null,
  "name": "Gold Plan1",
  "description": "Monthly gold plan",
  "defaultPrice": "price_1MoBy5LkdIwHu7ixZhnattbh",
  "images": [],
  "attributes": {},
  "url": null
}
```

**Price Document:**
```json
{
  "_id": "507f1f77bcf86cd799439013",
  "object": "PRICE",
  "code": "price_1MoBy5LkdIwHu7ixZhnattbh",
  "lookupKey": "plan_NWjs8kKbJWmuuc",
  "active": true,
  "created": "2025-01-12T12:00:00Z",
  "updated": "2025-01-12T12:00:00Z",
  "priceEffectiveFrom": "2025-01-12T12:00:00Z",
  "priceEffectiveTo": null,
  "name": "Monthly Price USD",
  "description": "Monthly recurring price in USD",
  "currency": "usd",
  "type": "RECURRING",
  "unitAmount": 10.10,
  "recurring": {
    "interval": "month",
    "intervalCount": 1,
    "trialPeriodDays": 30,
    "usageType": "licensed"
  },
  "taxBehavior": "unspecified",
  "tiersMode": null,
  "discountCode": "D-1201",
  "taxCode": "GST",
  "attributes": {},
  "images": [],
  "url": null
}
```

---

### 2. Pricing Rule Collection

**Collection Name:** `pricing_rules`

**Description:** Defines tiered pricing, volume discounts, and conditional pricing rules based on quantity, customer segments, or other attributes.

#### Schema

| Field | Type | Required | Indexed | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId/String | Yes | Primary | Unique identifier |
| `ruleName` | String | Yes | Yes | Rule name or identifier |
| `ruleType` | Enum | Yes | Yes | TIERED, VOLUME_DISCOUNT, CUSTOMER_SEGMENT, CONDITIONAL, BUNDLE |
| `productId` | String | No | Yes | Product ID (null = applies to all) |
| `priceListId` | String | Yes | Yes | Price list ID |
| `priority` | Integer | Yes | No | Rule priority (higher = higher priority) |
| `tiers` | Array | No | No | Tiered pricing tiers (for TIERED type) |
| `tiers[].minQuantity` | Integer | Yes | No | Minimum quantity for tier |
| `tiers[].maxQuantity` | Integer | No | No | Maximum quantity (null = unlimited) |
| `tiers[].pricePerUnit` | Decimal | No | No | Price per unit for this tier |
| `tiers[].discountPercentage` | Decimal | No | No | Discount percentage for this tier |
| `discountPercentage` | Decimal | No | No | Volume discount percentage |
| `discountAmount` | Decimal | No | No | Fixed discount amount |
| `customerSegmentIds` | Array[String] | No | No | Customer segment IDs (empty = all segments) |
| `conditions` | Object | No | No | Conditional attributes (key-value pairs) |
| `minQuantity` | Integer | No | No | Minimum quantity required |
| `maxQuantity` | Integer | No | No | Maximum quantity (null = unlimited) |
| `active` | Boolean | Yes | Yes | Whether rule is active |
| `effectiveFrom` | DateTime | Yes | No | Effective start date |
| `effectiveTo` | DateTime | No | No | Effective end date (null = no expiration) |
| `createdAt` | DateTime | Yes | No | Creation timestamp |
| `updatedAt` | DateTime | Yes | No | Last update timestamp |
| `createdBy` | String | No | No | User who created the rule |
| `updatedBy` | String | No | No | User who last updated the rule |

#### Indexes
- `_id` (Primary Key)
- `ruleName`
- `ruleType`
- `productId`
- `priceListId`
- `active`

#### Example Document
```json
{
  "_id": "507f1f77bcf86cd799439012",
  "ruleName": "Volume Discount Tier 1",
  "ruleType": "TIERED",
  "productId": "PROD-001",
  "priceListId": "STANDARD",
  "priority": 10,   // Add API bounds on it if possible 
  "tiers": [
    {
      "minQuantity": 1,
      "maxQuantity": 10,
      "pricePerUnit": 99.99,
      "discountPercentage": null
    },
    {
      "minQuantity": 11,
      "maxQuantity": 50,
      "pricePerUnit": 89.99,
      "discountPercentage": 10.0
    },
    {
      "minQuantity": 51,
      "maxQuantity": null,
      "pricePerUnit": 79.99,
      "discountPercentage": 20.0
    }
  ],
  "active": true,
  "effectiveFrom": "2024-01-01T00:00:00Z",
  "effectiveTo": null,
  "createdAt": "2024-01-01T10:00:00Z",
  "updatedAt": "2024-01-01T10:00:00Z",
  "createdBy": "admin",
  "updatedBy": "admin"
}
```

---

### 3. Discount Collection

**Collection Name:** `discounts`

**Description:** Manages discount codes with percentage-based or fixed amount discounts, applicable to specific products or customer segments.

#### Schema

| Field | Type | Required | Indexed | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId/String | Yes | Primary | Unique identifier |
| `discountCode` | String | Yes | Yes (Unique) | Discount code or identifier |
| `name` | String | Yes | No | Discount name or description |
| `discountType` | Enum | Yes | Yes | PERCENTAGE or FIXED_AMOUNT |
| `value` | Decimal | Yes | No | Discount value (percentage or amount) |
| `productIds` | Array[String] | No | No | Product IDs (empty = all products) |
| `customerSegmentIds` | Array[String] | No | No | Customer segment IDs (empty = all customers) |
| `minPurchaseAmount` | Decimal | No | No | Minimum purchase amount required |
| `maxDiscountAmount` | Decimal | No | No | Maximum discount amount cap |
| `active` | Boolean | Yes | Yes | Whether discount is active |
| `effectiveFrom` | DateTime | Yes | No | Effective start date |
| `effectiveTo` | DateTime | No | No | Effective end date (null = no expiration) |
| `maxUsageCount` | Integer | No | No | Maximum usage count (null = unlimited) |
| `usageCount` | Integer | Yes | No | Current usage count |
| `combinable` | Boolean | Yes | No | Whether combinable with other discounts |
| `createdAt` | DateTime | Yes | No | Creation timestamp |
| `updatedAt` | DateTime | Yes | No | Last update timestamp |
| `createdBy` | String | No | No | User who created the discount |
| `updatedBy` | String | No | No | User who last updated the discount |

#### Indexes
- `_id` (Primary Key)
- `discountCode` (Unique)
- `discountType`
- `active`

#### Example Document
```json
{
  "_id": "507f1f77bcf86cd799439013",
  "discountCode": "SAVE10",
  "name": "10% Off Discount",
  "discountType": "PERCENTAGE",
  "value": 10.0,
  "productIds": ["PROD-001", "PROD-002"],
  "customerSegmentIds": [],
  "minPurchaseAmount": 100.00,
  "maxDiscountAmount": 50.00,
  "active": true,
  "effectiveFrom": "2024-01-01T00:00:00Z",
  "effectiveTo": "2024-12-31T23:59:59Z",
  "maxUsageCount": 1000,
  "usageCount": 245,
  "combinable": false,
  "createdAt": "2024-01-01T10:00:00Z",
  "updatedAt": "2024-01-15T14:30:00Z",
  "createdBy": "admin",
  "updatedBy": "admin"
}
```

---

### 4. Tax Collection

**Collection Name:** `taxes`

**Description:** Defines tax calculation rules based on region, product type, or customer segment with support for various tax types (GST, VAT, Sales Tax).

#### Schema

| Field | Type | Required | Indexed | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId/String | Yes | Primary | Unique identifier |
| `taxCode` | String | Yes | Yes | Tax code (GST, VAT, SALES_TAX) |
| `name` | String | Yes | No | Tax name or description |
| `rate` | Decimal | Yes | No | Tax rate as percentage (e.g., 18.0 for 18%) |
| `productCategory` | String | No | No | Product category (null = all products) |
| `productId` | String | No | Yes | Product ID (null = all products in category) |
| `region` | String | Yes | Yes | Region/State/Country code (US-CA, IN, EU) |
| `taxType` | Enum | Yes | Yes | SALES_TAX, VAT, GST, SERVICE_TAX, CUSTOM |
| `active` | Boolean | Yes | Yes | Whether tax is active |
| `effectiveFrom` | DateTime | Yes | No | Effective start date |
| `effectiveTo` | DateTime | No | No | Effective end date (null = no expiration) |
| `inclusive` | Boolean | Yes | No | Whether tax is included in base price |
| `createdAt` | DateTime | Yes | No | Creation timestamp |
| `updatedAt` | DateTime | Yes | No | Last update timestamp |
| `createdBy` | String | No | No | User who created the tax rule |
| `updatedBy` | String | No | No | User who last updated the tax rule |

#### Indexes
- `_id` (Primary Key)
- `taxCode`
- `productId`
- `region`
- `taxType`
- `active`

#### Example Document
```json
{
  "_id": "507f1f77bcf86cd799439015",
  "taxCode": "GST",
  "name": "Goods and Services Tax",
  "rate": 18.0,
  "productCategory": null,
  "productId": null,
  "region": "IN",
  "taxType": "GST",
  "active": true,
  "effectiveFrom": "2024-01-01T00:00:00Z",
  "effectiveTo": null,
  "inclusive": false,
  "createdAt": "2024-01-01T10:00:00Z",
  "updatedAt": "2024-01-01T10:00:00Z",
  "createdBy": "admin",
  "updatedBy": "admin"
}
```

---

### 5. Quote Collection

**Collection Name:** `quotes`

**Description:** Stores sales quotes with support for versioning, approval workflow, expiration, and comprehensive pricing breakdown. Line items are stored separately in `quote_line_items` collection.

#### Schema

| Field | Type | Required | Indexed | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId/String | Yes | Primary | Unique identifier |
| `quoteNumber` | String | Yes | Yes (Unique) | Quote number (business identifier) |
| `version` | Integer | Yes | Yes | Quote version number |
| `customerId` | String | Yes | Yes | Customer identifier |
| `accountId` | String | No | Yes | Account identifier |
| `status` | Enum | Yes | Yes | DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, EXPIRED, ACCEPTED, CONVERTED |
| `lineItemIds` | Array[String] | Yes | Yes | References to quote_line_items collection |
| `subtotal` | Decimal | Yes | No | Subtotal (before discounts/taxes) |
| `totalDiscount` | Decimal | Yes | No | Total discount amount |
| `totalTax` | Decimal | Yes | No | Total tax amount |
| `totalAmount` | Decimal | Yes | No | Total amount (final price) |
| `currency` | String | Yes | No | Currency code (ISO 4217) |
| `discountCode` | String | No | No | Applied discount code |
| `expirationDate` | DateTime | No | No | Quote expiration date |
| `expired` | Boolean | Yes | Yes | Whether quote has expired |
| `approvalInfo` | Object | No | No | Approval workflow information |
| `approvalInfo.requiresApproval` | Boolean | No | No | Whether approval is required |
| `approvalInfo.approverId` | String | No | No | Approver identifier |
| `approvalInfo.approverName` | String | No | No | Approver name |
| `approvalInfo.approvalRequestedAt` | DateTime | No | No | Approval request timestamp |
| `approvalInfo.approvalDate` | DateTime | No | No | Approval/rejection date |
| `approvalInfo.approvalComments` | String | No | No | Approval comments |
| `approvalInfo.approvalStatus` | Enum | No | No | PENDING, APPROVED, REJECTED, NOT_REQUIRED |
| `notes` | String | No | No | Quote notes or comments |
| `createdAt` | DateTime | Yes | No | Creation timestamp |
| `updatedAt` | DateTime | Yes | No | Last update timestamp |
| `createdBy` | String | No | No | User who created the quote |
| `updatedBy` | String | No | No | User who last updated the quote |
| `previousVersionId` | String | No | Yes | Reference to previous version |

#### Indexes
- `_id` (Primary Key)
- `quoteNumber` (Unique)
- `version`
- `customerId`
- `accountId`
- `status`
- `expired`
- `lineItemIds`
- `previousVersionId`

#### Quote Status Values
- `DRAFT` - Quote is in draft state
- `PENDING_APPROVAL` - Quote submitted for approval
- `APPROVED` - Quote has been approved
- `REJECTED` - Quote has been rejected
- `EXPIRED` - Quote has expired
- `ACCEPTED` - Quote has been accepted by customer
- `CONVERTED` - Quote has been converted to order

#### Example Document
```json
{
  "_id": "507f1f77bcf86cd799439016",
  "quoteNumber": "QT-2024-ABC12345",
  "version": 1,
  "customerId": "CUST-001",
  "accountId": "ACC-001",
  "status": "APPROVED",
  "lineItemIds": ["line-item-1", "line-item-2"],
  "subtotal": 1499.90,
  "totalDiscount": 10.00,
  "totalTax": 106.20,
  "totalAmount": 1596.10,
  "currency": "USD",
  "discountCode": "SAVE10",
  "expirationDate": "2024-03-01T23:59:59Z",
  "expired": false,
  "approvalInfo": {
    "requiresApproval": true,
    "approverId": "APPROVER-001",
    "approverName": "John Doe",
    "approvalRequestedAt": "2024-02-01T10:00:00Z",
    "approvalDate": "2024-02-01T14:30:00Z",
    "approvalComments": "Approved for customer CUST-001",
    "approvalStatus": "APPROVED"
  },
  "notes": "Quote for annual enterprise subscription",
  "createdAt": "2024-02-01T09:00:00Z",
  "updatedAt": "2024-02-01T14:30:00Z",
  "createdBy": "sales-rep-001",
  "updatedBy": "APPROVER-001",
  "previousVersionId": null
}
```

---

### 6. Quote Line Item Collection. // Why you need this as separate collection , how big it can go ? -- Separate collection as it can grow big and can be bottle neck in the future 

**Collection Name:** `quote_line_items`

**Description:** Stores individual line items for quotes as a separate collection to support frequent state updates without modifying the parent quote document. This design allows efficient updates to line item status and configuration.

#### Schema

| Field | Type | Required | Indexed | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId/String | Yes | Primary | Unique identifier |
| `quoteId` | String | Yes | Yes | Quote ID this line item belongs to |
| `quoteNumber` | String | Yes | Yes | Quote number (denormalized for queries) |
| `lineNumber` | Integer | Yes | No | Line item sequence number within quote |
| `productId` | String | Yes | Yes | Product identifier |
| `productName` | String | No | No | Product name (denormalized for display) |
| `variantId` | String | No | No | Product variant identifier (optional) |
| `quantity` | Integer | Yes | No | Quantity |
| `unitPrice` | Decimal | Yes | No | Unit price |
| `discountAmount` | Decimal | No | No | Discount amount for this line item |
| `taxAmount` | Decimal | No | No | Tax amount for this line item |
| `lineTotal` | Decimal | Yes | No | Line total (quantity × unitPrice - discount + tax) |
| `currency` | String | No | No | Currency code (ISO 4217 format) |
| `status` | Enum | Yes | Yes | PENDING, CONFIGURED, PRICED, APPROVED, REJECTED, CANCELLED, FULFILLED |
| `configuration` | String | No | No | Configuration state or attributes (JSON string) |
| `notes` | String | No | No | Notes or comments specific to this line item |
| `createdAt` | DateTime | Yes | No | Creation timestamp |
| `updatedAt` | DateTime | Yes | No | Last update timestamp |
| `createdBy` | String | No | No | User who created this line item |
| `updatedBy` | String | No | No | User who last updated this line item |

#### Indexes
- `_id` (Primary Key)
- `quoteId` (Indexed - for finding all items in a quote)
- `quoteNumber` (Indexed - for queries by quote number)
- `productId` (Indexed - for product-based queries)
- `status` (Indexed - for status-based queries)
- Compound: `{quoteId: 1, lineNumber: 1}` (for ordered retrieval)

#### Line Item Status Values
- `PENDING` - Line item created but not configured
- `CONFIGURED` - Product configuration completed
- `PRICED` - Pricing calculated
- `APPROVED` - Line item approved
- `REJECTED` - Line item rejected
- `CANCELLED` - Line item cancelled
- `FULFILLED` - Line item fulfilled/processed

#### Example Document
```json
{
  "_id": "507f1f77bcf86cd799439017",
  "quoteId": "507f1f77bcf86cd799439016",
  "quoteNumber": "QT-2024-ABC12345",
  "lineNumber": 1,
  "productId": "PROD-001",
  "productName": "Premium Subscription",
  "variantId": "VAR-001",
  "quantity": 10,
  "unitPrice": 99.99,
  "discountAmount": 10.00,
  "taxAmount": 16.20,
  "lineTotal": 1006.10,
  "currency": "USD",
  "status": "APPROVED",
  "configuration": "{\"region\": \"US\", \"deployment\": \"cloud\"}",
  "notes": "Annual subscription",
  "createdAt": "2024-02-01T09:00:00Z",
  "updatedAt": "2024-02-01T14:30:00Z",
  "createdBy": "sales-rep-001",
  "updatedBy": "APPROVER-001"
}
```

---

### 7. Quote Version Collection

**Collection Name:** `quote_versions`

**Description:** Maintains version history for quotes, storing snapshots of each version for audit and comparison purposes.

#### Schema

| Field | Type | Required | Indexed | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId/String | Yes | Primary | Unique identifier |
| `quoteId` | String | Yes | Yes | Quote ID this version belongs to |
| `quoteNumber` | String | Yes | Yes | Quote number (for easy lookup) |
| `version` | Integer | Yes | Yes | Version number |
| `quoteSnapshot` | String | Yes | No | JSON snapshot of quote at this version |
| `changeDescription` | String | No | No | Description of changes in this version |
| `createdBy` | String | No | No | User who created this version |
| `createdAt` | DateTime | Yes | No | Version creation timestamp |
| `isCurrentVersion` | Boolean | Yes | Yes | Whether this is the current active version |

#### Indexes
- `_id` (Primary Key)
- `quoteId`
- `quoteNumber`
- `version`
- `isCurrentVersion`

#### Example Document
```json
{
  "_id": "507f1f77bcf86cd799439018",
  "quoteId": "507f1f77bcf86cd799439016",
  "quoteNumber": "QT-2024-ABC12345",
  "version": 2,
  "quoteSnapshot": "{\"quoteNumber\":\"QT-2024-ABC12345\",\"version\":2,\"totalAmount\":1596.10,...}",
  "changeDescription": "Updated quantity for PROD-001 from 10 to 15",
  "createdBy": "sales-rep-001",
  "createdAt": "2024-02-05T11:00:00Z",
  "isCurrentVersion": true
}
```

---

### 8. CPQ Configuration Collection

**Collection Name:** `cpq_configurations`

**Description:** Stores CPQ (Configure-Price-Quote) configuration snapshots for products, including selected options, attributes, and configuration state.

#### Schema

| Field | Type | Required | Indexed | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId/String | Yes | Primary | Unique identifier |
| `configurationName` | String | No | No | Configuration name or identifier |
| `customerId` | String | Yes | Yes | Customer identifier |
| `accountId` | String | No | Yes | Account identifier |
| `status` | Enum | Yes | Yes | DRAFT, VALIDATED, PRICED, QUOTED |
| `products` | Array | Yes | No | Configured products |
| `products[].productId` | String | Yes | No | Product identifier |
| `products[].variantId` | String | No | No | Product variant identifier |
| `products[].quantity` | Integer | Yes | No | Quantity |
| `products[].productAttributes` | Object | No | No | Product-specific attributes |
| `products[].selectedOptions` | Array[String] | No | No | Selected optional features/add-ons |
| `attributes` | Object | No | No | Configuration attributes (key-value pairs) |
| `isValid` | Boolean | Yes | No | Whether configuration is valid |
| `validationErrors` | Array[String] | No | No | Validation error messages |
| `createdAt` | DateTime | Yes | No | Creation timestamp |
| `updatedAt` | DateTime | Yes | No | Last update timestamp |
| `createdBy` | String | No | No | User who created the configuration |
| `updatedBy` | String | No | No | User who last updated the configuration |

#### Indexes
- `_id` (Primary Key)
- `customerId`
- `accountId`
- `status`

#### Configuration Status Values
- `DRAFT` - Configuration in draft state
- `VALIDATED` - Configuration validated
- `PRICED` - Pricing calculated
- `QUOTED` - Quote created from configuration

#### Example Document
```json
{
  "_id": "507f1f77bcf86cd799439019",
  "configurationName": "Enterprise Cloud Config",
  "customerId": "CUST-001",
  "accountId": "ACC-001",
  "status": "PRICED",
  "products": [
    {
      "productId": "PROD-001",
      "variantId": "VAR-001",
      "quantity": 10,
      "productAttributes": {
        "region": "US",
        "deployment": "cloud"
      },
      "selectedOptions": ["feature-1", "feature-2"]
    }
  ],
  "attributes": {
    "region": "US-CA",
    "deployment": "cloud"
  },
  "isValid": true,
  "validationErrors": [],
  "createdAt": "2024-02-01T09:00:00Z",
  "updatedAt": "2024-02-01T10:00:00Z",
  "createdBy": "sales-rep-001",
  "updatedBy": "sales-rep-001"
}
```

---

### 9. User Collection

**Collection Name:** `users`

**Description:** Stores user accounts for OAuth2 authentication and authorization. Implements Spring Security UserDetails interface.

#### Schema

| Field | Type | Required | Indexed | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId/String | Yes | Primary | Unique identifier |
| `username` | String | Yes | Yes (Unique) | Username for login |
| `password` | String | Yes | No | Encrypted password (BCrypt) |
| `email` | String | No | Yes (Unique) | Email address |
| `firstName` | String | No | No | First name |
| `lastName` | String | No | No | Last name |
| `roles` | Array[String] | Yes | No | User roles (e.g., ROLE_USER, ROLE_ADMIN, ROLE_SALES) |
| `accountNonExpired` | Boolean | Yes | No | Whether account is not expired |
| `accountNonLocked` | Boolean | Yes | No | Whether account is not locked |
| `credentialsNonExpired` | Boolean | Yes | No | Whether credentials are not expired |
| `enabled` | Boolean | Yes | No | Whether account is enabled |
| `createdAt` | DateTime | Yes | No | Creation timestamp |
| `updatedAt` | DateTime | Yes | No | Last update timestamp |
| `lastLogin` | DateTime | No | No | Last login timestamp |

#### Indexes
- `_id` (Primary Key)
- `username` (Unique)
- `email` (Unique)

#### Example Document
```json
{
  "_id": "507f1f77bcf86cd799439020",
  "username": "john.doe",
  "password": "$2a$10$...",
  "email": "john.doe@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "roles": ["ROLE_USER", "ROLE_SALES"],
  "accountNonExpired": true,
  "accountNonLocked": true,
  "credentialsNonExpired": true,
  "enabled": true,
  "createdAt": "2024-01-01T10:00:00Z",
  "updatedAt": "2024-01-01T10:00:00Z",
  "lastLogin": "2024-02-15T14:30:00Z"
}
```

---

## Indexes

### Summary of All Indexes

#### Prices Collection
- `_id` (Primary Key)
- `object` (Indexed for filtering by type: PRODUCT, PLAN, PRICE)
- `code` (Unique index for all object types)
- `lookupKey` (Indexed for hierarchical queries)
- `active` (Indexed for filtering active objects)

#### Pricing Rules Collection
- `_id` (Primary Key)
- `ruleName`
- `ruleType`
- `productId`
- `priceListId`
- `active`

#### Discounts Collection
- `_id` (Primary Key)
- `discountCode` (Unique)
- `discountType`
- `active`

#### Taxes Collection
- `_id` (Primary Key)
- `taxCode`
- `productId`
- `region`
- `taxType`
- `active`

#### Quotes Collection
- `_id` (Primary Key)
- `quoteNumber` (Unique)
- `version`
- `customerId`
- `accountId`
- `status`
- `expired`
- `lineItemIds`
- `previousVersionId`

#### Quote Line Items Collection
- `_id` (Primary Key)
- `quoteId`
- `quoteNumber`
- `productId`
- `status`
- Compound: `{quoteId: 1, lineNumber: 1}`

#### Quote Versions Collection
- `_id` (Primary Key)
- `quoteId`
- `quoteNumber`
- `version`
- `isCurrentVersion`

#### CPQ Configurations Collection
- `_id` (Primary Key)
- `customerId`
- `accountId`
- `status`

#### Users Collection
- `_id` (Primary Key)
- `username` (Unique)
- `email` (Unique)

### Recommended Compound Indexes

For better query performance, consider adding these compound indexes:

```javascript
// Prices - for active price lookups
// Prices - for object type filtering
db.prices.createIndex({ object: 1, code: 1 })

// Prices - for hierarchical lookups
db.prices.createIndex({ object: 1, lookupKey: 1, active: 1 })

// Prices - for active price queries with effective dates
db.prices.createIndex({ object: 1, lookupKey: 1, active: 1, priceEffectiveFrom: 1, priceEffectiveTo: 1 })

// Quotes - for customer quote lookups
db.quotes.createIndex({ customerId: 1, status: 1, createdAt: -1 })

// Quote Line Items - for status-based queries
db.quote_line_items.createIndex({ quoteId: 1, status: 1 })

// Quote Line Items - for ordered retrieval
db.quote_line_items.createIndex({ quoteId: 1, lineNumber: 1 })

// Discounts - for active discount lookups
db.discounts.createIndex({ discountCode: 1, active: 1, effectiveFrom: 1, effectiveTo: 1 })

// Taxes - for tax calculation lookups
db.taxes.createIndex({ productId: 1, region: 1, active: 1, effectiveFrom: 1, effectiveTo: 1 })
```

---

## Relationships

### Entity Relationship Diagram

```
┌─────────────┐
│   Product   │ (object: PRODUCT in prices collection)
└──────┬──────┘
       │
       │ 1:N (via lookupKey)
       │
       ▼
┌─────────────┐
│    Plan     │ (object: PLAN in prices collection)
└──────┬──────┘
       │
       │ 1:N (via lookupKey)
       │
       ▼
┌─────────────┐
│    Price    │ (object: PRICE in prices collection)
└──────┬──────┘
       │
       │ References
       │
       ├─────────────────────────────────────┐
       │                                     │
       ▼                                     ▼
┌──────────────┐                    ┌──────────────┐
│ PricingRule │                    │   Discount   │
└──────────────┘                    └──────────────┘
       │                                     │
       │                                     │
       └─────────────────────────────────────┘
                     │
                     │ Used in
                     ▼
┌─────────────────────────────────────────────┐
│                   Quote                       │
│  ┌─────────────────────────────────────┐    │
│  │ lineItemIds: [id1, id2, id3]        │    │
│  └─────────────────────────────────────┘    │
└──────────────┬────────────────────────────────┘
               │
               │ 1:N (Referenced)
               │
               ▼
┌──────────────────────────────┐
│      Quote Line Item          │
│  (Separate Collection)        │       
└──────────────────────────────┘
               │
               │ 1:N
               ▼
┌──────────────────────────────┐
│      Quote Version            │
│  (Version History)            │// It is growing very fast -- Archiving 
└──────────────────────────────┘

┌─────────────┐         ┌─────────────┐
│  Discount   │         │    Tax      │
└─────────────┘         └─────────────┘
       │                         │
       │ Many-to-Many            │ Many-to-One
       │                         │
       └─────────────┬───────────┘
                     │
                     ▼
              ┌─────────────┐
              │   Quote     │
              └─────────────┘
```

### Relationship Details

1. **Product → Plan → Price (Hierarchical)**
   - All stored in single `prices` collection, differentiated by `object` field
   - Product: Top-level, no `lookupKey`
   - Plan: References Product via `lookupKey` (product code)
   - Price: References Plan via `lookupKey` (plan code)
   - Relationship: One-to-Many-to-Many (Product → Plans → Prices)
   - **Data Integrity**: Prices require plans, plans require products

2. **Product → PricingRule**
   - One product can have multiple pricing rules
   - Relationship: One-to-Many (Product → Pricing Rules)

3. **Discount → Products**
   - One discount can apply to multiple products
   - Relationship: Many-to-Many (Discount ↔ Products)

4. **Tax → Product/Region**
   - One tax rule applies to a product/region combination
   - Relationship: Many-to-One (Tax → Product/Region)

5. **Quote → Customer**
   - One customer can have multiple quotes
   - Relationship: One-to-Many (Customer → Quotes)

6. **Quote → QuoteLineItem**
   - One quote has many line items (stored in separate collection)
   - Relationship: One-to-Many (Quote → Quote Line Items) - **Referenced**
   - Quote contains `lineItemIds` array
   - QuoteLineItem contains `quoteId` back-reference

7. **Quote → QuoteVersion**
   - One quote can have multiple versions
   - Relationship: One-to-Many (Quote → Quote Versions)

8. **CPQ Configuration → Customer**
   - One customer can have multiple configurations
   - Relationship: One-to-Many (Customer → CPQ Configurations)

9. **User → (Authentication)**
   - Users are independent entities used for OAuth2 authentication
   - No direct relationships to other collections

---

## Design Decisions

### 1. Unified Pricing Collection (Product, Plan, Price)

**Decision**: Store Product, Plan, and Price in a single `prices` collection, differentiated by the `object` field.

**Rationale**:
- **Efficient Hierarchical Queries**: Single collection allows efficient queries across the hierarchy using `lookupKey` and `object` fields
- **Referential Integrity**: Easy to enforce that prices require plans, and plans require products
- **Simplified Data Model**: Single collection reduces complexity compared to three separate collections
- **Flexible Indexing**: Can index on `object`, `code`, and `lookupKey` for fast lookups
- **Atomic Operations**: Can perform operations on related objects in a single transaction

**Pattern**:
- Use `object` field to differentiate: `PRODUCT`, `PLAN`, `PRICE`
- Use `lookupKey` for hierarchy: Plan references Product code, Price references Plan code
- Use `code` as unique identifier for each object type

### 2. Embedding vs Referencing

#### Embedded Documents
- `Quote.approvalInfo` - Embedded as it's quote-specific and rarely updated independently
- `PricingRule.tiers[]` - Embedded as tiers are rule-specific
- `CPQConfiguration.products[]` - Embedded as products are configuration-specific
- `CPQConfiguration.attributes` - Embedded as attributes are configuration-specific
- `Pricing.recurring` - Embedded as recurring details are price-specific

#### Referenced Documents
- **Quote → QuoteLineItem** - **Referenced** (separate collection)
  - **Reason**: Line items have frequent state updates
  - **Benefit**: Update line item status without updating entire quote document
  - **Pattern**: Quote contains `lineItemIds` array, QuoteLineItem contains `quoteId`

- Quote → Customer, Account (by ID)
- Quote → QuoteVersion (by ID)
- QuoteVersion → Quote (by ID)
- CPQ Configuration → Customer, Account (by ID)
- Price → Discount, Tax (by code reference)

### 3. Denormalization Strategy

**Denormalized Fields for Performance:**
- `QuoteLineItem.quoteNumber` - Denormalized from Quote for easier queries
- `QuoteLineItem.productName` - Denormalized from Product for display
- `QuoteVersion.quoteNumber` - Denormalized for easy lookup

**Benefits:**
- Faster queries without joins
- Reduced complexity in read operations
- Trade-off: Must update denormalized fields when source changes

### 4. Versioning Strategy

- Quotes use version numbers and maintain reference to previous version
- Quote versions collection stores complete snapshots for audit trail
- Only one version marked as `isCurrentVersion: true` per quote
- Version numbers start at 1 and increment for each update

### 5. Effective Date Management

- All pricing-related entities support `effectiveFrom` and `effectiveTo` dates
- Queries filter by current date to get active records
- Allows for future-dated pricing and historical pricing
- Pattern: `{ effectiveFrom: { $lte: now }, $or: [ { effectiveTo: null }, { effectiveTo: { $gte: now } } ] }`

### 6. State Management

- Quote line items have independent state lifecycle
- Status transitions: PENDING → CONFIGURED → PRICED → APPROVED → FULFILLED
- State changes are frequent and don't require quote document updates
- Separate collection allows efficient state updates

### 7. Index Strategy

- **Unique indexes** on business identifiers (`quoteNumber`, `discountCode`, `username`, `email`)
- **Single field indexes** on frequently queried fields
- **Compound indexes** for common query patterns (see Recommended Compound Indexes section)
- **Index on status fields** for workflow queries

### 8. Quote Line Item Design

**Decision**: Separate collection instead of embedded array

**Reasons**:
- Line items have frequent state updates
- Independent querying of line items
- Better performance for status-based queries
- Scalability for quotes with many line items
- Concurrent updates to different line items

**Pattern**:
- Quote document contains `lineItemIds: [String]` array
- QuoteLineItem documents contain `quoteId` back-reference
- Both `quoteId` and `quoteNumber` indexed for efficient lookups

---

## Example Documents

### Complete Quote with Line Items

#### Quote Document
```json
{
  "_id": "507f1f77bcf86cd799439016",
  "quoteNumber": "QT-2024-ABC12345",
  "version": 1,
  "customerId": "CUST-001",
  "accountId": "ACC-001",
  "status": "APPROVED",
  "lineItemIds": ["507f1f77bcf86cd799439017", "507f1f77bcf86cd799439019"],
  "subtotal": 1499.90,
  "totalDiscount": 10.00,
  "totalTax": 106.20,
  "totalAmount": 1596.10,
  "currency": "USD",
  "discountCode": "SAVE10",
  "expirationDate": "2024-03-01T23:59:59Z",
  "expired": false,
  "createdAt": "2024-02-01T09:00:00Z",
  "updatedAt": "2024-02-01T14:30:00Z"
}
```

#### Line Item Documents
```json
[
  {
    "_id": "507f1f77bcf86cd799439017",
    "quoteId": "507f1f77bcf86cd799439016",
    "quoteNumber": "QT-2024-ABC12345",
    "lineNumber": 1,
    "productId": "PROD-001",
    "productName": "Premium Subscription",
    "quantity": 10,
    "unitPrice": 99.99,
    "discountAmount": 10.00,
    "taxAmount": 16.20,
    "lineTotal": 1006.10,
    "currency": "USD",
    "status": "APPROVED",
    "createdAt": "2024-02-01T09:00:00Z",
    "updatedAt": "2024-02-01T14:30:00Z"
  },
  {
    "_id": "507f1f77bcf86cd799439019",
    "quoteId": "507f1f77bcf86cd799439016",
    "quoteNumber": "QT-2024-ABC12345",
    "lineNumber": 2,
    "productId": "PROD-002",
    "productName": "Enterprise Support",
    "quantity": 1,
    "unitPrice": 500.00,
    "discountAmount": 0.00,
    "taxAmount": 90.00,
    "lineTotal": 590.00,
    "currency": "USD",
    "status": "APPROVED",
    "createdAt": "2024-02-01T09:00:00Z",
    "updatedAt": "2024-02-01T14:30:00Z"
  }
]
```

---

## Data Types and Conventions

### Data Types
- **ObjectId/String**: MongoDB ObjectId or custom string identifier
- **Decimal**: BigDecimal in Java, stored as Decimal128 in MongoDB for precision
- **DateTime**: LocalDateTime in Java, stored as ISODate in MongoDB
- **Enum**: Stored as String in MongoDB
- **Array**: MongoDB array type
- **Object**: MongoDB embedded document

### Naming Conventions
- Collection names: `snake_case` (e.g., `quote_line_items`)
- Field names: `camelCase` (e.g., `quoteNumber`, `lineItemIds`)
- Enum values: `UPPER_SNAKE_CASE` (e.g., `PENDING_APPROVAL`)

### Timestamp Format
- All timestamps stored in ISO 8601 format: `2024-02-01T09:00:00Z`
- Timezone: UTC

### Currency Format
- Currency codes follow ISO 4217 standard (USD, EUR, INR, etc.) and are stored in lowercase (e.g., "usd", "eur", "inr")
- Monetary amounts stored as Decimal for precision
- **Unit amounts are in decimal format** (e.g., 10.10 for $10.10 USD, not in smallest currency unit)

### ID Generation
- MongoDB ObjectId for `_id` fields
- Business identifiers follow patterns:
  - Quote: `QT-{YEAR}-{RANDOM}`
  - Discount: Custom code (e.g., `SAVE10`)

---

## Query Patterns

### Common Queries

#### 1. Get Product by Code
```javascript
db.prices.findOne({
  object: "PRODUCT",
  code: "prod_NWjs8kKbJWmuuc",
  active: true
})
```

#### 2. Get All Plans for a Product
```javascript
db.prices.find({
  object: "PLAN",
  lookupKey: "prod_NWjs8kKbJWmuuc",
  active: true
})
```

#### 3. Get All Prices for a Plan
```javascript
db.prices.find({
  object: "PRICE",
  lookupKey: "plan_NWjs8kKbJWmuuc",
  active: true
})
```

#### 4. Get Active Price for a Plan (with effective date check)
```javascript
db.prices.find({
  object: "PRICE",
  lookupKey: "plan_NWjs8kKbJWmuuc",
  active: true,
  priceEffectiveFrom: { $lte: new Date() },
  $or: [
    { priceEffectiveTo: null },
    { priceEffectiveTo: { $gte: new Date() } }
  ]
})
```

#### 5. Get Complete Product Hierarchy
```javascript
// Step 1: Get product
const product = db.prices.findOne({
  object: "PRODUCT",
  code: "prod_NWjs8kKbJWmuuc"
})

// Step 2: Get all plans for product
const plans = db.prices.find({
  object: "PLAN",
  lookupKey: product.code,
  active: true
}).toArray()

// Step 3: Get all prices for each plan
const plansWithPrices = plans.map(plan => {
  const prices = db.prices.find({
    object: "PRICE",
    lookupKey: plan.code,
    active: true
  }).toArray()
  return { ...plan, prices }
})
```

#### 6. Get Quote with Line Items
```javascript
// Step 1: Get quote
const quote = db.quotes.findOne({ quoteNumber: "QT-2024-ABC12345" })

// Step 2: Get line items
const lineItems = db.quote_line_items.find({
  quoteId: quote._id
}).sort({ lineNumber: 1 })
```

#### 7. Get Line Items by Status
```javascript
db.quote_line_items.find({
  status: "PENDING"
})
```

#### 8. Get Quotes by Customer
```javascript
db.quotes.find({
  customerId: "CUST-001",
  status: { $in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] }
}).sort({ createdAt: -1 })
```

#### 9. Update Line Item Status
```javascript
db.quote_line_items.updateOne(
  { _id: ObjectId("507f1f77bcf86cd799439017") },
  {
    $set: {
      status: "APPROVED",
      updatedAt: new Date(),
      updatedBy: "APPROVER-001"
    }
  }
)
```

#### 10. Get Active Discount by Code
```javascript
db.discounts.find({
  discountCode: "SAVE10",
  active: true,
  effectiveFrom: { $lte: new Date() },
  $or: [
    { effectiveTo: null },
    { effectiveTo: { $gte: new Date() } }
  ]
})
```

#### 11. Get Active Taxes for Product and Region
```javascript
db.taxes.find({
  productId: "PROD-001",
  region: "US-CA",
  active: true,
  effectiveFrom: { $lte: new Date() },
  $or: [
    { effectiveTo: null },
    { effectiveTo: { $gte: new Date() } }
  ]
})
```

#### 12. Get User by Username
```javascript
db.users.findOne({
  username: "john.doe",
  enabled: true
})
```

---

## Notes

- All monetary amounts are stored as `Decimal` (BigDecimal in Java) for precision
- **Unit amounts are in decimal format** (e.g., 10.10 for $10.10 USD, not in smallest currency unit)
- All timestamps are stored as `DateTime` (LocalDateTime in Java) in ISO 8601 format
- Currency codes follow ISO 4217 standard (USD, EUR, INR, etc.) and are stored in lowercase (e.g., "usd", "eur")
- All collections support soft deletion through `active` flag where applicable
- Audit fields (`created`, `updated`) are maintained for all pricing entities
- Version numbers start at 1 and increment for each update
- Quote numbers follow pattern: `QT-{YEAR}-{RANDOM}`
- Line items are stored in separate collection for efficient state updates
- Denormalized fields are used strategically for query performance
- Passwords are encrypted using BCrypt before storage
- User roles follow Spring Security convention: `ROLE_*` prefix
- **Pricing hierarchy**: Products, Plans, and Prices are stored in a single `prices` collection, differentiated by the `object` field
- **Data integrity**: Prices require plans, plans require products. Products must have at least one plan when created, and each plan must have at least one price

---

**Document End**
