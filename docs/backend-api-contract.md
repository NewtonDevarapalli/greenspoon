# Green Spoon Backend API Contract

This is the backend contract used by the Angular frontend in this repository.

The current frontend supports:
- Order creation and status updates
- Razorpay order and payment verification
- Manual WhatsApp confirmation flow
- Delivery tracking timeline

## 1) Base Configuration

- Dev base URL: `http://localhost:3000`
- Prod base URL: `https://api.greenspoonfoods.com`
- Request and response content type: `application/json`
- Recommended auth for protected endpoints: `Authorization: Bearer <token>`

Error payload format:

```json
{
  "code": "INVALID_PAYLOAD",
  "message": "Phone number is required.",
  "details": {}
}
```

## 2) Shared Types

Order status:
- `created`
- `confirmed`
- `preparing`
- `out_for_delivery`
- `delivered`
- `cancelled`

Payment method:
- `razorpay`
- `whatsapp`

Delivery fee mode:
- `prepaid`
- `collect_at_drop`
- `restaurant_settled`

Delivery fee settlement status:
- `not_applicable`
- `pending_collection`
- `collected`
- `restaurant_settled`

Currency:
- `INR`

## 3) Payment Endpoints

### 3.1 Create Razorpay Order
`POST /payments/razorpay/order`

Request:

```json
{
  "orderReference": "GS-123456-111",
  "amount": 427,
  "currency": "INR"
}
```

Validation:
- `orderReference`: required, unique client-side order id
- `amount`: required, number, greater than zero
- `currency`: required, `INR`

Response `200`:

```json
{
  "provider": "razorpay",
  "providerOrderId": "order_Q1abcde12345",
  "amount": 427,
  "currency": "INR",
  "keyId": "rzp_live_xxxxxxxxx"
}
```

Errors:
- `400` invalid payload
- `500` provider error

### 3.2 Verify Razorpay Payment
`POST /payments/razorpay/verify`

Request:

```json
{
  "orderReference": "GS-123456-111",
  "providerOrderId": "order_Q1abcde12345",
  "paymentId": "pay_Q1abcd1234",
  "signature": "hex_signature_value"
}
```

Server verification rule:
- compute HMAC SHA256 of `<providerOrderId>|<paymentId>` using Razorpay secret
- compare with `signature`

Response `200`:

```json
{
  "verified": true,
  "paymentReference": "pay_Q1abcd1234",
  "message": "Payment verified."
}
```

Failed verification can still return `200` with `verified: false`:

```json
{
  "verified": false,
  "paymentReference": "pay_Q1abcd1234",
  "message": "Payment verification failed."
}
```

Errors:
- `400` invalid payload
- `404` provider order missing
- `500` verification failure

## 4) Order Endpoints

### 4.1 Create Order
`POST /orders`

This is called after successful Razorpay verification, or after manual WhatsApp payment approval.

Request:

```json
{
  "orderId": "GS-123456-111",
  "customer": {
    "name": "Newton",
    "phone": "919000000000",
    "email": "example@domain.com"
  },
  "address": {
    "line1": "Madhapur, Street 12",
    "city": "Hyderabad",
    "notes": "Leave at gate"
  },
  "items": [
    {
      "id": "power-sprouts-bowl",
      "name": "Power Sprouts Bowl",
      "type": "Sprouts",
      "image": "images/food4.png",
      "price": 219,
      "calories": "320 kcal",
      "quantity": 1
    }
  ],
  "totals": {
    "subtotal": 219,
    "deliveryFee": 39,
    "tax": 11,
    "grandTotal": 269,
    "payableNow": 230,
    "deliveryFeeDueAtDrop": 39
  },
  "paymentMethod": "razorpay",
  "paymentReference": "pay_Q1abcd1234",
  "deliveryFeeMode": "collect_at_drop",
  "deliveryFeeSettlementStatus": "pending_collection",
  "deliveryConfirmation": {
    "expectedOtp": "4321",
    "otpVerified": false
  }
}
```

Validation:
- `orderId`: required, unique
- `customer.name`, `customer.phone`: required
- `address.line1`, `address.city`: required
- `items`: required, at least one item
- `totals.grandTotal`: required, number
- `paymentMethod`: `razorpay` or `whatsapp`
- `paymentReference`: required
- `deliveryFeeMode`: optional, defaults to `prepaid`
- `deliveryFeeSettlementStatus`: optional, backend can default by mode

Response `201`:

```json
{
  "orderId": "GS-123456-111",
  "customer": {
    "name": "Newton",
    "phone": "919000000000",
    "email": "example@domain.com"
  },
  "address": {
    "line1": "Madhapur, Street 12",
    "city": "Hyderabad",
    "notes": "Leave at gate"
  },
  "items": [
    {
      "id": "power-sprouts-bowl",
      "name": "Power Sprouts Bowl",
      "type": "Sprouts",
      "image": "images/food4.png",
      "price": 219,
      "calories": "320 kcal",
      "quantity": 1
    }
  ],
  "totals": {
    "subtotal": 219,
    "deliveryFee": 39,
    "tax": 11,
    "grandTotal": 269,
    "payableNow": 230,
    "deliveryFeeDueAtDrop": 39
  },
  "paymentMethod": "razorpay",
  "paymentReference": "pay_Q1abcd1234",
  "deliveryFeeMode": "collect_at_drop",
  "deliveryFeeSettlementStatus": "pending_collection",
  "deliveryConfirmation": {
    "expectedOtp": "4321",
    "otpVerified": false
  },
  "status": "confirmed",
  "createdAt": 1739965000000,
  "updatedAt": 1739965000000
}
```

Errors:
- `400` invalid payload
- `409` duplicate `orderId`

### 4.2 Get Order
`GET /orders/:orderId`

Response `200`: full order record  
Response `404`: not found

### 4.3 List Orders
`GET /orders`

Optional query:
- `status=confirmed|preparing|out_for_delivery|delivered|cancelled`
- `from=<ISO date>`
- `to=<ISO date>`
- `limit=<number>`
- `offset=<number>`

Response `200`:

```json
[
  {
    "orderId": "GS-123456-111",
    "status": "confirmed",
    "createdAt": 1739965000000,
    "updatedAt": 1739965000000
  }
]
```

### 4.4 Update Order Status
`PATCH /orders/:orderId/status`

Request:

```json
{
  "status": "out_for_delivery"
}
```

Allowed transitions:
- `confirmed -> preparing`
- `preparing -> out_for_delivery`
- `confirmed|preparing -> cancelled`

`delivered` status should be set via:
- `POST /orders/:orderId/delivery-confirmation` (OTP + proof + optional fee collection)

Response `200`: updated order record  
Response `400`: invalid transition  
Response `404`: order not found

### 4.5 Confirm Delivered Order
`POST /orders/:orderId/delivery-confirmation`

Use this for OTP verification and delivery fee collection capture.

Request:

```json
{
  "otpCode": "4321",
  "proofNote": "Doorstep handoff and signature received",
  "confirmedBy": "Dispatch Team",
  "collectDeliveryFee": true,
  "collectionAmount": 39,
  "collectionMethod": "cash",
  "collectionNotes": "Exact cash received"
}
```

Response `200`: updated order record with:
- `status = delivered`
- `deliveryConfirmation.otpVerified = true`
- updated `deliveryFeeSettlementStatus`
- optional `deliveryFeeCollection` block

## 5) Tracking Endpoints (Recommended for Real Live Tracking)

The current UI can run local simulated tracking. For production tracking, expose these APIs.

### 5.1 Get Current Tracking State
`GET /tracking/:orderId`

Response `200`:

```json
{
  "orderId": "GS-123456-111",
  "status": "on_the_way",
  "agentName": "Ravi Kumar",
  "agentPhone": "+91 90000 10021",
  "etaMinutes": 14,
  "current": {
    "lat": 17.394511,
    "lng": 78.489101
  },
  "events": [
    {
      "status": "assigned",
      "label": "Delivery agent assigned",
      "time": 1739965100000
    },
    {
      "status": "picked_up",
      "label": "Order picked up from kitchen",
      "time": 1739965600000
    }
  ],
  "updatedAt": 1739966200000
}
```

### 5.2 Push Agent Location
`POST /tracking/:orderId/location`

Request:

```json
{
  "lat": 17.394511,
  "lng": 78.489101,
  "status": "on_the_way",
  "etaMinutes": 14
}
```

Response `200`:

```json
{
  "ok": true
}
```

## 6) WhatsApp Confirmation Endpoint (Operations Helper)

Manual WhatsApp confirmation is currently sent by staff. If you want backend-assisted logging/audit:

`POST /notifications/whatsapp/confirmation`

Request:

```json
{
  "orderId": "GS-123456-111",
  "customerName": "Newton",
  "customerPhone": "919000000000",
  "message": "Hi Newton, your Green Spoon order GS-123456-111 has been received."
}
```

Response `200`:

```json
{
  "queued": true,
  "channel": "whatsapp",
  "providerMessageId": "wamid.HBgM..."
}
```

## 7) Frontend Integration Switch

The frontend chooses API mode by environment config:
- `environment.api.orderApiMode = 'local' | 'http'`
- `environment.api.baseUrl = 'http://localhost:3000' | your API URL`

To enable backend mode:
1. Set `orderApiMode` to `http` in `src/environments/environment.ts`
2. Ensure all endpoints in this document are implemented
3. Keep response payload keys exactly as documented

## 8) Suggested Database Tables

`orders`
- `id` (pk)
- `order_id` (unique)
- `customer_name`
- `customer_phone`
- `customer_email`
- `address_line1`
- `city`
- `notes`
- `subtotal`
- `delivery_fee`
- `tax`
- `grand_total`
- `payment_method`
- `payment_reference`
- `status`
- `created_at`
- `updated_at`

`order_items`
- `id` (pk)
- `order_id` (fk -> orders.id)
- `item_code`
- `name`
- `category`
- `unit_price`
- `quantity`
- `calories`
- `image`

`payment_events`
- `id` (pk)
- `order_id` (fk -> orders.id)
- `provider`
- `provider_order_id`
- `provider_payment_id`
- `signature_valid`
- `raw_payload_json`
- `created_at`

`delivery_tracking`
- `id` (pk)
- `order_id` (fk -> orders.id, unique)
- `agent_name`
- `agent_phone`
- `status`
- `current_lat`
- `current_lng`
- `eta_minutes`
- `updated_at`
