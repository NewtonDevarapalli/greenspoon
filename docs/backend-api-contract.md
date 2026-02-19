# Green Spoon Backend API Contract

This is the backend contract used by the Angular frontend in this repository.

The current frontend supports:
- Order creation and status updates
- Razorpay order and payment verification
- Manual WhatsApp confirmation flow
- Delivery tracking timeline
- Role-based auth for admin/dispatch operations

Runtime persistence:
- PostgreSQL database via Prisma ORM (no JSON file storage in backend runtime)

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

App role:
- `platform_admin`
- `restaurant_owner`
- `manager`
- `dispatch`
- `kitchen`
- `rider`
- `customer`

Subscription plan:
- `monthly`
- `quarterly`
- `yearly`

Subscription status:
- `trial`
- `active`
- `past_due`
- `suspended`
- `cancelled`

Currency:
- `INR`

Tenant:
- `tenantId` identifies restaurant/account boundary in SaaS mode.
- Non-platform users are restricted to their own `tenantId`.
- Platform admin can access all tenants.

## 3) Auth Endpoints

### 3.1 Login
`POST /auth/login`

Request:

```json
{
  "email": "admin@greenspoon.com",
  "password": "Admin@123"
}
```

Response `200`:

```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": "15m",
  "refreshToken": "rt_xxx",
  "user": {
    "userId": "u-platform-admin",
    "email": "admin@greenspoon.com",
    "name": "Platform Admin",
    "role": "platform_admin",
    "tenantId": "greenspoon-platform"
  }
}
```

Errors:
- `400` invalid payload
- `401` invalid credentials

### 3.2 Refresh Access Token
`POST /auth/refresh`

Request:

```json
{
  "refreshToken": "rt_xxx"
}
```

Response `200`:

```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": "15m",
  "user": {
    "userId": "u-platform-admin",
    "email": "admin@greenspoon.com",
    "name": "Platform Admin",
    "role": "platform_admin",
    "tenantId": "greenspoon-platform"
  }
}
```

Errors:
- `400` invalid payload
- `401` invalid/expired refresh token

### 3.3 Logout
`POST /auth/logout`

Headers:
- `Authorization: Bearer <accessToken>`

Request:

```json
{
  "refreshToken": "rt_xxx"
}
```

Response `200`:

```json
{
  "ok": true
}
```

### 3.4 Current Session
`GET /auth/me`

Headers:
- `Authorization: Bearer <accessToken>`

Response `200`: authenticated user profile.

## 4) Tenant + Subscription Endpoints

### 4.1 Plan Catalog
`GET /subscriptions/plans`

Response `200`:

```json
[
  { "plan": "monthly", "durationDays": 30, "amount": 4999, "currency": "INR" },
  { "plan": "quarterly", "durationDays": 90, "amount": 13999, "currency": "INR" },
  { "plan": "yearly", "durationDays": 365, "amount": 49999, "currency": "INR" }
]
```

### 4.2 List Tenants (Platform Admin)
`GET /tenants`

Headers:
- `Authorization: Bearer <accessToken>`

### 4.3 Create Tenant (Platform Admin)
`POST /tenants`

Headers:
- `Authorization: Bearer <accessToken>`

Request:

```json
{
  "tenantId": "greenspoon-tenant-a",
  "name": "Green Spoon Tenant A",
  "plan": "monthly",
  "status": "trial"
}
```

### 4.4 Get Tenant Subscription
`GET /tenants/:tenantId/subscription`

Headers:
- `Authorization: Bearer <accessToken>`

### 4.5 Replace Tenant Subscription (Platform Admin)
`PUT /tenants/:tenantId/subscription`

Headers:
- `Authorization: Bearer <accessToken>`

Request:

```json
{
  "plan": "quarterly",
  "status": "active",
  "startAt": 1740000000000
}
```

### 4.6 Update Subscription Status (Platform Admin)
`PATCH /tenants/:tenantId/subscription/status`

Headers:
- `Authorization: Bearer <accessToken>`

Request:

```json
{
  "status": "suspended"
}
```

## 5) Payment Endpoints

### 5.1 Create Razorpay Order
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

### 5.2 Verify Razorpay Payment
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

## 6) Order Endpoints

### 6.1 Create Order
`POST /orders`

This is called after successful Razorpay verification, or after manual WhatsApp payment approval.

Request:

```json
{
  "orderId": "GS-123456-111",
  "tenantId": "greenspoon-demo-tenant",
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
- `tenantId`: optional; platform admin may set it explicitly
- for authenticated non-platform users backend forces `tenantId` from token
- for anonymous order creation backend uses `DEFAULT_TENANT_ID`
- `customer.name`, `customer.phone`: required
- `address.line1`, `address.city`: required
- `items`: required, at least one item
- `totals.grandTotal`: required, number
- `paymentMethod`: `razorpay` or `whatsapp`
- `paymentReference`: required
- `deliveryFeeMode`: optional, defaults to `prepaid`
- `deliveryFeeSettlementStatus`: optional, backend can default by mode
- tenant must have subscription status `active` or `trial` for order processing

Response `201`:

```json
{
  "orderId": "GS-123456-111",
  "tenantId": "greenspoon-demo-tenant",
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
- `402` tenant subscription inactive

### 6.2 Request Customer Lookup OTP
`POST /orders/customer/request-otp`

Use this endpoint for customer self-service lookup without exposing admin order APIs.

Request:

```json
{
  "phone": "919000000000",
  "tenantId": "greenspoon-demo-tenant"
}
```

Notes:
- `tenantId` is optional for anonymous users and defaults to `DEFAULT_TENANT_ID`
- authenticated non-platform users are always scoped to their token tenant

Response `200`:

```json
{
  "requestId": "otp_1740000000000_123",
  "expiresAt": 1740000300000,
  "debugOtp": "4721"
}
```

`debugOtp` is returned only when `ENABLE_DEBUG_OTP=true`.

### 6.3 Lookup Customer Orders With OTP
`POST /orders/customer/lookup`

Request:

```json
{
  "phone": "919000000000",
  "requestId": "otp_1740000000000_123",
  "otpCode": "4721"
}
```

Response `200`: matching orders for that phone and tenant (same structure as `GET /orders/:orderId`, but array).

Errors:
- `400` invalid payload / invalid OTP / expired request
- `403` cross-tenant lookup attempt blocked

### 6.4 Get Order
`GET /orders/:orderId`

Response `200`: full order record  
If an auth token is present, backend enforces tenant access and returns `404` for cross-tenant order ids.  
Response `404`: not found

### 6.5 List Orders
`GET /orders`

Headers:
- `Authorization: Bearer <accessToken>`

Allowed roles:
- `platform_admin`, `restaurant_owner`, `manager`, `dispatch`, `kitchen`

Optional query:
- `status=confirmed|preparing|out_for_delivery|delivered|cancelled`
- `from=<ISO date>`
- `to=<ISO date>`
- `limit=<number>`
- `offset=<number>`
- `tenantId=<string>` (platform admin only)

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

### 6.6 Update Order Status
`PATCH /orders/:orderId/status`

Headers:
- `Authorization: Bearer <accessToken>`

Allowed roles:
- `platform_admin`, `restaurant_owner`, `manager`, `kitchen`

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

### 6.7 Confirm Delivered Order
`POST /orders/:orderId/delivery-confirmation`

Headers:
- `Authorization: Bearer <accessToken>`

Allowed roles:
- `platform_admin`, `restaurant_owner`, `manager`, `dispatch`, `rider`

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

## 7) Tracking Endpoints (Recommended for Real Live Tracking)

The current UI can run local simulated tracking. For production tracking, expose these APIs.

### 7.1 Get Current Tracking State
`GET /tracking/:orderId`

Response `200`:

```json
{
  "orderId": "GS-123456-111",
  "tenantId": "greenspoon-demo-tenant",
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

### 7.2 Push Agent Location
`POST /tracking/:orderId/location`

Headers:
- `Authorization: Bearer <accessToken>`

Allowed roles:
- `platform_admin`, `restaurant_owner`, `manager`, `dispatch`, `rider`

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

## 8) WhatsApp Confirmation Endpoint (Operations Helper)

Manual WhatsApp confirmation is currently sent by staff. If you want backend-assisted logging/audit:

`POST /notifications/whatsapp/confirmation`

Headers:
- `Authorization: Bearer <accessToken>`

Allowed roles:
- `platform_admin`, `restaurant_owner`, `manager`, `dispatch`

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

## 9) Frontend Integration Switch

The frontend chooses API mode by environment config:
- `environment.api.orderApiMode = 'local' | 'http'`
- `environment.api.baseUrl = 'http://localhost:3000' | your API URL`

To enable backend mode:
1. Set `orderApiMode` to `http` in `src/environments/environment.ts`
2. Ensure all endpoints in this document are implemented
3. Keep response payload keys exactly as documented

## 10) Suggested Database Tables

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
