import { LanguageCode } from '@vendure/common/lib/generated-types';
import { CreatePaymentResult, PaymentMethodHandler, SettlePaymentResult } from './payment-method-handler';

export const codPaymentHandler = new PaymentMethodHandler({
    code: 'cash-on-delivery',
    description: [{ languageCode: LanguageCode.en, value: 'Cash on Delivery' }],
    args: {},
    createPayment: async (ctx, order, amount): Promise<CreatePaymentResult> => {
        return {
            amount,
            state: 'Settled' as const,
            transactionId: order.code + '-cod',
        };
    },
    settlePayment: async (): Promise<SettlePaymentResult> => ({ success: true }),
});
