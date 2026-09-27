import { toast } from 'sonner';

/** Small wrapper so every part of the app speaks with the same voice. */
export const toasts = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
  warn: (message: string) => toast.warning(message),
  info: (message: string) => toast(message),
};
