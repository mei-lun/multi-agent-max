export class CreativeReconciliationRequired extends Error {
  readonly code = 'creative_reconciliation_required'
  constructor(message: string) {
    super(message)
    this.name = 'CreativeReconciliationRequired'
  }
}
