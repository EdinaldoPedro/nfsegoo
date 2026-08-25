'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';

type NbsOption = { codigoNumerico: string; codigoFormatado: string; descricao: string };

export default function NbsSelector({ value, onChange, disabled = false }: {
  value?: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<NbsOption[]>([]);
  const [selected, setSelected] = useState<NbsOption | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedValue = String(value || '').replace(/\D/g, '');

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (!normalizedValue) { setSelected(null); return; }
    const token = localStorage.getItem('token');
    fetch(`/api/nbs?search=${encodeURIComponent(normalizedValue)}&limit=1`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((result) => setSelected(result.data?.find((item: NbsOption) => item.codigoNumerico === normalizedValue) || null))
      .catch(() => setSelected(null));
  }, [normalizedValue]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const token = localStorage.getItem('token');
      try {
        const response = await fetch(`/api/nbs?search=${encodeURIComponent(search)}&limit=30`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        const result = response.ok ? await response.json() : { data: [] };
        setOptions(result.data || []);
      } catch (error) {
        if (!controller.signal.aborted) setOptions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, search]);

  const choose = (option: NbsOption | null) => {
    setSelected(option);
    onChange(option?.codigoNumerico || '');
    setSearch('');
    setOpen(false);
  };

  const display = selected
    ? `${selected.codigoFormatado} — ${selected.descricao}`
    : normalizedValue ? `Código legado ${normalizedValue} — selecione novamente` : 'Selecione — nenhum NBS definido';

  return (
    <div ref={rootRef} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left text-sm outline-none transition hover:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500">
        <span className={`min-w-0 truncate ${normalizedValue && !selected ? 'text-amber-700' : selected ? 'text-slate-800' : 'text-slate-400'}`}>{display}</span>
        <ChevronDown size={17} className="shrink-0 text-slate-400" />
      </button>

      {open && !disabled && (
        <div className="absolute z-[80] mt-2 w-full min-w-[340px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
          <div className="relative border-b p-3">
            <Search size={17} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Pesquise por código ou palavras..."
              className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-9 text-sm outline-none focus:border-blue-400" />
            {search && <button type="button" onClick={() => setSearch('')} className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400"><X size={16} /></button>}
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            <button type="button" onClick={() => choose(null)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-slate-500 hover:bg-slate-50">
              <span className="w-4">{!normalizedValue && <Check size={15} />}</span> Selecione — nenhum NBS definido
            </button>
            {loading ? <div className="flex items-center justify-center gap-2 p-6 text-sm text-slate-400"><Loader2 size={17} className="animate-spin" /> Pesquisando...</div>
              : options.map((option) => <button type="button" key={option.codigoNumerico} onClick={() => choose(option)} className="flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-blue-50">
                <span className="mt-0.5 w-4 text-blue-600">{normalizedValue === option.codigoNumerico && <Check size={15} />}</span>
                <span><strong className="block font-mono text-xs text-blue-700">{option.codigoFormatado}</strong><span className="text-sm text-slate-700">{option.descricao}</span></span>
              </button>)}
            {!loading && options.length === 0 && <p className="p-6 text-center text-sm text-slate-400">Nenhum NBS encontrado.</p>}
          </div>
          <p className="border-t bg-slate-50 px-3 py-2 text-[11px] text-slate-500">Catálogo oficial NBS 2.0. A seleção deve seguir o enquadramento fiscal do serviço.</p>
        </div>
      )}
    </div>
  );
}
