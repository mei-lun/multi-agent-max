export function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 96)
}
