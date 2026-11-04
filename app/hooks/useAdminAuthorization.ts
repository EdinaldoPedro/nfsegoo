'use client';
import { useCallback } from 'react';
import { useDialog } from '@/app/contexts/DialogContext';

export function useAdminAuthorization() {
  const dialog = useDialog();
  return useCallback(async (action: string) => {
    return dialog.showAuthorization({ title: 'Autorizar operação',
      description: `Informe a justificativa e sua senha administrativa para ${action}. A operação ficará registrada na auditoria.`,
      confirmText: 'Autorizar' });
  }, [dialog]);
}
