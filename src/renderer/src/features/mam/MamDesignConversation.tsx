import { Loader2, MessageSquareText, Send, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MamDesignMessage } from '../../../../shared/mam/design-assistant'
import type { MamDesignReview } from '../../../../shared/mam/design-proposal'
import type {
  MamDesignBrainstormDecision,
  MamDesignBrainstormState
} from '../../../../shared/mam/design-brainstorm'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { MamDesignConversationReview } from './MamDesignConversationReview'
import { MamDesignBrainstormPanel } from './MamDesignBrainstormPanel'

export function MamDesignConversation({
  messages,
  brainstorm,
  review,
  sending,
  disabled,
  error,
  onSend,
  onDecision,
  onCancel
}: Readonly<{
  messages: readonly MamDesignMessage[]
  brainstorm?: MamDesignBrainstormState
  review?: MamDesignReview
  sending: boolean
  disabled: boolean
  error?: string
  onSend(message: string): Promise<void>
  onDecision(message: string, decision: MamDesignBrainstormDecision): Promise<void>
  onCancel(): Promise<void>
}>): React.JSX.Element {
  const [message, setMessage] = useState('')
  const latestMessage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    latestMessage.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, sending])
  const submit = (): void => {
    const content = message.trim()
    if (!content || disabled || sending) return
    setMessage('')
    void onSend(content)
  }
  return (
    <section
      className="flex min-h-0 flex-col border-r border-border"
      aria-label="Design conversation"
      aria-busy={sending}
    >
      <div
        role="log"
        className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-4"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
            <MessageSquareText className="mb-3 size-7 text-muted-foreground" />
            <p className="text-sm font-medium">Describe the outcome you want</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              Include the work to perform, the people or specialties involved, and where you want
              human review.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((item) => (
              <article
                key={item.id}
                data-role={item.role}
                className={
                  item.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground'
                    : 'max-w-[92%] border-l-2 border-border py-1 pl-3 text-sm leading-6'
                }
              >
                <span className="sr-only">
                  {item.role === 'user' ? 'Your message' : 'Design Assistant'}:
                </span>
                <p data-i18n-skip className="break-words whitespace-pre-wrap">
                  {item.content}
                </p>
              </article>
            ))}
            {brainstorm && (
              <MamDesignBrainstormPanel
                brainstorm={brainstorm}
                pending={sending}
                onAnswer={onSend}
                onDecision={onDecision}
              />
            )}
            {review && <MamDesignConversationReview review={review} />}
            {sending && (
              <div className="flex items-center gap-2 border-l-2 border-border py-2 pl-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Building the next draft…
              </div>
            )}
            <div ref={latestMessage} />
          </div>
        )}
      </div>
      <div className="border-t border-border p-3">
        {error && (
          <p
            role="alert"
            className="mb-2 rounded-md border border-destructive p-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            className="max-h-40 min-h-20 resize-none"
            value={message}
            disabled={disabled || sending}
            aria-label="Design request"
            placeholder="Describe roles, stages, constraints, and review points…"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit()
              }
            }}
          />
          {sending ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Stop generating"
                  onClick={() => void onCancel()}
                >
                  <Square />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop generating</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  aria-label="Send message"
                  disabled={disabled || !message.trim()}
                  onClick={submit}
                >
                  <Send />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send message</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </section>
  )
}
