'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { adminHome } from '@/app/utils/admin-navigation';

export default function Page() {
  const router = useRouter();
  useEffect(() => { router.replace(adminHome(localStorage.getItem('userRole'))); }, [router]);
  return <p role="status" className="text-sm text-slate-500">Abrindo a visão geral…</p>;
}
