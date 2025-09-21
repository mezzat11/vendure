import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import gql from 'graphql-tag';
import nock from 'nock';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type {
    CreatePaymentMethodMutation,
    CreatePaymentMethodMutationVariables,
    LanguageCode,
} from './graphql/generated-admin-types';
import type {
    AddItemToOrderMutation,
    AddItemToOrderMutationVariables,
    AddPaymentToOrderMutation,
    AddPaymentToOrderMutationVariables,
    GetOrderByCodeQuery,
    GetOrderByCodeQueryVariables,
    TestOrderFragmentFragment,
} from './graphql/generated-shop-types';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { TamaraPlugin } from '../src/tamara';
import { tamaraPaymentMethodHandler } from '../src/tamara/tamara.handler';

import { CREATE_PAYMENT_METHOD } from './graphql/admin-queries';
import { ADD_ITEM_TO_ORDER, ADD_PAYMENT, GET_ORDER_BY_CODE } from './graphql/shop-queries';
import { proceedToArrangingPayment, setShipping } from './payment-helpers';

const TAMARA_BASE_URL = 'https://api-sandbox.tamara.co';

const GET_TAMARA_PAYMENT_TYPES = gql`
    query GetTamaraPaymentTypes($input: TamaraPaymentTypesInput!) {
        tamaraPaymentTypes(input: $input) {
            name
            description
            minAmount
            maxAmount
            supportedInstalments
        }
    }
`;

const CREATE_TAMARA_CHECKOUT = gql`
    mutation CreateTamaraCheckout($input: TamaraCheckoutInput!) {
        createTamaraCheckout(input: $input) {
            checkoutId
            orderId
            checkoutUrl
        }
    }
`;

describe('Tamara payments', () => {
    let server: TestServer;
    let shopClient: SimpleGraphQLClient;
    let adminClient: SimpleGraphQLClient;
    let order: TestOrderFragmentFragment;
    const paymentMethodCode = 'tamara-test';
    const originalHttpProxy = process.env.HTTP_PROXY;
    const originalHttpsProxy = process.env.HTTPS_PROXY;
    const originalLowerHttpProxy = process.env.http_proxy;
    const originalLowerHttpsProxy = process.env.https_proxy;
    const originalNpmHttpProxy = process.env.npm_config_http_proxy;
    const originalNpmHttpsProxy = process.env.npm_config_https_proxy;
    const originalNpmProxy = process.env.npm_config_proxy;

    beforeAll(async () => {
        delete process.env.HTTP_PROXY;
        delete process.env.HTTPS_PROXY;
        delete process.env.http_proxy;
        delete process.env.https_proxy;
        delete process.env.npm_config_http_proxy;
        delete process.env.npm_config_https_proxy;
        delete process.env.npm_config_proxy;
        const devConfig = mergeConfig(testConfig(), {
            plugins: [TamaraPlugin.init({ environment: 'sandbox' })],
        });
        const env = createTestEnvironment(devConfig);
        server = env.server;
        shopClient = env.shopClient;
        adminClient = env.adminClient;
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterEach(() => {
        nock.cleanAll();
    });

    afterAll(async () => {
        if (originalHttpProxy) {
            process.env.HTTP_PROXY = originalHttpProxy;
        } else {
            delete process.env.HTTP_PROXY;
        }
        if (originalHttpsProxy) {
            process.env.HTTPS_PROXY = originalHttpsProxy;
        } else {
            delete process.env.HTTPS_PROXY;
        }
        if (originalLowerHttpProxy) {
            process.env.http_proxy = originalLowerHttpProxy;
        } else {
            delete process.env.http_proxy;
        }
        if (originalLowerHttpsProxy) {
            process.env.https_proxy = originalLowerHttpsProxy;
        } else {
            delete process.env.https_proxy;
        }
        if (originalNpmHttpProxy) {
            process.env.npm_config_http_proxy = originalNpmHttpProxy;
        } else {
            delete process.env.npm_config_http_proxy;
        }
        if (originalNpmHttpsProxy) {
            process.env.npm_config_https_proxy = originalNpmHttpsProxy;
        } else {
            delete process.env.npm_config_https_proxy;
        }
        if (originalNpmProxy) {
            process.env.npm_config_proxy = originalNpmProxy;
        } else {
            delete process.env.npm_config_proxy;
        }
        await server.destroy();
    });

    it('creates a Tamara checkout and records the payment', async () => {
        const createPaymentMethodResult = await adminClient.query<
            CreatePaymentMethodMutation,
            CreatePaymentMethodMutationVariables
        >(CREATE_PAYMENT_METHOD, {
            input: {
                code: paymentMethodCode,
                enabled: true,
                translations: [
                    {
                        languageCode: 'en' as LanguageCode,
                        name: 'Tamara test',
                        description: 'Tamara e2e test payment method',
                    },
                ],
                handler: {
                    code: tamaraPaymentMethodHandler.code,
                    arguments: [
                        { name: 'apiToken', value: 'test-token' },
                        { name: 'notificationToken', value: 'secret' },
                    ],
                },
            },
        });
        expect(createPaymentMethodResult.createPaymentMethod?.code).toBe(paymentMethodCode);

        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        const { addItemToOrder } = await shopClient.query<
            AddItemToOrderMutation,
            AddItemToOrderMutationVariables
        >(ADD_ITEM_TO_ORDER, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        order = addItemToOrder as TestOrderFragmentFragment;
        await setShipping(shopClient);
        await proceedToArrangingPayment(shopClient);

        const refreshedOrder = await shopClient.query<GetOrderByCodeQuery, GetOrderByCodeQueryVariables>(
            GET_ORDER_BY_CODE,
            { code: order.code },
        );
        const targetOrder = refreshedOrder.orderByCode as TestOrderFragmentFragment;

        let capturedPaymentTypeQuery: Record<string, string> | undefined;
        const paymentTypesScope = nock(TAMARA_BASE_URL)
            .get('/checkout/payment-types')
            .query(query => {
                capturedPaymentTypeQuery = query as Record<string, string>;
                return true;
            })
            .reply(200, [
                {
                    name: 'pay-later',
                    description: 'Pay later',
                    min_limit: { currency: targetOrder.currencyCode, amount: 1 },
                    max_limit: { currency: targetOrder.currencyCode, amount: 1000 },
                    supported_instalments: [
                        {
                            instalments: 1,
                            min_limit: { currency: targetOrder.currencyCode, amount: 1 },
                            max_limit: { currency: targetOrder.currencyCode, amount: 1000 },
                        },
                    ],
                },
            ]);

        const paymentTypes = await shopClient.query(GET_TAMARA_PAYMENT_TYPES, {
            input: {
                paymentMethodCode,
                countryCode: 'AE',
                amount: targetOrder.totalWithTax,
            },
        });
        expect(paymentTypesScope.isDone()).toBe(true);
        expect(paymentTypes.tamaraPaymentTypes).toHaveLength(1);
        expect(paymentTypes.tamaraPaymentTypes[0].supportedInstalments).toEqual([1]);
        expect(capturedPaymentTypeQuery?.country).toBe('AE');

        let checkoutRequestBody: any;
        const checkoutScope = nock(TAMARA_BASE_URL)
            .post('/checkout', body => {
                checkoutRequestBody = body;
                return true;
            })
            .reply(200, {
                checkout_id: 'chk_test',
                order_id: 'ord_test',
                checkout_url: 'https://checkout.example/ord_test',
            });

        const checkoutResponse = await shopClient.query(CREATE_TAMARA_CHECKOUT, {
            input: {
                paymentMethodCode,
                successUrl: 'https://example.com/success',
                failureUrl: 'https://example.com/failure',
                cancelUrl: 'https://example.com/cancel',
                notificationUrl: 'https://example.com/webhook',
                paymentType: 'pay-later',
                instalments: 1,
                countryCode: 'AE',
                phoneNumber: '+971000000000',
            },
        });
        expect(checkoutResponse.createTamaraCheckout.checkoutId).toBe('chk_test');
        expect(checkoutResponse.createTamaraCheckout.checkoutUrl).toContain('checkout');
        expect(checkoutRequestBody).toBeDefined();
        expect(checkoutScope.isDone()).toBe(true);

        const { addPaymentToOrder } = await shopClient.query<
            AddPaymentToOrderMutation,
            AddPaymentToOrderMutationVariables
        >(ADD_PAYMENT, {
            input: {
                method: paymentMethodCode,
                metadata: {
                    tamaraCheckoutId: 'chk_test',
                    tamaraOrderId: 'ord_test',
                    status: 'captured',
                    amount: targetOrder.totalWithTax,
                },
            },
        });
        const completedOrder = addPaymentToOrder as TestOrderFragmentFragment;
        expect(completedOrder.payments?.[0]?.state).toBe('Settled');
        expect(completedOrder.payments?.[0]?.transactionId).toBe('ord_test');
        expect(completedOrder.state).toBe('PaymentSettled');
    });
});
