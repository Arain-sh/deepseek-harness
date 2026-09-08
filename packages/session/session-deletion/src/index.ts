/**
 * Host-only recursive Session deletion capability.
 * @module @deepseek-ai/dsh-session-deletion
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AgentIdleDisposalReservation } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-only permanent-deletion capability, absent from browser transports. */
    sessionDeletion: SessionDeletion
  }
}

/** Immutable recursive-deletion plan in bottom-up persistence order. */
export interface SessionDeletionPreview {
  /** Requested subtree root. */
  readonly rootSessionId: SessionId
  /** Known descendants followed by the root, ready for bottom-up deletion. */
  readonly sessionIds: readonly SessionId[]
}

/** Immutable facts after one recursive deletion attempt commits. */
export interface SessionDeletionResult extends SessionDeletionPreview {
  /** Identities whose persistence provider returned a removed header in this attempt. */
  readonly deletedSessionIds: readonly SessionId[]
}

/** Stable reason a Host-side recursive deletion cannot proceed. */
export type SessionDeletionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_LINEAGE_INVALID'
  | 'PERSISTENCE_UNSUPPORTED'
  | 'SESSION_HANDLE_NOT_RETAINED'
  | 'SESSION_NOT_IDLE'
  | 'SESSION_STILL_LIVE'

/** Typed refusal for recursive permanent deletion. */
export class SessionDeletionError extends Error {
  /**
   * @param message - stable deletion refusal context.
   * @param code - machine-readable reason for the refusal.
   * @param sessionId - exact Session responsible for the refusal, when known.
   */
  constructor(
    message: string,
    public readonly code: SessionDeletionErrorCode,
    public readonly sessionId?: SessionId,
  ) {
    super(message)
    this.name = 'SessionDeletionError'
  }
}

/** One claimed live lifecycle plus whether ordinary disposal consumed it. */
interface ClaimedHandle {
  readonly sessionId: SessionId
  readonly claim: AgentIdleDisposalReservation
  consumed: boolean
}

/** Merge live and durable headers while refusing conflicting lineage. */
function mergeHeaders(headers: readonly SessionHeader[]): Map<SessionId, SessionHeader> {
  const merged = new Map<SessionId, SessionHeader>()
  for (const header of headers) {
    const previous = merged.get(header.id)
    if (previous !== undefined && previous.parentSession !== header.parentSession) {
      throw new SessionDeletionError(
        `session "${header.id}" has conflicting parentSession metadata`,
        'SESSION_LINEAGE_INVALID',
        header.id,
      )
    }
    merged.set(header.id, header)
  }
  return merged
}

/** Build a deterministic bottom-up closure from one parentSession root. */
function bottomUpPlan(
  rootSessionId: SessionId,
  headers: readonly SessionHeader[],
  allowMissingRoot: boolean,
): SessionId[] {
  const merged = mergeHeaders(headers)
  const children = new Map<SessionId, SessionId[]>()
  for (const header of merged.values()) {
    if (header.parentSession === undefined) continue
    const siblings = children.get(header.parentSession) ?? []
    siblings.push(header.id)
    children.set(header.parentSession, siblings)
  }
  if (!merged.has(rootSessionId) && !children.has(rootSessionId)) {
    if (allowMissingRoot) return []
    throw new SessionDeletionError(
      `session "${rootSessionId}" not found`,
      'SESSION_NOT_FOUND',
      rootSessionId,
    )
  }

  const discovered = new Map<SessionId, { readonly depth: number; readonly order: number }>()
  const pending: Array<{ readonly id: SessionId; readonly depth: number }> = [
    { id: rootSessionId, depth: 0 },
  ]
  let order = 0
  while (pending.length > 0) {
    // The non-empty check proves one entry remains.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const current = pending.shift()!
    if (discovered.has(current.id)) {
      throw new SessionDeletionError(
        `session lineage below "${rootSessionId}" contains a cycle at "${current.id}"`,
        'SESSION_LINEAGE_INVALID',
        current.id,
      )
    }
    discovered.set(current.id, { depth: current.depth, order: order++ })
    for (const child of children.get(current.id) ?? []) {
      pending.push({ id: child, depth: current.depth + 1 })
    }
  }
  return [...discovered]
    .sort((left, right) => right[1].depth - left[1].depth || left[1].order - right[1].order)
    .map(([sessionId]) => sessionId)
}

/** Freeze one public plan/result array without leaking mutable internal storage. */
function frozenIds(ids: readonly SessionId[]): readonly SessionId[] {
  return Object.freeze([...ids])
}

/**
 * Host-only permanent Session deletion provider. Product code validates
 * placement and archive authority before invoking this service.
 */
export class SessionDeletion extends Service {
  static inject = ['sessions', 'sessionPersistence', 'agents']

  /** Create and register the provider as `ctx.sessionDeletion`. */
  constructor(ctx: Context) {
    super(ctx, 'sessionDeletion')
  }

  /**
   * Resolve the current recursive deletion plan without reserving or mutating
   * any Session.
   * @param rootSessionId - subtree root to inspect.
   * @returns immutable ids in bottom-up deletion order.
   */
  async preview(rootSessionId: SessionId): Promise<SessionDeletionPreview> {
    const sessionIds = bottomUpPlan(rootSessionId, await this.headers(), false)
    return Object.freeze({ rootSessionId, sessionIds: frozenIds(sessionIds) })
  }

  /**
   * Read the complete currently known live and persistence lineage.
   *
   * `list()` already reports pending unmaterialized sessions, so the deletion
   * plan needs no dedicated enumeration of its own.
   */
  private async headers(): Promise<SessionHeader[]> {
    return [
      ...(await this.ctx.sessionPersistence.list()).map(snapshot => snapshot.header),
      ...this.ctx.sessions.list().map(session => session.header),
    ]
  }

  /** Reserve every live member atomically before disposing any of them. */
  private claimLive(sessionIds: readonly SessionId[]): ClaimedHandle[] {
    const claimed: ClaimedHandle[] = []
    try {
      for (const sessionId of sessionIds) {
        const session = this.ctx.sessions.get(sessionId)
        if (session === undefined) continue
        const agent = this.ctx.agents.get(sessionId)
        if (agent === undefined || agent.session !== session) {
          throw new SessionDeletionError(
            `live session "${sessionId}" has no owning Agent`,
            'SESSION_HANDLE_NOT_RETAINED',
            sessionId,
          )
        }
        const attempt = this.ctx.agents.reserveIdleDisposal(sessionId)
        if (attempt.kind === 'unowned') {
          throw new SessionDeletionError(
            `live session "${sessionId}" has no retained idle-disposal AgentHandle`,
            'SESSION_HANDLE_NOT_RETAINED',
            sessionId,
          )
        }
        if (attempt.kind === 'busy') {
          throw new SessionDeletionError(
            `live session "${sessionId}" has active work, maintenance, or queued input`,
            'SESSION_NOT_IDLE',
            sessionId,
          )
        }
        claimed.push({ sessionId, claim: attempt.reservation, consumed: false })
      }
      return claimed
    } catch (error: unknown) {
      for (const item of claimed) item.claim.release()
      throw error
    }
  }

  /**
   * Permanently remove one Session subtree. All live members are claimed idle
   * before any Agent is disposed; durable records then delete bottom-up.
   * Retrying after partial storage success converges because missing children
   * are skipped and the root remains last.
   * @param rootSessionId - subtree root to delete.
   * @returns immutable plan and ids removed by this attempt.
   */
  async deleteTree(rootSessionId: SessionId): Promise<SessionDeletionResult> {
    if (!this.ctx.sessionPersistence.supportsDeletion) {
      throw new SessionDeletionError(
        'configured Session persistence provider does not support permanent deletion',
        'PERSISTENCE_UNSUPPORTED',
        rootSessionId,
      )
    }
    let sessionIds = bottomUpPlan(rootSessionId, await this.headers(), true)
    if (sessionIds.length === 0) {
      return Object.freeze({
        rootSessionId,
        sessionIds: frozenIds([]),
        deletedSessionIds: frozenIds([]),
      })
    }

    const reservation = this.ctx.sessions.reserveForDeletion(rootSessionId, sessionIds)
    const deletedSessionIds: SessionId[] = []
    let claimed: ClaimedHandle[] = []
    try {
      for (;;) {
        const current = bottomUpPlan(rootSessionId, await this.headers(), true)
        const known = new Set(sessionIds)
        const additions = current.filter(sessionId => !known.has(sessionId))
        reservation.extend(additions)
        sessionIds = current
        if (additions.length === 0) break
      }

      claimed = this.claimLive(sessionIds)
      for (const item of claimed) {
        item.consumed = true
        await item.claim.dispose()
      }
      for (const sessionId of sessionIds) {
        if (this.ctx.sessions.get(sessionId) !== undefined || this.ctx.get('agents')?.get(sessionId) !== undefined) {
          throw new SessionDeletionError(
            `session "${sessionId}" remained live after AgentHandle disposal`,
            'SESSION_STILL_LIVE',
            sessionId,
          )
        }
      }

      for (const sessionId of sessionIds) {
        const deleted = await this.ctx.sessionPersistence.delete(sessionId)
        reservation.complete([sessionId])
        if (deleted !== undefined) deletedSessionIds.push(sessionId)
      }
      return Object.freeze({
        rootSessionId,
        sessionIds: frozenIds(sessionIds),
        deletedSessionIds: frozenIds(deletedSessionIds),
      })
    } finally {
      for (const item of claimed) {
        if (!item.consumed) item.claim.release()
      }
      reservation.release()
    }
  }
}

export default SessionDeletion
