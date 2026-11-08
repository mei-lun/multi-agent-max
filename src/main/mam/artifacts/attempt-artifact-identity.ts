import { createHash } from 'node:crypto'

export function attemptArtifactId(attemptId: string, contractId: string, index: number): string {
  const digest = createHash('sha256')
    .update(`${attemptId}\0${contractId}\0${String(index)}`)
    .digest('hex')
  return `artifact.${digest.slice(0, 40)}`
}
