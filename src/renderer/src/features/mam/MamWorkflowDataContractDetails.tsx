export function MamWorkflowDataContractDetails({
  children
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-xs font-medium">
        Internal data handoff (advanced)
      </summary>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        MAM generates these contracts to validate handoffs between Roles. Users normally describe
        the Task and final result instead of editing this structure.
      </p>
      <div className="mt-3 space-y-3 border-t border-border pt-3">{children}</div>
    </details>
  )
}
