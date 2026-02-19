# Green Spoon Backend

Minimal Express backend implementing the API contract used by the frontend.

## Setup

```bash
npm install
npm start
```

Default URL: `http://localhost:3000`

## Environment

Copy `.env.example` values into your shell/environment:

- `PORT`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `CORS_ORIGIN`

## Endpoints

- `GET /health`
- `POST /payments/razorpay/order`
- `POST /payments/razorpay/verify`
- `POST /orders`
- `GET /orders`
- `GET /orders/:orderId`
- `PATCH /orders/:orderId/status`
- `GET /tracking/:orderId`
- `POST /tracking/:orderId/location`
- `POST /notifications/whatsapp/confirmation`

## Notes

- Data is stored in JSON files under `backend/data/`.
- This backend is suitable for development and contract testing.
- Replace JSON file storage with a database for production.
