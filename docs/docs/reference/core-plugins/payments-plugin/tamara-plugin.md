---
title: "TamaraPlugin"
---

The Tamara payments integration provides a first-class experience for merchants using [Tamara](https://tamara.co/) to offer buy-now-pay-later options such as split payments or pay-later instalments. This page outlines the requirements, configuration steps, storefront workflow, and testing tips for the plugin.

## Requirements

1. A Tamara merchant account with API credentials for the desired environment (sandbox or production).
2. Install the payments plugin and Tamara SDK:

   ```bash
   npm install @vendure/payments-plugin tamara-sdk
   # or
   yarn add @vendure/payments-plugin tamara-sdk
   ```

3. If you intend to capture notifications, generate the notification signing token from the Tamara dashboard.

## Server setup

Register the plugin in your `VendureConfig` and provide any optional defaults:

```ts
import { TamaraPlugin } from '@vendure/payments-plugin/package/tamara';

export const config: VendureConfig = {
  // ...
  plugins: [
    TamaraPlugin.init({
      environment: 'sandbox',
      defaultMerchantUrls: {
        notificationUrl: 'https://example.com/api/tamara/webhook',
      },
    }),
  ],
};
```

Create a payment method in the Admin UI (or via the Admin API) using the handler code `tamara`. Supply the **API Token** generated in the Tamara dashboard, optionally override the **API Base URL** when testing against non-standard environments, and provide the **Notification token** if you verify webhook signatures.

## Storefront workflow

1. Move the active order to the `ArrangingPayment` state.
2. Optionally fetch available payment plans to present instalment options:

   ```graphql
   query TamaraPaymentTypes {
     tamaraPaymentTypes(
       input: { paymentMethodCode: "tamara", countryCode: "AE", amount: 12900 }
     ) {
       name
       description
       minAmount
       maxAmount
       supportedInstalments
     }
   }
   ```

3. Create a checkout session to obtain the Tamara redirect URL:

   ```graphql
   mutation CreateTamaraCheckout {
     createTamaraCheckout(
       input: {
         paymentMethodCode: "tamara"
         successUrl: "https://storefront.example/order/XYZ"
         failureUrl: "https://storefront.example/checkout/failure"
         cancelUrl: "https://storefront.example/checkout/cancelled"
         paymentType: "pay-later"
         instalments: 1
         countryCode: "AE"
         phoneNumber: "+971500000000"
       }
     ) {
       checkoutUrl
       checkoutId
       orderId
     }
   }
   ```

4. Redirect the shopper to the returned `checkoutUrl`.
5. When Tamara redirects back to the storefront (or when you receive a notification), call `addPaymentToOrder` with the metadata produced by the Tamara API:

   ```graphql
   mutation CompleteTamaraPayment($orderCode: String!, $metadata: JSON!) {
     addPaymentToOrder(
       input: {
         method: "tamara"
         metadata: {
           tamaraOrderId: "ord_123"
           tamaraCheckoutId: "chk_123"
           status: "captured"
           amount: 12900
         }
       }
     ) {
       ... on Order {
         state
         payments {
           id
           state
           transactionId
         }
       }
     }
   }
   ```

The handler accepts Tamara statuses of `authorized`, `captured`, `pending`, or `declined` and maps them to the Vendure payment states automatically. When the metadata reports a captured payment the order immediately transitions to `PaymentSettled`.

### Metadata contract

| Field               | Description                                                |
| ------------------- | ---------------------------------------------------------- |
| `tamaraOrderId`     | The order identifier returned by Tamara.                   |
| `tamaraCheckoutId`  | The checkout session identifier.                           |
| `status`            | Tamara payment status (`authorized`, `captured`, etc.).    |
| `amount` (optional) | Amount in minor units (e.g. fils) captured by Tamara.      |
| `redirectUrl`       | Optional URL recorded with the payment for audit purposes. |

## Testing & troubleshooting

- Run `npm run e2e --workspace @vendure/payments-plugin` to execute the included end-to-end coverage.
- Start the dedicated development environment with `npm run dev-server:tamara --workspace @vendure/payments-plugin` to manually exercise the checkout flow against the sandbox API.
- Enable request logging in Tamara by setting `apiConfiguration.logger.useLog` in `TamaraPlugin.init` when diagnosing integration issues.

For more advanced scenarios—such as authorising orders before capture or handling Tamara webhooks—you can extend the plugin by injecting the provided helper utilities exported from `@vendure/payments-plugin/package/tamara`.
