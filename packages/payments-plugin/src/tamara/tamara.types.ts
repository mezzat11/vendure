import type { ApiConfiguration } from 'tamara-sdk/dist/configuration/apiConfiguration';
import type { MerchantUrl } from 'tamara-sdk/dist/models/order/merchantUrl';

export type TamaraEnvironment = 'sandbox' | 'production';

export interface TamaraPluginOptions {
    /**
     * @description Configure which Tamara environment to target.
     * Defaults to `sandbox`.
     */
    environment?: TamaraEnvironment;
    /**
     * @description Override the generated API configuration that is passed to the Tamara SDK.
     */
    apiConfiguration?: Partial<ApiConfiguration>;
    /**
     * @description Provide fallback merchant URLs which are merged with the values supplied by the storefront.
     */
    defaultMerchantUrls?: Partial<MerchantUrl>;
}

export interface TamaraPaymentMethodArgs {
    [key: string]: string | boolean | undefined;
    apiToken: string;
    baseUrl?: string;
    notificationToken?: string;
}

export interface TamaraCheckoutInput {
    paymentMethodCode: string;
    successUrl: string;
    failureUrl: string;
    cancelUrl: string;
    notificationUrl?: string;
    paymentType: string;
    instalments?: number;
    countryCode?: string;
    locale?: string;
    phoneNumber?: string;
    expiresInMinutes?: number;
    isMobile?: boolean;
}

export interface TamaraCheckoutResponse {
    checkoutId: string;
    orderId: string;
    checkoutUrl: string;
}

export interface TamaraPaymentTypesInput {
    paymentMethodCode: string;
    countryCode: string;
    amount?: number;
}

export interface TamaraPaymentTypeSummary {
    name: string;
    description?: string | null;
    minAmount?: number | null;
    maxAmount?: number | null;
    supportedInstalments: number[];
}

export interface TamaraPaymentMetadata {
    tamaraOrderId: string;
    tamaraCheckoutId: string;
    status: string;
    amount?: number;
    redirectUrl?: string;
    rawResponse?: unknown;
}
