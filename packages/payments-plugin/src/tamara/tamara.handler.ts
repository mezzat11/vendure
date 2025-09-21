import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Logger, PaymentMethodHandler } from '@vendure/core';

import { loggerCtx, TAMARA_PLUGIN_OPTIONS } from './constants';
import { TamaraPaymentMetadata } from './tamara.types';

function isTamaraPaymentMetadata(metadata: unknown): metadata is TamaraPaymentMetadata {
    if (!metadata || typeof metadata !== 'object') {
        return false;
    }
    const candidate = metadata as Record<string, unknown>;
    return (
        typeof candidate.tamaraOrderId === 'string' &&
        typeof candidate.tamaraCheckoutId === 'string' &&
        typeof candidate.status === 'string'
    );
}

function mapTamaraStatus(status: string): 'Authorized' | 'Settled' | 'Declined' | 'Error' {
    switch (status.toLowerCase()) {
        case 'authorised':
        case 'authorized':
        case 'approved':
            return 'Authorized';
        case 'captured':
        case 'paid':
        case 'settled':
            return 'Settled';
        case 'pending':
        case 'initiated':
            return 'Authorized';
        case 'declined':
        case 'failed':
        case 'cancelled':
        case 'canceled':
            return 'Declined';
        default:
            return 'Error';
    }
}

export const tamaraPaymentMethodHandler = new PaymentMethodHandler({
    code: 'tamara',
    description: [{ languageCode: LanguageCode.en, value: 'Tamara payments' }],
    args: {
        apiToken: {
            type: 'string',
            required: true,
            label: [{ languageCode: LanguageCode.en, value: 'API Token' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'The Tamara API token used to authenticate requests.',
                },
            ],
        },
        baseUrl: {
            type: 'string',
            required: false,
            label: [{ languageCode: LanguageCode.en, value: 'API Base URL' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Override the Tamara API base URL. Leave empty to use the environment default.',
                },
            ],
        },
        notificationToken: {
            type: 'string',
            required: false,
            label: [{ languageCode: LanguageCode.en, value: 'Notification token' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Optional notification signing token. This is merged with the plugin defaults when generating the API client.',
                },
            ],
        },
    },
    init(injector) {
        injector.get(TAMARA_PLUGIN_OPTIONS);
    },
    createPayment(ctx, order, amount, args, metadata) {
        if (!isTamaraPaymentMetadata(metadata)) {
            const errorMessage = 'Tamara payment metadata is missing required fields.';
            Logger.error(errorMessage, loggerCtx);
            return {
                amount,
                state: 'Declined' as const,
                transactionId: '',
                errorMessage,
                metadata,
            };
        }
        const state = mapTamaraStatus(metadata.status);
        if (state === 'Error') {
            const errorMessage = `Unexpected Tamara payment status "${metadata.status}".`;
            Logger.error(errorMessage, loggerCtx);
            return {
                amount,
                state: 'Declined' as const,
                transactionId: metadata.tamaraOrderId,
                errorMessage,
                metadata,
            };
        }
        const resolvedAmount = typeof metadata.amount === 'number' ? metadata.amount : amount;
        return {
            amount: resolvedAmount,
            state,
            transactionId: metadata.tamaraOrderId,
            metadata: {
                checkoutId: metadata.tamaraCheckoutId,
                status: metadata.status,
                redirectUrl: metadata.redirectUrl,
                rawResponse: metadata.rawResponse,
            },
        };
    },
    settlePayment() {
        return {
            success: true,
        };
    },
});
