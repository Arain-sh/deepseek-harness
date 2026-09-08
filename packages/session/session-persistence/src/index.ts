/**
 * Durable session-persistence Service Definition (`ctx.sessionPersistence`). Backends store
 * {@link SessionEvent}s as the event-sourced log and carry non-replayable
 * {@link SessionHeader} metadata separately; callers address one stored
 * session through a {@link SessionHandle} obtained from `create`/`open`.
 * @module @deepseek-ai/dsh-session-persistence
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionHandle, SessionAccess } from './handle.ts'
import type { SessionPersistenceRevision } from './revision.ts'

// Re-export the metadata vocabulary so Consumers import it from the Service Definition.
export type { SessionHeader } from '@deepseek-ai/dsh-session'
export { SessionPersistenceRevision } from './revision.ts'
export type {
  SessionAccess,
  SessionHandle,
  SessionHandleAppendOptions,
  SessionHandleFlushOptions,
  SessionHandleReadOptions,
  SessionHandleReadResult,
} from './handle.ts'
export {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionFormatUnsupportedError,
  SessionHandleClosedError,
  SessionOwnershipLostError,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  SessionReadOnlyError,
  sessionFormatVersionRefusal,
} from './errors.ts'
export type { SessionLocation } from './errors.ts'
export {
  assertContiguous,
  assertStoredId,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  validateStoredEvents,
} from './storage-contract.ts'

/**
 * Lightweight stored-session observation returned by {@link SessionPersistence.stat}
 * and {@link SessionPersistence.list} without reading the full event log.
 */
export interface SessionPersistenceSnapshot {
  /** Detached metadata for one stored session. */
  readonly header: SessionHeader
  /** Opaque change token; see {@link SessionPersistence.stat}. */
  readonly revision: SessionPersistenceRevision
  /** Logical event count, when the backend can provide it cheaply from metadata; otherwise absent. */
  readonly eventCount?: number
  /** Physical artifact byte size, when the backend can provide it cheaply (JSONL); otherwise absent. */
  readonly sizeBytes?: number
}

/** Options for {@link SessionPersistence.create}. */
export interface SessionPersistenceCreateOptions {
  /** Optional cancellation observed before backend work starts. */
  readonly signal?: AbortSignal
  /**
   * Exact fork-inherited prefix length. Required when `header.isSeeded` is
   * true and must be omitted (or `0`) otherwise; the backend refuses a
   * mismatch at create.
   */
  readonly inheritedEventCount?: SessionLogOffset
}

/**
 * Logical Session header paired with its exact inherited cut for body-bearing
 * storage operations. `isSeeded` marks fork lineage on the header; the
 * numeric cut travels beside it, never inside the replayable event log.
 */
export interface SessionStorageMetadata {
  /** Validated immutable Session header. */
  readonly meta: SessionHeader
  /** Number of leading events inherited from the Session's fork parent. */
  readonly inheritedEventCount: SessionLogOffset
}

/** Immutable logical session read: storage metadata plus the complete validated event log. */
export interface SessionInspection extends SessionStorageMetadata {
  /** Contiguous validated events from seq 0. */
  readonly events: readonly SessionEvent[]
}

/** Options for {@link SessionPersistence.open}. */
export interface SessionPersistenceOpenOptions {
  /** Optional cancellation observed before backend work starts. */
  readonly signal?: AbortSignal
}

/** Options for {@link SessionPersistence.stat}. */
export interface SessionPersistenceStatOptions {
  /** Optional cancellation for backend metadata reads. */
  readonly signal?: AbortSignal
}

/** Options for {@link SessionPersistence.list}. */
export interface SessionPersistenceListOptions {
  /** Optional cancellation for backend listing work. */
  readonly signal?: AbortSignal
}

/** Options for {@link SessionPersistence.delete}. */
export interface SessionPersistenceDeleteOptions {
  /** Optional cancellation observed before the durable removal commits. */
  readonly signal?: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionPersistence: SessionPersistence
  }

  interface Events {
    /**
     * Post-commit notification that one stored session was permanently
     * removed. Derived read models (search indexes, projection caches,
     * workspace accounting) drop their row from this event; a listener
     * failure is contained and cannot reverse the storage commit, so a
     * listener must be idempotent and must not assume the record is still
     * readable. Only the identity travels: by the time this fires the log is
     * gone, so a header would name bytes no reader can reach.
     * @param sessionId - the permanently deleted session identity.
     * @mode parallel
     */
    'session-persistence/deleted'(sessionId: SessionId): Promise<void> | void
  }
}

/**
 * Durable append-only session storage addressed through per-session handles.
 *
 * Storage semantics shared by every backend: events are contiguous from seq 0
 * and never rewritten; a torn physical tail is never returned to a reader and
 * is truncated by the write path before its first append; reads validate
 * current-format records only and refuse unknown vocabulary fail-closed.
 * `append` persists best-effort; `flush` — per handle or service-wide — is
 * the durability barrier.
 *
 * Visibility: a created session is observable through `stat`/`list`/`open`
 * in this process from the moment `create` resolves, even while a backend
 * defers physical materialization (a pure optimization); other processes see
 * the session only once it materializes, and a session that never
 * materialized before a crash never existed. `SessionHandle.flush` forces
 * materialization.
 *
 * Freshness: once an `append` or `flush` resolves, reads started afterwards
 * on this backend instance observe at least that prefix.
 */
export abstract class SessionPersistence extends Service {
  /**
   * Whether this backend implements permanent single-session deletion.
   * Consumers probe this before starting a deletion transaction; the
   * defaulted {@link delete} below rejects, so a backend that does not
   * override both cannot silently claim support.
   */
  readonly supportsDeletion: boolean = false

  constructor(ctx: Context) {
    super(ctx, 'sessionPersistence')
  }

  /**
   * Create a new stored session and take its write ownership.
   * @param header - the immutable header (id, version, cwd, lineage) to store.
   * @param options - optional cancellation.
   * @returns a `write` handle owned by the caller; close it to release ownership.
   * @throws {SessionAlreadyExistsError} when the id already exists.
   */
  abstract create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle>

  /**
   * Open an existing stored session.
   *
   * `read` never takes ownership and works while another handle (or process)
   * holds write ownership. `write` atomically claims single-writer ownership;
   * an existing active owner rejects.
   * @param id - the stored session to open.
   * @param access - `read` or `write`.
   * @param options - optional cancellation.
   * @returns the open handle.
   * @throws {SessionPersistenceNotFoundError} when the session does not exist.
   * @throws {SessionAlreadyOwnedError} for `write` when ownership is taken.
   */
  abstract open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle>

  /**
   * Permanently remove one stored session and everything the backend holds
   * for it. Whole-session removal is id-addressed like `create`/`stat`/`list`
   * — it has no slice semantics and no handle could survive it — and it
   * answers absence the way `stat` does, with `undefined` rather than a
   * refusal.
   *
   * Implementations take the same single-writer claim `open(id, 'write')`
   * takes, so an active owner rejects instead of losing its bytes underneath
   * it; the removal is durable when the returned promise resolves, and
   * repeating it on an already-removed id is a no-op. On success the backend
   * publishes `session-persistence/deleted` post-commit (see
   * {@link emitDeleted}).
   *
   * The default rejects: deletion is opt-in, so a third-party backend keeps
   * compiling and keeps `supportsDeletion` false.
   * @param _id - the stored session to remove.
   * @param _options - optional cancellation.
   * @returns the removed session's stored header, or `undefined` when the
   *   session did not exist — or when it did, but its stored header was
   *   unreadable (an unsupported format generation, say): an artifact this
   *   build cannot interpret must still be removable, so a refusal costs the
   *   caller the header, never the removal. `stat` conflates the two the same
   *   way; `session-persistence/deleted` is the authoritative signal that
   *   something was removed.
   * @throws {SessionAlreadyOwnedError} while a write handle owns the id.
   */
  delete(_id: SessionId, _options?: SessionPersistenceDeleteOptions): Promise<SessionHeader | undefined> {
    return Promise.reject(new Error(`${this.name}: this session persistence backend does not support permanent Session deletion`))
  }

  /**
   * Publish a committed deletion without letting an observer failure reverse
   * it: the bytes are already gone, so a rejecting listener is logged and
   * contained. Backends call this immediately after the durable removal
   * commits.
   * @param id - the permanently deleted session identity.
   * @returns resolution once every listener settled.
   */
  protected async emitDeleted(id: SessionId): Promise<void> {
    try {
      await this.ctx.parallel('session-persistence/deleted', id)
    } catch (error: unknown) {
      this.ctx.logger.warn(`session "${id}": session-persistence/deleted listener rejected: ${String(error)}`)
    }
  }

  /**
   * Flush every active write handle owned by this service instance in one
   * durability barrier: each handle's routed live events drain durably and
   * its session materializes, exactly as that handle's own
   * `SessionHandle.flush` would. Read handles buffer nothing and are
   * untouched. A handle closed concurrently counts as flushed — close itself
   * drains durably.
   * @returns resolution once every write handle active at the call has flushed.
   * @throws {AggregateError} naming each session whose flush failed; the
   *   remaining handles still flush.
   */
  abstract flush(): Promise<void>

  /**
   * Observe one stored session without reading its event log or taking
   * ownership.
   *
   * The snapshot's `revision` is an opaque change token comparable only
   * against revisions from the same service instance and session id: equal
   * revisions may be treated as an unchanged log; unequal revisions promise
   * nothing. Write-ownership churn does not change a revision. It exists for
   * derived read-model caches keyed off `stat`/`list`; it plays no part in
   * open, read, or resume.
   * @param id - the stored session to observe.
   * @param options - optional cancellation.
   * @returns the snapshot, or `undefined` when the session does not exist.
   */
  abstract stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined>

  /**
   * List every stored session visible to this process, in no promised order.
   * @param options - optional cancellation.
   * @returns one snapshot per stored session.
   */
  abstract list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]>
}

export default SessionPersistence
