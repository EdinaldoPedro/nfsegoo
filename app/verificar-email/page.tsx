'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, KeyRound, CheckCircle, ArrowRight, LogOut, Loader2 } from 'lucide-react';
import { logoutAndRedirect } from '@/app/utils/client-session';

export default function VerificarEmailPage() {
    const router = useRouter();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    
    // Step 1
    const [newEmail, setNewEmail] = useState('');
    const [confirmEmail, setConfirmEmail] = useState('');
    const [password, setPassword] = useState('');
    
    // Step 2
    const [code, setCode] = useState('');

    const handleSendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newEmail !== confirmEmail) return alert("Os e-mails não coincidem.");
        if (!password) return alert("Digite sua senha para confirmar.");

        setLoading(true);

            try {
                const res = await fetch('/api/auth/verify-email/confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });
            const data = await res.json();
            
            if (res.ok) {
                setStep(2);
            } else {
                alert(data.error || "Erro ao enviar código.");
            }
        } catch (e) { alert("Erro de conexão."); }
        finally { setLoading(false); }
    };

    const handleConfirmCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const res = await fetch('/api/auth/verify-email/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await res.json();

            if (res.ok) {
                alert("E-mail atualizado com sucesso!");
                router.push('/cliente/dashboard'); // Ou rota correta baseado no role
            } else {
                alert(data.error || "Código inválido.");
            }
        } catch (e) { alert("Erro de conexão."); }
        finally { setLoading(false); }
    };

    const handleLogout = () => {
        void logoutAndRedirect();
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl border border-slate-100">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-xl font-bold text-slate-800">Atualização de Cadastro</h1>
                    <button onClick={handleLogout} className="text-slate-400 hover:text-red-500"><LogOut size={18}/></button>
                </div>

                <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-6 rounded text-sm text-orange-800">
                    <p>Detectamos que seu e-mail precisa ser atualizado ou confirmado. Por favor, cadastre um e-mail válido para continuar.</p>
                </div>

                {step === 1 ? (
                    <form onSubmit={handleSendCode} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Novo E-mail</label>
                            <input type="email" required className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="seu@email.com"/>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Confirmar E-mail</label>
                            <input type="email" required className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={confirmEmail} onChange={e => setConfirmEmail(e.target.value)} placeholder="Repita o e-mail"/>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sua Senha (Para Segurança)</label>
                            <div className="relative">
                                <KeyRound className="absolute left-3 top-3 text-slate-400" size={18}/>
                                <input type="password" required className="w-full pl-10 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                    value={password} onChange={e => setPassword(e.target.value)} placeholder="Digite sua senha atual"/>
                            </div>
                        </div>
                        <button disabled={loading} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition flex justify-center items-center gap-2">
                            {loading ? <Loader2 className="animate-spin"/> : <>Continuar <ArrowRight size={18}/></>}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleConfirmCode} className="space-y-6">
                        <div className="text-center">
                            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600">
                                <Mail size={32}/>
                            </div>
                            <h2 className="font-bold text-lg text-slate-700">Verifique seu E-mail</h2>
                            <p className="text-sm text-slate-500 mt-1">Enviamos um código de 6 dígitos para <strong>{newEmail}</strong>.</p>
                        </div>
                        
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 text-center">Código de Verificação</label>
                            <input type="text" required maxLength={6} className="w-full p-4 text-center text-2xl tracking-widest font-mono border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={code} onChange={e => setCode(e.target.value)} placeholder="000000"/>
                        </div>

                        <div className="flex gap-2">
                            <button type="button" onClick={() => setStep(1)} className="flex-1 py-3 text-slate-500 hover:bg-slate-100 rounded-lg font-bold text-sm">Voltar</button>
                            <button disabled={loading} className="flex-1 bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 transition flex justify-center items-center gap-2">
                                {loading ? <Loader2 className="animate-spin"/> : <><CheckCircle size={18}/> Confirmar</>}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
