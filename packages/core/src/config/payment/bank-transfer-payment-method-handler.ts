import { LanguageCode } from '@vendure/common/lib/generated-types';
import { CreatePaymentResult, PaymentMethodHandler, SettlePaymentResult } from './payment-method-handler';
import { BankTransferService } from '../../service/services/bank-transfer.service';

let bankTransferService: BankTransferService;

export const bankTransferPaymentHandler = new PaymentMethodHandler({
    code: 'bank-transfer',
    description: [{ languageCode: LanguageCode.en, value: 'Bank Transfer' }],
    args: {},
    init(injector) {
        bankTransferService = injector.get(BankTransferService);
    },
    createPayment: async (ctx, order, amount): Promise<CreatePaymentResult> => {
        if (!bankTransferService) {
            throw new Error('BankTransferService not initialized');
        }
        await bankTransferService.startVerification(ctx, order);
        return {
            amount,
            state: 'Pending' as const,
            transactionId: order.code + '-bank-transfer',
        };
    },
    settlePayment: async (): Promise<SettlePaymentResult> => ({ success: true }),
});
