import * as TabsPrimitive from '@radix-ui/react-tabs'
import type * as React from 'react'
import { cn } from '../../lib/class-name'

export const Tabs = TabsPrimitive.Root

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>): React.JSX.Element {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex h-8 items-center rounded-md bg-muted p-1 text-muted-foreground', className)}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>): React.JSX.Element {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-6 items-center justify-center rounded px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs',
        className
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>): React.JSX.Element {
  return <TabsPrimitive.Content className={cn('mt-3 outline-none', className)} {...props} />
}
