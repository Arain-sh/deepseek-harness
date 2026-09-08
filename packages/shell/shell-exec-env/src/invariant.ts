/** Package-owned invariant companion for `@deepseek-ai/dsh-shell-exec-env`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-shell-exec-env'
/** Cordis companion plugin name. */
export const name = 'shell-exec-env-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']
/** No runtime invariant: registration and collection validate every owned key and returned value. */
const install: InvariantInstaller = () => {}
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context that owns the invariant registry.
 * @returns the companion disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
