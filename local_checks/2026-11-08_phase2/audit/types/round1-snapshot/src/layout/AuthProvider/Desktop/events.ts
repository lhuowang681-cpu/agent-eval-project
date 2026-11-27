/**
 * Desktop Auth Event System
 *
 * Mirrors the Market auth event bus. Used to recover from desktop session
 * expiry: when a lambda tRPC call returns 401 (the stored OIDC token is
 * invalid/expired), the tRPC error link emits `session-expired` and the
 * AuthRequiredModal re-prompts the user to sign in.
 *
 * Desktop has no web `/signin` route, and the main-process re-auth trigger only
 * fires when the backend sets the `X-Auth-Required` header — which some backends
 * don't. This renderer-side path makes 401 recovery work regardless.
 */

export type DesktopAuthEventType = 'session-expired';

type EventCallback = () => void;

class DesktopAuthEventEmitter {
  private listeners: Set<EventCallback> = new Set();

  /**
   * Whether a session-expired event fired while no listener was mounted yet.
   * Lets a freshly-mounted listener (e.g. AuthRequiredModal) catch a 401 that
   * happened during initial load, before it subscribed.
   */
  private pending = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  on(_event: DesktopAuthEventType, callback: EventCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  emit(_event: DesktopAuthEventType): void {
    this.pending = true;
    // Auto-clear pending flag after 5 seconds to prevent it from staying
    // true indefinitely if consumePending() is never called (e.g., if the
    // modal component fails to mount for some reason).
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      this.pending = false;
    }, 5000);

    this.listeners.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.error('[DesktopAuthEvents] Error in event callback:', error);
      }
    });
  }

  /** Consume a pending session-expired flag (returns true once if one is set). */
  consumePending(): boolean {
    const wasPending = this.pending;
    this.pending = false;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    return wasPending;
  }
}

export const desktopAuthEvents = new DesktopAuthEventEmitter();
