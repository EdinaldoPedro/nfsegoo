'use client';
import { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, Save, X, Book, Loader2, AlertTriangle } from 'lucide-react';

export default function GestaoCatalogo() {
  const [itens, setItens] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  
  const carregar = () => {
      setLoading(true);
      setErrorMsg('');
      
      fetch('/api/admin/suporte/catalogo')
        .then(async res => {
            if (!res.ok) {
                if(res.status === 404) throw new Error("API não encontrada (Erro 404). Verifique a pasta 'app/api/admin/suporte/catalogo/route.ts'");
                throw new Error("Erro ao carregar dados.");
            }
            return res.json();
        })
        .then(data => {
            setItens(Array.isArray(data) ? data : []);
            setLoading(false);
        })
        .catch(e => {
            console.error(e);
            setErrorMsg(e.message);
            setLoading(false);
        });
  };

  useEffect(() => { carregar(); }, []);

  const handleSave = async () => {
      const method = editing.id ? 'PUT' : 'POST';
      
      try {
          const res = await fetch('/api/admin/suporte/catalogo', {
              method,
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify(editing)
          });

          if (res.ok) {
              setEditing(null);
              carregar();
              alert("Salvo com sucesso!");
          } else {
              const err = await res.json();
              alert("Erro ao salvar: " + (err.error || "Desconhecido"));
          }
      } catch (e) {
          alert("Erro de conexão com a API.");
      }
  };

  const handleDelete = async (id: string) => {
      if(!confirm("Tem certeza que deseja excluir?")) return;
      await fetch(`/api/admin/suporte/catalogo?id=${id}`, { method: 'DELETE' });
      carregar();
  };

  return (
    <div>
        <div className="flex justify-between items-center mb-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-800">Catálogo de Serviços</h1>
                <p className="text-sm text-slate-500">Cadastre os assuntos disponíveis para abertura de chamados.</p>
            </div>
            <button onClick={() => setEditing({ titulo: '', prioridade: 'MEDIA', instrucoes: '', ativo: true })} className="bg-blue-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-blue-700 font-bold shadow-md">
                <Plus size={18}/> Novo Item
            </button>
        </div>

        {errorMsg && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4 flex items-center gap-2">
                <AlertTriangle size={20}/>
                <span>{errorMsg}</span>
            </div>
        )}

        {loading ? (
            <div className="text-center p-12 text-slate-500 flex flex-col items-center">
                <Loader2 className="animate-spin mb-2" size={32}/>
                Carregando catálogo...
            </div>
        ) : itens.length === 0 ? (
            <div className="text-center p-12 bg-white rounded-xl border border-dashed text-gray-400">
                Nenhum serviço cadastrado. Clique em "Novo Item" para começar.
            </div>
        ) : (
            <div className="grid gap-3">
                {itens.map(item => (
                    <div key={item.id} className="bg-white p-4 rounded-xl border flex justify-between items-center shadow-sm hover:shadow-md transition">
                        <div>
                            <div className="flex items-center gap-3">
                                <h3 className="font-bold text-slate-800 text-lg">{item.titulo}</h3>
                                {!item.ativo && <span className="bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded border font-bold">INATIVO</span>}
                            </div>
                            
                            <div className="flex flex-col gap-1 mt-1">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border w-fit uppercase ${
                                    item.prioridade === 'CRITICA' ? 'bg-red-100 text-red-700 border-red-200' :
                                    item.prioridade === 'ALTA' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                    'bg-blue-50 text-blue-700 border-blue-200'
                                }`}>Prioridade Automática: {item.prioridade}</span>
                                
                                {item.instrucoes && (
                                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                                        <Book size={12}/> Instruções cadastradas
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setEditing(item)} className="p-2 text-blue-600 hover:bg-blue-50 rounded transition"><Edit size={18}/></button>
                            <button onClick={() => handleDelete(item.id)} className="p-2 text-red-500 hover:bg-red-50 rounded transition"><Trash2 size={18}/></button>
                        </div>
                    </div>
                ))}
            </div>
        )}

        {/* MODAL */}
        {editing && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white p-6 rounded-xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95">
                    <div className="flex justify-between mb-4 border-b pb-4">
                        <h3 className="font-bold text-lg text-slate-800">{editing.id ? 'Editar Item' : 'Novo Serviço'}</h3>
                        <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-red-500 transition"><X size={24}/></button>
                    </div>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Título do Assunto (Visto pelo Cliente)</label>
                            <input className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={editing.titulo} onChange={e => setEditing({...editing, titulo: e.target.value})} 
                                placeholder="Ex: Erro ao emitir NFS-e"
                            />
                        </div>
                        
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Prioridade Automática</label>
                            <select className="w-full p-2 border rounded bg-white" 
                                value={editing.prioridade} onChange={e => setEditing({...editing, prioridade: e.target.value})}
                            >
                                <option value="BAIXA">Baixa</option>
                                <option value="MEDIA">Média</option>
                                <option value="ALTA">Alta</option>
                                <option value="CRITICA">Crítica</option>
                            </select>
                        </div>
                        
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Instruções Internas (Para o Atendente)</label>
                            <textarea className="w-full p-2 border rounded h-24 focus:ring-2 focus:ring-blue-500 outline-none resize-none" 
                                value={editing.instrucoes || ''} onChange={e => setEditing({...editing, instrucoes: e.target.value})} 
                                placeholder="Descreva o procedimento padrão para este tipo de chamado..."
                            />
                        </div>
                        
                        <div className="flex items-center gap-2 pt-2">
                            <input type="checkbox" id="ativo" className="w-4 h-4" checked={editing.ativo} onChange={e => setEditing({...editing, ativo: e.target.checked})}/>
                            <label htmlFor="ativo" className="text-sm cursor-pointer select-none">Ativo para seleção</label>
                        </div>

                        <button onClick={handleSave} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 flex items-center justify-center gap-2 mt-4 shadow-md transition">
                            <Save size={18}/> Salvar
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
}
