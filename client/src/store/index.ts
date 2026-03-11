import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface StockState {
  selectedCodes: string[];
  addCode: (code: string) => void;
  removeCode: (code: string) => void;
}

export const useStockStore = create<StockState>()(
  persist(
    (set) => ({
      selectedCodes: ['sh600519', 'sz000001', 'sh000001'],
      addCode: (code) =>
        set((state) => ({
          selectedCodes: [...new Set([...state.selectedCodes, code])],
        })),
      removeCode: (code) =>
        set((state) => ({
          selectedCodes: state.selectedCodes.filter((c) => c !== code),
        })),
    }),
    {
      name: 'stock-storage',
    }
  )
);
