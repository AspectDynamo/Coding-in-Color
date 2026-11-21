import type { AuditAppendInput, DataStore } from '../repositories/types';
import { errorSummary, log } from '../utils/logger';

/**
 * Append an audit entry. Never include secrets, codes, guardian contacts or emails in metadata.
 * Best effort: a failing audit write is logged loudly but does not undo the action.
 */
export async function audit(store: DataStore, entry: AuditAppendInput): Promise<void> {
  try {
    await store.appendAudit(entry);
  } catch (e) {
    log('error', 'audit.write_failed', { action: entry.action, ...errorSummary(e) });
  }
}
