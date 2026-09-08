/** Package-owned invariant companion for `@deepseek-ai/dsh-session-deletion`. @module @deepseek-ai/dsh-session-deletion/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-deletion'

/** Cordis companion plugin name. */
export const name = 'session-deletion-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: deletion is a one-shot operation whose authoritative
 * relations are consumed or removed at commit; focused lifecycle and dual-
 * backend tests cover those transitions.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['sessionDeletion'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
