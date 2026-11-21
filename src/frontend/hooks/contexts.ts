import { createContext, useContext } from 'react';
import type { IssuedCredential, PublicConfig, StaffProfile, StudentMe } from '@shared/api';
import type { Permission } from '@shared/types';

/* ---------- Public config ---------- */
export interface ConfigState {
  config: PublicConfig | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}
export const ConfigContext = createContext<ConfigState>({
  config: null,
  loading: false,
  error: null,
  retry: () => {},
});
export const useConfig = () => useContext(ConfigContext);

/* ---------- Staff auth ---------- */
export interface StaffState {
  staff: StaffProfile | null;
  loading: boolean;
  error: Error | null;
  setStaff: (s: StaffProfile | null) => void;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
  retry: () => void;
}
export const StaffContext = createContext<StaffState>({
  staff: null,
  loading: false,
  error: null,
  setStaff: () => {},
  logout: async () => {},
  can: () => false,
  retry: () => {},
});
export const useStaff = () => useContext(StaffContext);

/* ---------- Student session ---------- */
export interface StudentState {
  student: StudentMe | null;
  loading: boolean;
  error: Error | null;
  setStudent: (s: StudentMe | null) => void;
  logout: () => Promise<void>;
  retry: () => void;
}
export const StudentContext = createContext<StudentState>({
  student: null,
  loading: false,
  error: null,
  setStudent: () => {},
  logout: async () => {},
  retry: () => {},
});
export const useStudent = () => useContext(StudentContext);

/* ---------- Just-issued access cards (memory only; never persisted) ---------- */
export interface IssuedCardsState {
  cards: IssuedCredential[];
  setCards: (cards: IssuedCredential[]) => void;
  clear: () => void;
}
export const IssuedCardsContext = createContext<IssuedCardsState>({
  cards: [],
  setCards: () => {},
  clear: () => {},
});
export const useIssuedCards = () => useContext(IssuedCardsContext);
