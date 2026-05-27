'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Upload, X, Loader2, AlertTriangle, FileText } from 'lucide-react';
import Link from 'next/link';
// 1. Importar o Dialog
import { useDialog } from '@/app/contexts/DialogContext';

export default function NovoTicketPage() {
  const router = useRouter();
  const dialog = useDialog(); // 2. Inicializar
  
  const [loading, setLoading] = useState(false);
  const [catalogo, setCatalogo] = useState<any[]>([]);
  
  const [form, setForm] = useState({
      assuntoId: '',
      tituloManual: '',
      descricao: '',
      prioridade: 'MEDIA',
      anexoBase64: null as string | null,
      anexoNome: null as string | null
  });

  // Carrega opções de assunto
  useEffect(() => {
      const role = localStorage.getItem('userRole') || '';
      const isSupportMode = localStorage.getItem('isSupportMode') === 'true';
      const isInternalSupport = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(role);

      if (isInternalSupport && !isSupportMode) {
          router.replace('/admin/suporte');
          return;
      }

      const userId = localStorage.getItem('userId');

      fetch('/api/admin/suporte/catalogo', {
          headers: { 
              'x-user-id': userId || ''
          }
      })
      .then(r => r.json())
      .then(data => {
          if(Array.isArray(data)) setCatalogo(data);
      })
      .catch(() => {});
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              setForm({
                  ...form,
                  anexoBase64: (reader.result as string).split(',')[1],
                  anexoNome: file.name
              });
          };
          reader.readAsDataURL(file);
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if(!form.assuntoId) return dialog.showAlert("Selecione um assunto.");
      
      // Função interna para permitir "forçar" o envio se houver duplicidade
      const enviarChamado = async (force = false) => {
          setLoading(true);
          const userId = localStorage.getItem('userId');

          try {
              const res = await fetch('/api/suporte/tickets', {
                  method: 'POST',
                  headers: { 
                      'Content-Type': 'application/json', 
                      'x-user-id': userId || ''
                  },
                  // Adiciona checkDuplicity
                  body: JSON.stringify({ ...form, checkDuplicity: !force })
              });

              const data = await res.json();

              if(res.ok) {
                  // Sucesso: Prompt bonito
                  await dialog.showAlert({ 
                      type: 'success', 
                      title: 'Sucesso', 
                      description: `Chamado #${data.protocolo} aberto com sucesso!` 
                  });
                  router.push('/cliente/suporte');
              } 
              else if (res.status === 409) {
                  // Conflito: Pergunta se quer abrir mesmo assim
                  const confirmar = await dialog.showConfirm({
                      type: 'warning',
                      title: 'Chamado Similar',
                      description: `${data.message}\n\nDeseja abrir este novo chamado mesmo assim?`,
                      confirmText: 'Sim, Confirmar',
                      cancelText: 'Cancelar'
                  });

                  if (confirmar) {
                      enviarChamado(true); // Tenta de novo forçando
                  }
              } 
              else {
                  dialog.showAlert({ type: 'danger', description: "Erro: " + (data.error || "Falha ao abrir chamado") });
              }
          } catch (error) {
              dialog.showAlert("Erro de conexão.");
          } finally {
              setLoading(false);
          }
      };

      // Dispara a primeira tentativa
      enviarChamado(false);
  };

  const assuntoSelecionado = catalogo.find(c => c.id === form.assuntoId);

  return (
    <div className="min-h-screen bg-slate-50 p-6 flex justify-center">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit">
          
          <div className="p-6 border-b border-slate-100 flex items-center gap-4 bg-slate-50/50">
              <Link href="/cliente/suporte" className="p-2 hover:bg-white rounded-full border border-transparent hover:border-slate-200 transition text-slate-500">
                  <ArrowLeft size={20}/>
              </Link>
              <div>
                  <h1 className="text-xl font-bold text-slate-800">Novo Chamado</h1>
                  <p className="text-sm text-slate-500">Descreva seu problema para nossa equipe.</p>
              </div>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-6">
              
              <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Qual o motivo do contato?</label>
                  <select 
                      className="w-full p-3 border rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition"
                      value={form.assuntoId}
                      onChange={e => setForm({...form, assuntoId: e.target.value, prioridade: 'MEDIA'})}
                      required
                  >
                      <option value="">Selecione um assunto...</option>
                      {catalogo.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.titulo}</option>
                      ))}
                      <option value="AUTO_ERROR_REPORT">Outros / Erro Genérico</option>
                  </select>
              </div>

              {form.assuntoId === 'AUTO_ERROR_REPORT' && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                      <label className="block text-sm font-bold text-slate-700 mb-2">Título do Assunto</label>
                      <input 
                          className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                          placeholder="Ex: Erro ao gerar boleto"
                          value={form.tituloManual}
                          onChange={e => setForm({...form, tituloManual: e.target.value})}
                          required
                      />
                  </div>
              )}

              <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Descrição Detalhada</label>
                  <textarea 
                      className="w-full p-3 border rounded-lg h-32 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      placeholder="Explique o que aconteceu, inclua mensagens de erro se houver..."
                      value={form.descricao}
                      onChange={e => setForm({...form, descricao: e.target.value})}
                      required
                  />
              </div>

              <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Anexo (Opcional)</label>
                  <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg cursor-pointer hover:bg-slate-200 transition border border-slate-300">
                          <Upload size={18}/> Escolher Arquivo
                          <input type="file" className="hidden" onChange={handleFile} accept="image/*,.pdf,.xml"/>
                      </label>
                      {form.anexoNome && (
                          <span className="text-sm text-blue-600 flex items-center gap-2 bg-blue-50 px-3 py-1 rounded-full">
                              <FileText size={14}/> {form.anexoNome}
                              <button type="button" onClick={() => setForm({...form, anexoBase64: null, anexoNome: null})} className="text-red-400 hover:text-red-600"><X size={14}/></button>
                          </span>
                      )}
                  </div>
              </div>

              {assuntoSelecionado && (
                  <div className="bg-blue-50 p-4 rounded-lg flex items-start gap-3 border border-blue-100">
                      <AlertTriangle className="text-blue-500 shrink-0 mt-0.5" size={18}/>
                      <div className="text-sm text-blue-800">
                          <p className="font-bold">Dica:</p>
                          <p>{assuntoSelecionado.instrucoes || 'Verifique nossa base de conhecimento antes de abrir o chamado.'}</p>
                      </div>
                  </div>
              )}

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                  <button type="button" onClick={() => router.back()} className="px-6 py-2 text-slate-500 hover:bg-slate-50 rounded-lg font-bold transition">Cancelar</button>
                  <button disabled={loading} className="bg-blue-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-100 flex items-center gap-2 disabled:opacity-70">
                      {loading ? <Loader2 className="animate-spin"/> : <><Save size={18}/> Abrir Chamado</>}
                  </button>
              </div>

          </form>
      </div>
    </div>
  );
}
