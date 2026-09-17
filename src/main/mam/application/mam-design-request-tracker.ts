import type { MamDesignDraft } from '../../../shared/mam/design-assistant'
import type { MamDesignDraftStore } from './mam-design-draft-store'
import { failMamDesignAssistant } from './mam-design-assistant-error'

export class MamDesignRequestTracker {
  private readonly controllers = new Map<string, AbortController>()

  get active(): boolean {
    return this.controllers.size > 0
  }

  start(requestId: string): AbortController {
    const controller = new AbortController()
    this.controllers.set(requestId, controller)
    return controller
  }

  cancel(requestId: string, reason: string): void {
    const controller = this.controllers.get(requestId)
    if (!controller) return
    this.controllers.delete(requestId)
    controller.abort(reason)
  }

  cancelAll(reason: string): void {
    const controllers = [...this.controllers.values()]
    this.controllers.clear()
    for (const controller of controllers) controller.abort(reason)
  }

  finish(requestId: string, controller: AbortController): void {
    if (this.controllers.get(requestId) === controller) this.controllers.delete(requestId)
  }
}

export function requireCurrentMamDesignRequestDraft(
  drafts: MamDesignDraftStore,
  draftId: string
): void {
  if (drafts.get().id !== draftId) {
    failMamDesignAssistant('design_request_cancelled', 'Design request was cancelled')
  }
}

export function requireEditableMamDesignDraft(drafts: MamDesignDraftStore): MamDesignDraft {
  const draft = drafts.get()
  if (draft.status !== 'draft') {
    failMamDesignAssistant('design_draft_applied', 'Start a new Design before continuing')
  }
  return draft
}
