/** Node stand-in for the workerd-only 'cloudflare:workers' module (unit/integration tests). */
export class DurableObject<Env = unknown> {
  constructor(
    public ctx: unknown,
    public env: Env,
  ) {}
}
