import { useEffect } from 'react';

const APP = 'Coding in Color Impact';

/** Sets document.title; every routed page calls this (directly or through PageHeader). */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP}` : APP;
  }, [title]);
}
