import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MamDesignDraftSchema,
  type MamDesignDraft,
  type MamDesignUpdateProposalInput
} from '../../../../shared/mam/design-assistant'
import { getMamRendererApi } from '../../renderer-api'

export type MamDesignAssistantState = Readonly<{
  draft?: MamDesignDraft
  loading: boolean
  sending: boolean
  creatingTemplate: boolean
  applying: boolean
  error?: string
  selectModel(modelProfileId: string): Promise<void>
  sendMessage(message: string, modelProfileId: string): Promise<void>
  cancelMessage(): Promise<void>
  reset(modelProfileId?: string): Promise<void>
  createTemplate(modelProfileId: string): Promise<void>
  retryGeneration(): Promise<void>
  updateProposal(input: MamDesignUpdateProposalInput): Promise<void>
  applyProposal(proposalHash: string): Promise<void>
}>

export function useMamDesignAssistant(onApplied: () => void): MamDesignAssistantState {
  const [draft, setDraft] = useState<MamDesignDraft>()
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string>()
  const requestId = useRef<string | undefined>(undefined)
  const mounted = useRef(true)
  const acceptDraft = useCallback((value: unknown) => {
    if (mounted.current) setDraft(MamDesignDraftSchema.parse(value))
  }, [])
  const refresh = useCallback(async () => {
    try {
      acceptDraft(await getMamRendererApi().getDesignDraft())
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [acceptDraft])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
    }
  }, [refresh])

  const selectModel = useCallback(
    async (modelProfileId: string) => {
      setError(undefined)
      try {
        acceptDraft(await getMamRendererApi().selectDesignModel({ modelProfileId }))
      } catch (cause) {
        if (mounted.current) setError(errorMessage(cause))
      }
    },
    [acceptDraft]
  )
  const sendMessage = useCallback(
    async (message: string, modelProfileId: string) => {
      setSending(true)
      setError(undefined)
      const id = `design-request.${crypto.randomUUID().replaceAll('-', '')}`
      requestId.current = id
      setDraft((current) =>
        current
          ? {
              ...current,
              selectedModelProfileId: modelProfileId,
              messages: [
                ...current.messages,
                {
                  id: `design-message.pending.${crypto.randomUUID().replaceAll('-', '')}`,
                  role: 'user' as const,
                  content: message,
                  createdAt: new Date().toISOString()
                }
              ].slice(-200),
              updatedAt: new Date().toISOString()
            }
          : current
      )
      try {
        acceptDraft(
          await getMamRendererApi().sendDesignMessage({
            requestId: id,
            modelProfileId,
            message
          })
        )
      } catch (cause) {
        if (mounted.current) setError(errorMessage(cause))
        await refresh()
      } finally {
        requestId.current = undefined
        if (mounted.current) setSending(false)
      }
    },
    [acceptDraft, refresh]
  )
  const cancelMessage = useCallback(async () => {
    const id = requestId.current
    if (id) await getMamRendererApi().cancelDesignMessage({ requestId: id })
  }, [])
  const reset = useCallback(
    async (modelProfileId?: string) => {
      setError(undefined)
      acceptDraft(
        await getMamRendererApi().resetDesignDraft(modelProfileId ? { modelProfileId } : {})
      )
    },
    [acceptDraft]
  )
  const createTemplate = useCallback(
    async (modelProfileId: string) => {
      setCreatingTemplate(true)
      setError(undefined)
      try {
        acceptDraft(await getMamRendererApi().createDesignTemplate({ modelProfileId }))
      } catch (cause) {
        if (mounted.current) setError(errorMessage(cause))
      } finally {
        if (mounted.current) setCreatingTemplate(false)
      }
    },
    [acceptDraft]
  )
  const retryGeneration = useCallback(async () => {
    setSending(true)
    setError(undefined)
    const id = `design-retry.${crypto.randomUUID().replaceAll('-', '')}`
    requestId.current = id
    try {
      acceptDraft(await getMamRendererApi().retryDesignGeneration({ requestId: id }))
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause))
      await refresh()
    } finally {
      requestId.current = undefined
      if (mounted.current) setSending(false)
    }
  }, [acceptDraft, refresh])
  const updateProposal = useCallback(
    async (input: MamDesignUpdateProposalInput) => {
      setError(undefined)
      try {
        acceptDraft(await getMamRendererApi().updateDesignProposal(input))
      } catch (cause) {
        if (mounted.current) setError(errorMessage(cause))
        throw cause
      }
    },
    [acceptDraft]
  )
  const applyProposal = useCallback(
    async (proposalHash: string) => {
      setApplying(true)
      setError(undefined)
      try {
        await getMamRendererApi().applyDesignProposal({ proposalHash })
        await refresh()
        onApplied()
      } catch (cause) {
        if (mounted.current) setError(errorMessage(cause))
        throw cause
      } finally {
        if (mounted.current) setApplying(false)
      }
    },
    [onApplied, refresh]
  )
  return {
    ...(draft ? { draft } : {}),
    loading,
    sending,
    creatingTemplate,
    applying,
    ...(error ? { error } : {}),
    selectModel,
    sendMessage,
    cancelMessage,
    reset,
    createTemplate,
    retryGeneration,
    updateProposal,
    applyProposal
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
