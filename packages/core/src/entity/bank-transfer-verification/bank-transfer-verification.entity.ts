import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { VendureEntity } from '../base/base.entity';
import { Order } from '../order/order.entity';

@Entity()
export class BankTransferVerification extends VendureEntity {
    constructor(input?: DeepPartial<BankTransferVerification>) {
        super(input);
    }

    @Index()
    @ManyToOne(() => Order, order => order.bankTransferVerification, { onDelete: 'CASCADE' })
    order: Order;

    @Column({ nullable: true })
    uploadedProofUrl?: string;

    @Column({ default: false })
    verified: boolean;

    @Column()
    expiresAt: Date;
}
