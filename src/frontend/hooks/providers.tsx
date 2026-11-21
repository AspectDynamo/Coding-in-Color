import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { IssuedCredential, PublicConfig, StaffProfile, StudentMe } from '@shared/api';
import type { Permission } from '@shared/types';
import { api, isApiError } from '@frontend/services/api';
import { clearAllDrafts } from '@frontend/lib/draft';
import { useQuery } from './useApi';
import { ConfigContext, IssuedCardsContext, StaffContext, StudentContext } from './contexts';

export function ConfigProvider({ children }: { children: ReactNode }) {
  const q = useQuery('config', (signal) => api.get<PublicConfig>('/config', undefined, signal));
  const value = useMemo(
    () => ({ config: q.data ?? null, loading: q.loading, error: q.error, retry: q.refetch }),
    [q.data, q.loading, q.error, q.refetch],
  );
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

/** Resolves "who am I" where 401 simply means signed out (not an error). */
async function whoAmI<T>(path: string, signal: AbortSignal): Promise<T | null> {
  try {
    return await api.get<T>(path, undefined, signal);
  } catch (e) {
    if (isApiError(e) && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
}

export function StaffProvider({ children }: { children: ReactNode }) {
  const q = useQuery('staff-me', (signal) => whoAmI<StaffProfile>('/auth/me', signal));
  const { setData } = q;
  const setStaff = useCallback((s: StaffProfile | null) => setData(() => s), [setData]);
  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setData(() => null);
    }
  }, [setData]);
  const staff = q.data ?? null;
  const value = useMemo(
    () => ({
      staff,
      loading: q.loading,
      error: q.error,
      setStaff,
      logout,
      can: (p: Permission) => !!staff?.permissions.includes(p),
      retry: q.refetch,
    }),
    [staff, q.loading, q.error, q.refetch, setStaff, logout],
  );
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

export function StudentProvider({ children }: { children: ReactNode }) {
  const q = useQuery('student-me', (signal) => whoAmI<StudentMe>('/student/me', signal));
  const { setData } = q;
  const setStudent = useCallback((s: StudentMe | null) => setData(() => s), [setData]);
  const logout = useCallback(async () => {
    try {
      await api.post('/student/logout');
    } finally {
      clearAllDrafts(); // shared devices: never leave one student's answers for the next
      setData(() => null);
    }
  }, [setData]);
  const value = useMemo(
    () => ({
      student: q.data ?? null,
      loading: q.loading,
      error: q.error,
      setStudent,
      logout,
      retry: q.refetch,
    }),
    [q.data, q.loading, q.error, q.refetch, setStudent, logout],
  );
  return <StudentContext.Provider value={value}>{children}</StudentContext.Provider>;
}

/** Holds raw access codes for the print sheet in React state ONLY. A refresh discards them by design. */
export function IssuedCardsProvider({ children }: { children: ReactNode }) {
  const [cards, setCards] = useState<IssuedCredential[]>([]);
  const clear = useCallback(() => setCards([]), []);
  const value = useMemo(() => ({ cards, setCards, clear }), [cards, clear]);
  return <IssuedCardsContext.Provider value={value}>{children}</IssuedCardsContext.Provider>;
}
