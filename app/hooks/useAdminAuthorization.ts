'use client';
import { useCallback } from 'react';
import { useDialog } from '@/app/contexts/DialogContext';

export function useAdminAuthorization() {
  const dialog = useDialog();
  return useCallback(async (action: string) => {
    const justification = await dialog.showPrompt({ title: 'Justificativa da operação', description: `Informe o motivo para ${action} (mínimo de dez caracteres).`, confirmText: 'Continuar' });
    if (!justification) return null;
    if (justification.trim().length < 10 || justification.length > 2000) {
      await dialog.showAlert({ type: 'warning', description: 'Use entre dez e dois mil caracteres na justificativa.' }); return null;
    }
    const adminPassword = await dialog.showPrompt({ title: 'Confirme sua identidade', description: 'Digite sua senha para autorizar esta operação auditada.', inputType: 'password', confirmText: 'Autorizar' });
    return adminPassword ? { adminPassword, justification: justification.trim() } : null;
  }, [dialog]);
}
