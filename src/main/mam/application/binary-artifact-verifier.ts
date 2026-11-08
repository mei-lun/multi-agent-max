import type { LocalArtifactStore } from '../artifacts/local-artifact-store'
let verifier: ((manifest: unknown) => void) | undefined
let prepare: ((manifest: unknown) => Promise<void>) | undefined
export function configureBinaryArtifactVerifier(store: LocalArtifactStore): void {
  verifier = (manifest) => store.verifyAssetBundleSync(manifest)
  prepare = (manifest) => store.prepareAssetBundleVerification(manifest)
}
export async function prepareLocalBinaryArtifact(manifest: unknown): Promise<void> {
  if (!prepare) throw new Error('binary_artifact_store_not_configured')
  await prepare(manifest)
}
export function verifyLocalBinaryArtifact(manifest: unknown): void {
  if (!verifier) throw new Error('binary_artifact_store_not_configured')
  verifier(manifest)
}
