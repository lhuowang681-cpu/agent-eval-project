/**
 * Collaborative edit-lock heartbeat cadence.
 *
 * The server owns the lease TTL. Clients refresh comfortably before expiry so a
 * couple of missed beats do not immediately release an active editor's lock.
 */
export const DOCUMENT_LOCK_HEARTBEAT_MS = 10 * 1000;
