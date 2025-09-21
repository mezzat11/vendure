import { Inject } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    ActiveOrderService,
    Ctx,
    InternalServerError,
    Logger,
    OrderService,
    PaymentMethod,
    RequestContext,
    TransactionalConnection,
    assertFound,
} from '@vendure/core';

import { TAMARA_PLUGIN_OPTIONS, loggerCtx } from './constants';
import {
    buildTamaraOrder,
    createTamaraClient,
    tamaraMoneyToMinorUnits,
    toTamaraMoney,
} from './tamara.helpers';
import {
    TamaraCheckoutInput,
    TamaraCheckoutResponse,
    TamaraPaymentMethodArgs,
    TamaraPaymentTypeSummary,
    TamaraPaymentTypesInput,
    TamaraPluginOptions,
} from './tamara.types';

@Resolver()
export class TamaraResolver {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private activeOrderService: ActiveOrderService,
        @Inject(TAMARA_PLUGIN_OPTIONS) private options: TamaraPluginOptions,
    ) {}

    @Mutation()
    async createTamaraCheckout(
        @Ctx() ctx: RequestContext,
        @Args('input') input: TamaraCheckoutInput,
    ): Promise<TamaraCheckoutResponse> {
        const activeOrder = await this.activeOrderService.getOrderFromContext(ctx);
        if (!activeOrder) {
            throw new InternalServerError('Cannot create Tamara checkout without an active order.');
        }
        const order = await assertFound(
            this.orderService.findOne(ctx, activeOrder.id, [
                'lines',
                'lines.productVariant',
                'lines.featuredAsset',
                'shippingLines',
                'surcharges',
                'customer',
            ]),
        );
        if (!ctx.channel) {
            throw new InternalServerError('Request channel context is missing for Tamara checkout.');
        }
        const args = await this.getPaymentMethodArgs(ctx, input.paymentMethodCode);
        const client = createTamaraClient(args, this.options);
        const tamaraOrder = buildTamaraOrder(ctx, order, ctx.channel, input, this.options);
        const response = await client.createCheckout(tamaraOrder);
        Logger.debug(`Created Tamara checkout for order ${order.code}`, loggerCtx);
        return response.data;
    }

    @Query()
    async tamaraPaymentTypes(
        @Ctx() ctx: RequestContext,
        @Args('input') input: TamaraPaymentTypesInput,
    ): Promise<TamaraPaymentTypeSummary[]> {
        const args = await this.getPaymentMethodArgs(ctx, input.paymentMethodCode);
        const client = createTamaraClient(args, this.options);
        const amount =
            typeof input.amount === 'number'
                ? toTamaraMoney(input.amount, ctx.channel?.defaultCurrencyCode ?? 'SAR')
                : undefined;
        const response = await client.getPaymentTypes(input.countryCode, amount);
        const paymentTypesRaw = Array.isArray(response.data)
            ? response.data
            : Array.isArray((response.data as any)?.paymentTypes)
              ? (response.data as any).paymentTypes
              : Array.isArray((response.data as any)?.payment_types)
                ? (response.data as any).payment_types
                : [];
        const paymentTypes = paymentTypesRaw as any[];
        return paymentTypes.map(paymentType => {
            const minLimit = paymentType.minLimit ?? paymentType.min_limit;
            const maxLimit = paymentType.maxLimit ?? paymentType.max_limit;
            const supportedInstalmentsRaw = Array.isArray(paymentType.supportedInstalments)
                ? paymentType.supportedInstalments
                : Array.isArray(paymentType.supported_instalments)
                  ? paymentType.supported_instalments
                  : [];
            const supportedInstalments = supportedInstalmentsRaw
                .map((instalment: any) => {
                    if (typeof instalment === 'number') {
                        return instalment;
                    }
                    if (typeof instalment?.instalments === 'number') {
                        return instalment.instalments;
                    }
                    if (typeof instalment?.instalment === 'number') {
                        return instalment.instalment;
                    }
                    return undefined;
                })
                .filter((value: number | undefined): value is number => typeof value === 'number');
            return {
                name: paymentType.name ?? paymentType.type ?? '',
                description: paymentType.description ?? paymentType.display_name ?? null,
                minAmount: tamaraMoneyToMinorUnits(minLimit) ?? null,
                maxAmount: tamaraMoneyToMinorUnits(maxLimit) ?? null,
                supportedInstalments,
            };
        });
    }

    private async getPaymentMethodArgs(ctx: RequestContext, code: string): Promise<TamaraPaymentMethodArgs> {
        const paymentMethods = await this.connection.getRepository(ctx, PaymentMethod).find({
            relations: ['channels'],
        });
        const method = paymentMethods.find(
            pm => pm.code === code && pm.channels.some(ch => ch.id === ctx.channelId),
        );
        if (!method) {
            throw new InternalServerError(
                `No Tamara payment method with code "${code}" is configured for the active channel.`,
            );
        }
        return method.handler.args.reduce((acc, arg) => {
            return {
                ...acc,
                [arg.name]: arg.value,
            };
        }, {} as TamaraPaymentMethodArgs);
    }
}
