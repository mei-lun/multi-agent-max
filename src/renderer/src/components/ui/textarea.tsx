import type * as React from 'react'
import { cn } from '../../lib/class-name'

export function Textarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>): React.JSX.Element {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'scrollbar-sleek min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-xs outline-none transition-colors',
        'placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className
      )}
      {...props}
    />
  )
}
