'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { usePathname } from 'next/navigation'; // <--- Importante para detectar navegação
import { redirectToLogin } from '@/app/utils/client-session';

const dictionary: any = {
  'pt-BR': {
    menu: { dashboard: 'Visão Geral', clients: 'Meus Clientes', invoices: 'Notas Emitidas', support: 'Suporte Técnico', settings: 'Minha Conta', logout: 'Sair' },
    general: { welcome: 'Olá', environment: 'Ambiente' },
    actions: { save: 'Salvar', cancel: 'Cancelar', loading: 'Processando...' }
  },
  'en-US': {
    menu: { dashboard: 'Dashboard', clients: 'My Clients', invoices: 'Invoices', support: 'Tech Support', settings: 'My Account', logout: 'Logout' },
    general: { welcome: 'Hello', environment: 'Environment' },
    actions: { save: 'Save', cancel: 'Cancel', loading: 'Processing...' }
  },
  'es-ES': {
    menu: { dashboard: 'Panel General', clients: 'Mis Clientes', invoices: 'Facturas', support: 'Soporte Técnico', settings: 'Mi Cuenta', logout: 'Salir' },
    general: { welcome: 'Hola', environment: 'Ambiente' },
    actions: { save: 'Guardar', cancel: 'Cancelar', loading: 'Procesando...' }
  }
};

type Language = 'pt-BR' | 'en-US' | 'es-ES';

interface AppConfigContextType {
  darkMode: boolean;
  toggleDarkMode: (value: boolean) => void;
  language: Language;
  changeLanguage: (lang: Language) => void;
  t: (section: string, key: string) => string;
}

const AppConfigContext = createContext<AppConfigContextType>({} as AppConfigContextType);

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState<Language>('pt-BR');
  const pathname = usePathname(); // <--- Hook que detecta mudança de rota

  // Efeito que roda na inicialização E sempre que mudar de página (ex: Login -> Dashboard)
  useEffect(() => {
    const userId = localStorage.getItem('userId');
    const localTheme = localStorage.getItem('theme');
    const localLang = localStorage.getItem('lang') as Language;

    // 1. Aplica configuração local inicial (para não piscar)
    if (localTheme === 'dark') {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      setDarkMode(false);
      document.documentElement.classList.remove('dark');
    }

    if (localLang && dictionary[localLang]) {
      setLanguage(localLang);
    }

    // 2. SE tiver usuário logado, busca a verdade no banco e SOBRESCREVE o local
    if(userId) {
        fetch('/api/perfil', { headers: { 'x-user-id': userId } })
            .then(r => {
                if (r.status === 401) {
                    redirectToLogin('expired');
                    throw new Error('Sessao expirada');
                }
                return r.json();
            })
            .then(data => {
                if (data.configuracoes) {
                    // Força o tema do usuário (seja true ou false)
                    const dbDark = !!data.configuracoes.darkMode; // Garante booleano
                    setDarkMode(dbDark);
                    
                    if (dbDark) {
                        document.documentElement.classList.add('dark');
                        localStorage.setItem('theme', 'dark');
                    } else {
                        document.documentElement.classList.remove('dark');
                        localStorage.setItem('theme', 'light');
                    }

                    // Força o idioma do usuário
                    const dbLang = data.configuracoes.idioma;
                    if (dbLang && dictionary[dbLang]) {
                        setLanguage(dbLang);
                        localStorage.setItem('lang', dbLang);
                    }
                }
            })
            .catch(() => console.log('Erro ao sincronizar preferências.'));
    }
  }, [pathname]); // <--- A MÁGICA: Recarrega sempre que navega

  const toggleDarkMode = (isDark: boolean) => {
    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const changeLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('lang', lang);
  };

  const t = (section: string, key: string) => {
    return dictionary[language]?.[section]?.[key] || key;
  };

  return (
    <AppConfigContext.Provider value={{ darkMode, toggleDarkMode, language, changeLanguage, t }}>
      {children}
    </AppConfigContext.Provider>
  );
}

export const useAppConfig = () => useContext(AppConfigContext);
