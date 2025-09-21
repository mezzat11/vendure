import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';
import { gql } from 'graphql-tag';

import { TAMARA_PLUGIN_OPTIONS } from './constants';
import { tamaraPaymentMethodHandler } from './tamara.handler';
import { TamaraResolver } from './tamara.resolver';
import { TamaraPluginOptions } from './tamara.types';

/**
 * @description
 * The Tamara payments integration enables "buy now pay later" workflows powered by
 * [Tamara](https://tamara.co/). The plugin exposes helpers to create checkout sessions from the storefront,
 * retrieve available payment plans, and process the payment response when the shopper returns to Vendure.
 *
 * ## Setup
 *
 * ```ts
 * import { TamaraPlugin } from '@vendure/payments-plugin/package/tamara';
 *
 * plugins: [
 *   TamaraPlugin.init({
 *     environment: 'sandbox',
 *   }),
 * ];
 * ```
 *
 * After registering the plugin, create a PaymentMethod in the Admin UI using the code `tamara` and
 * configure it with your Tamara API credentials. The storefront can then call the
 * `createTamaraCheckout` mutation to request a checkout URL, and once the shopper is redirected back
 * you can call `addPaymentToOrder` with the Tamara metadata to finalize the order.
 *
 * @docsCategory core plugins/PaymentsPlugin
 * @docsPage TamaraPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        {
            provide: TAMARA_PLUGIN_OPTIONS,
            useFactory: () => TamaraPlugin.options,
        },
    ],
    configuration: config => {
        config.paymentOptions.paymentMethodHandlers.push(tamaraPaymentMethodHandler);
        return config;
    },
    shopApiExtensions: {
        schema: gql`
            type TamaraCheckoutSession {
                checkoutId: String!
                orderId: String!
                checkoutUrl: String!
            }

            type TamaraPaymentType {
                name: String!
                description: String
                minAmount: Int
                maxAmount: Int
                supportedInstalments: [Int!]!
            }

            input TamaraCheckoutInput {
                paymentMethodCode: String!
                successUrl: String!
                failureUrl: String!
                cancelUrl: String!
                notificationUrl: String
                paymentType: String!
                instalments: Int
                countryCode: String
                locale: String
                phoneNumber: String
                expiresInMinutes: Int
                isMobile: Boolean
            }

            input TamaraPaymentTypesInput {
                paymentMethodCode: String!
                countryCode: String!
                amount: Int
            }

            extend type Mutation {
                createTamaraCheckout(input: TamaraCheckoutInput!): TamaraCheckoutSession!
            }

            extend type Query {
                tamaraPaymentTypes(input: TamaraPaymentTypesInput!): [TamaraPaymentType!]!
            }
        `,
        resolvers: [TamaraResolver],
    },
    compatibility: '^3.0.0',
})
export class TamaraPlugin {
    static options: TamaraPluginOptions = {};

    static init(options: TamaraPluginOptions = {}): Type<TamaraPlugin> {
        TamaraPlugin.options = options;
        return TamaraPlugin;
    }
}
