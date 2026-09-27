import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AddMemorySheet } from '../components/AddMemorySheet';

export type AddMode = 'photos' | 'diary' | 'collection';

interface AddMemoryValue {
  open: (mode?: AddMode) => void;
  close: () => void;
  mode: AddMode | null;
}

const AddMemoryContext = createContext<AddMemoryValue | null>(null);

/**
 * One composer, reachable from anywhere. Every surface in the app can offer
 * "add a memory" and it lands in the same place.
 */
export function AddMemoryProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AddMode | null>(null);

  const open = useCallback((next: AddMode = 'photos') => setMode(next), []);
  const close = useCallback(() => setMode(null), []);

  const value = useMemo(() => ({ open, close, mode }), [open, close, mode]);

  return (
    <AddMemoryContext.Provider value={value}>
      {children}
      <AddMemorySheet open={mode !== null} initialMode={mode ?? 'photos'} onClose={close} />
    </AddMemoryContext.Provider>
  );
}

export function useAddMemory(): AddMemoryValue {
  const context = useContext(AddMemoryContext);
  if (!context) throw new Error('useAddMemory must be used inside AddMemoryProvider');
  return context;
}
