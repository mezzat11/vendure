import { Injectable, OnModuleInit } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { JobQueue } from '../../job-queue/job-queue';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Order } from '../../entity/order/order.entity';
import { BankTransferVerification } from '../../entity/bank-transfer-verification/bank-transfer-verification.entity';
import { OrderService } from './order.service';
import { RequestContextService } from '../helpers/request-context/request-context.service';

@Injectable()
export class BankTransferService implements OnModuleInit {
    private expirationQueue: JobQueue<{ orderId: ID }>;

    constructor(
        private connection: TransactionalConnection,
        private jobQueueService: JobQueueService,
        private orderService: OrderService,
        private requestContextService: RequestContextService,
    ) {}

    async onModuleInit() {
        this.expirationQueue = await this.jobQueueService.createQueue({
            name: 'bank-transfer-expiration',
            process: async job => {
                const ctx = await this.requestContextService.create({ apiType: 'admin' });
                const verification = await this.connection.getRepository(ctx, BankTransferVerification).findOne({
                    where: { order: { id: job.data.orderId } },
                    relations: ['order', 'order.payments'],
                });
                if (verification && !verification.verified) {
                    await this.orderService.cancelOrder(ctx, { orderId: job.data.orderId });
                }
                return {};
            },
        });
    }

    async startVerification(ctx: RequestContext, order: Order) {
        const expiresAt = new Date(Date.now() + 48 * 3600 * 1000);
        const verification = await this.connection.getRepository(ctx, BankTransferVerification).save(
            new BankTransferVerification({ order, verified: false, expiresAt }),
        );
        await this.expirationQueue.add({ orderId: order.id }, { runAt: expiresAt });
        return verification;
    }

    async uploadProof(ctx: RequestContext, orderId: ID, proofUrl: string) {
        const verification = await this.connection.getRepository(ctx, BankTransferVerification).findOne({
            where: { order: { id: orderId } },
        });
        if (!verification) {
            throw new Error('Verification not found');
        }
        verification.uploadedProofUrl = proofUrl;
        return this.connection.getRepository(ctx, BankTransferVerification).save(verification);
    }

    async verify(ctx: RequestContext, orderId: ID, verified: boolean) {
        const verification = await this.connection.getRepository(ctx, BankTransferVerification).findOne({
            where: { order: { id: orderId } },
            relations: ['order', 'order.payments'],
        });
        if (!verification) {
            throw new Error('Verification not found');
        }
        verification.verified = verified;
        await this.connection.getRepository(ctx, BankTransferVerification).save(verification);
        const payment = verification.order.payments[0];
        if (payment) {
            const state = verified ? 'Settled' : 'Cancelled';
            await this.orderService.transitionPaymentToState(ctx, payment.id, state as any);
        }
        return verification;
    }
}
