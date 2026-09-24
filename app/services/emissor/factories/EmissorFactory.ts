// app/services/emissor/factories/EmissorFactory.ts

import { IEmissorStrategy } from '../interfaces/IEmissorStrategy';
import { NacionalStrategy } from '../strategies/NacionalStrategy';

export class EmissorFactory {
    static getStrategy(empresa: any): IEmissorStrategy {
        return new NacionalStrategy();
    }
}
