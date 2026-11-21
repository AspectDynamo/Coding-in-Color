import { createContext, useContext } from 'react';

export type ToastTone = 'good' | 'bad' | 'info';
export interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}
const noop: ToastApi = { show: () => {}, success: () => {}, error: () => {} };
export const ToastContext = createContext<ToastApi>(noop);
export const useToast = () => useContext(ToastContext);
