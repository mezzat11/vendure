import { Channel, Logger, Order, RequestContext } from '@vendure/core';
import { TamaraClientFactory } from 'tamara-sdk';
import { ApiConfiguration, defaultApiConfiguration } from 'tamara-sdk/dist/configuration/apiConfiguration';
import { ITamaraApiClient } from 'tamara-sdk/dist/consumer/iTamaraApiClient';
import { Money } from 'tamara-sdk/dist/models/common/money';
import { MerchantUrl } from 'tamara-sdk/dist/models/order/merchantUrl';
import { Order as TamaraOrder } from 'tamara-sdk/dist/models/order/order';
import { OrderItem } from 'tamara-sdk/dist/models/order/orderItem';

import { loggerCtx } from './constants';
import { TamaraCheckoutInput, TamaraPaymentMethodArgs, TamaraPluginOptions } from './tamara.types';

const DEFAULT_SANDBOX_BASE_URL = 'https://api-sandbox.tamara.co';
const DEFAULT_PRODUCTION_BASE_URL = 'https://api.tamara.co';

function cloneConfiguration(source: ApiConfiguration): ApiConfiguration {
    return {
        ...source,
        paths: source.paths ? { ...source.paths } : undefined,
        logger: source.logger ? { ...source.logger } : undefined,
    };
}

export function createTamaraApiConfiguration(
    args: TamaraPaymentMethodArgs,
    options: TamaraPluginOptions,
): ApiConfiguration {
    const defaults = cloneConfiguration(defaultApiConfiguration);
    const environmentBaseUrl =
        options.environment === 'production' ? DEFAULT_PRODUCTION_BASE_URL : DEFAULT_SANDBOX_BASE_URL;
    const baseConfig: ApiConfiguration = {
        ...defaults,
        ...options.apiConfiguration,
        baseUrl: args.baseUrl ?? options.apiConfiguration?.baseUrl ?? environmentBaseUrl,
        apiToken: args.apiToken,
        notificationPrivateKey:
            args.notificationToken ??
            options.apiConfiguration?.notificationPrivateKey ??
            defaults.notificationPrivateKey ??
            '',
    };
    if (defaults.paths || options.apiConfiguration?.paths) {
        baseConfig.paths = {
            ...defaults.paths,
            ...options.apiConfiguration?.paths,
        } as ApiConfiguration['paths'];
    }
    if (defaults.logger || options.apiConfiguration?.logger) {
        baseConfig.logger = {
            ...defaults.logger,
            ...options.apiConfiguration?.logger,
        } as ApiConfiguration['logger'];
    }
    if (!baseConfig.clientVersion) {
        baseConfig.clientVersion = 'vendure-payments-plugin';
    }
    return baseConfig;
}

export function createTamaraClient(
    args: TamaraPaymentMethodArgs,
    options: TamaraPluginOptions,
): ITamaraApiClient {
    const configuration = createTamaraApiConfiguration(args, options);
    return TamaraClientFactory.createApiClient(configuration);
}

export function toTamaraMoney(amount: number, currencyCode: string): Money {
    return {
        currency: currencyCode,
        amount: Number((amount / 100).toFixed(2)),
    };
}

export function tamaraMoneyToMinorUnits(money?: Money | null): number | undefined {
    if (!money) {
        return;
    }
    return Math.round(money.amount * 100);
}

function resolveAddress(order: Order) {
    return order.shippingAddress ?? order.billingAddress;
}

function splitFullName(fullName: string | undefined): { firstName: string; lastName: string } {
    if (!fullName) {
        return { firstName: '', lastName: '' };
    }
    const parts = fullName.split(' ').filter(Boolean);
    if (parts.length === 0) {
        return { firstName: fullName, lastName: '' };
    }
    if (parts.length === 1) {
        return { firstName: parts[0], lastName: '' };
    }
    return {
        firstName: parts.slice(0, -1).join(' '),
        lastName: parts.slice(-1).join(' '),
    };
}

function createOrderItems(order: Order): OrderItem[] {
    const items: OrderItem[] = [];
    for (const line of order.lines ?? []) {
        const quantity = Math.max(line.quantity, 1);
        const unitPriceWithTax = line.proratedLinePriceWithTax / quantity;
        const taxAmount = line.proratedLinePriceWithTax - line.proratedLinePrice;
        items.push({
            referenceId: String(line.id),
            type: 'physical',
            name: line.productVariant?.name ?? 'Item',
            sku: line.productVariant?.sku ?? line.productVariantId?.toString() ?? '',
            imageUrl: line.featuredAsset?.preview ?? '',
            quantity,
            taxAmount: toTamaraMoney(taxAmount, order.currencyCode),
            totalAmount: toTamaraMoney(line.proratedLinePriceWithTax, order.currencyCode),
            unitPrice: toTamaraMoney(unitPriceWithTax, order.currencyCode),
            discountAmount: toTamaraMoney(0, order.currencyCode),
        });
    }
    for (const shippingLine of order.shippingLines ?? []) {
        const priceWithTax = shippingLine.discountedPriceWithTax;
        items.push({
            referenceId: String(shippingLine.id),
            type: 'shipping_fee',
            name: shippingLine.shippingMethod?.name ?? 'Shipping',
            sku: shippingLine.shippingMethod?.code ?? 'shipping',
            imageUrl: '',
            quantity: 1,
            taxAmount: toTamaraMoney(priceWithTax - shippingLine.discountedPrice, order.currencyCode),
            totalAmount: toTamaraMoney(priceWithTax, order.currencyCode),
            unitPrice: toTamaraMoney(priceWithTax, order.currencyCode),
            discountAmount: toTamaraMoney(0, order.currencyCode),
        });
    }
    for (const surcharge of order.surcharges ?? []) {
        const taxAmount = surcharge.priceWithTax - surcharge.price;
        items.push({
            referenceId: String(surcharge.id),
            type: 'surcharge',
            name: surcharge.description,
            sku: surcharge.sku ?? 'surcharge',
            imageUrl: '',
            quantity: 1,
            taxAmount: toTamaraMoney(taxAmount, order.currencyCode),
            totalAmount: toTamaraMoney(surcharge.priceWithTax, order.currencyCode),
            unitPrice: toTamaraMoney(surcharge.priceWithTax, order.currencyCode),
            discountAmount: toTamaraMoney(0, order.currencyCode),
        });
    }
    return items;
}

export function mergeMerchantUrls(input: TamaraCheckoutInput, options: TamaraPluginOptions): MerchantUrl {
    return {
        successUrl: input.successUrl,
        failureUrl: input.failureUrl,
        cancelUrl: input.cancelUrl,
        notificationUrl: input.notificationUrl ?? options.defaultMerchantUrls?.notificationUrl ?? '',
    };
}

export function buildTamaraOrder(
    ctx: RequestContext,
    order: Order,
    channel: Channel,
    input: TamaraCheckoutInput,
    options: TamaraPluginOptions,
): TamaraOrder {
    const address = resolveAddress(order);
    if (!address) {
        Logger.warn(`Order ${order.code} is missing an address, required for Tamara checkout`, loggerCtx);
    }
    const { firstName, lastName } =
        order.customer?.firstName && order.customer?.lastName
            ? { firstName: order.customer.firstName, lastName: order.customer.lastName }
            : splitFullName(address?.fullName);
    const defaultCountryFromLanguage =
        typeof channel.defaultLanguageCode === 'string'
            ? channel.defaultLanguageCode.split('_')[1]
            : undefined;
    const countryCode = (
        input.countryCode ??
        address?.countryCode ??
        defaultCountryFromLanguage ??
        'AE'
    ).toUpperCase();
    const locale = input.locale ?? ctx.languageCode ?? channel.defaultLanguageCode;
    const billingAddress = order.billingAddress ?? order.shippingAddress;
    const shippingAddress = order.shippingAddress ?? order.billingAddress;
    const totalDiscountRaw = order.discounts?.reduce((sum, discount) => sum + discount.amountWithTax, 0) ?? 0;
    const totalDiscount = Math.abs(totalDiscountRaw);
    const discountAmount =
        totalDiscount > 0
            ? {
                  name: 'Order discount',
                  amount: toTamaraMoney(totalDiscount, order.currencyCode),
              }
            : undefined;
    return {
        referenceId: order.code,
        consumer: {
            firstName,
            lastName,
            phoneNumber: input.phoneNumber ?? address?.phoneNumber ?? order.customer?.phoneNumber ?? '',
            email: order.customer?.emailAddress ?? '',
            nationalId: '',
            dateOfBirth: '',
            isFirstOrder: false,
        },
        billingAddress: {
            firstName,
            lastName,
            line1: billingAddress?.streetLine1 ?? '',
            line2: billingAddress?.streetLine2 ?? '',
            region: billingAddress?.province ?? '',
            postalCode: billingAddress?.postalCode ?? '',
            city: billingAddress?.city ?? '',
            countryCode: billingAddress?.countryCode ?? countryCode,
            phoneNumber:
                billingAddress?.phoneNumber ?? input.phoneNumber ?? order.customer?.phoneNumber ?? '',
        },
        shippingAddress: {
            firstName,
            lastName,
            line1: shippingAddress?.streetLine1 ?? '',
            line2: shippingAddress?.streetLine2 ?? '',
            region: shippingAddress?.province ?? '',
            postalCode: shippingAddress?.postalCode ?? '',
            city: shippingAddress?.city ?? '',
            countryCode: shippingAddress?.countryCode ?? countryCode,
            phoneNumber:
                shippingAddress?.phoneNumber ?? input.phoneNumber ?? order.customer?.phoneNumber ?? '',
        },
        totalAmount: toTamaraMoney(order.totalWithTax, order.currencyCode),
        taxAmount: toTamaraMoney(order.totalWithTax - order.total, order.currencyCode),
        shippingAmount: toTamaraMoney(order.shippingWithTax, order.currencyCode),
        paymentType: input.paymentType,
        instalments: input.instalments ?? 1,
        items: createOrderItems(order),
        description: `Order ${order.code}`,
        countryCode,
        locale,
        discountAmount,
        merchantUrl: mergeMerchantUrls(input, options),
        platform: 'Vendure',
        isMobile: input.isMobile ?? false,
        riskAssessment: undefined,
        expiresInMinutes: input.expiresInMinutes ?? 20,
    } as TamaraOrder;
}
