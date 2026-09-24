import { checkIsStaff } from './permissions';

export function roleRequiresMfa(role: string | null | undefined) {
  return role === 'CONTADOR' || checkIsStaff(role || '');
}

export function userNeedsMfa(role: string | null | undefined, enabledAt: Date | string | null | undefined) {
  return roleRequiresMfa(role) || Boolean(enabledAt);
}
