import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { DefaultLogger, LogLevel, mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import path from 'path';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TamaraPlugin } from '../src/tamara';
import { tamaraPaymentMethodHandler } from '../src/tamara/tamara.handler';

import { CREATE_PAYMENT_METHOD } from './graphql/admin-queries';
import { ADD_ITEM_TO_ORDER } from './graphql/shop-queries';
import { setShipping } from './payment-helpers';

void (async () => {
    registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));
    const baseConfig = testConfig();
    const config = mergeConfig(baseConfig, {
        logger: new DefaultLogger({ level: LogLevel.Debug }),
        plugins: [
            ...(baseConfig.plugins ?? []),
            AdminUiPlugin.init({ route: 'admin', port: 5002 }),
            TamaraPlugin.init({ environment: 'sandbox' }),
        ],
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config as any);
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        customerCount: 1,
    });
    await adminClient.asSuperAdmin();
    await adminClient.query(CREATE_PAYMENT_METHOD, {
        input: {
            code: 'tamara-dev',
            enabled: true,
            translations: [
                {
                    languageCode: 'en',
                    name: 'Tamara dev',
                    description: 'Tamara dev payment method',
                },
            ],
            handler: {
                code: tamaraPaymentMethodHandler.code,
                arguments: [
                    { name: 'apiToken', value: process.env.TAMARA_API_TOKEN ?? 'sandbox-token' },
                    {
                        name: 'notificationToken',
                        value: process.env.TAMARA_NOTIFICATION_TOKEN ?? 'sandbox-secret',
                    },
                ],
            },
        },
    });
    await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
    await shopClient.query(ADD_ITEM_TO_ORDER, {
        productVariantId: 'T_1',
        quantity: 1,
    });
    await setShipping(shopClient);
    // eslint-disable-next-line no-console
    console.log('Tamara dev server ready. Use the shop API playground to call createTamaraCheckout.');
})();
