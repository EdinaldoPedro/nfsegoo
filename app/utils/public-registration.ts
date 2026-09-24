import { CommercialError } from '@/app/utils/commercial-pricing';

export type PublicRegistrationMode = 'OPEN' | 'CLOSED';

export function publicRegistrationMode(environment: NodeJS.ProcessEnv = process.env): PublicRegistrationMode {
  const configured = environment.PUBLIC_REGISTRATION_MODE?.trim().toUpperCase();
  if (configured === 'OPEN' || configured === 'CLOSED') return configured;
  return environment.NODE_ENV === 'production' ? 'CLOSED' : 'OPEN';
}

export function publicRegistrationOpen(environment: NodeJS.ProcessEnv = process.env) {
  return publicRegistrationMode(environment) === 'OPEN';
}

export function requirePublicRegistrationOpen(environment: NodeJS.ProcessEnv = process.env) {
  if (!publicRegistrationOpen(environment)) {
    throw new CommercialError('Novos cadastros estão temporariamente fechados durante o piloto acompanhado. Se você já possui uma conta, entre normalmente.', 503);
  }
}
