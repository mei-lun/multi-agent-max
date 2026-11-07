import { execFile } from 'node:child_process'
import { totalmem, freemem } from 'node:os'
export const musicMemory = () => ({
  totalMiB: Math.floor(totalmem() / 1048576),
  availableMiB: Math.floor(freemem() / 1048576)
})
export function parseMusicGpus(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .flatMap((line) => {
      const parts = line.split(',').map((value) => value.trim())
      const total = Number(parts[1]),
        free = Number(parts[2])
      return parts.length === 4 &&
        parts[0] &&
        Number.isSafeInteger(total) &&
        total > 0 &&
        Number.isSafeInteger(free) &&
        free >= 0 &&
        free <= total
        ? [{ name: parts[0], totalMiB: total, freeMiB: free, driver: parts[3] }]
        : []
    })
}
export async function musicHardware() {
  return new Promise((resolve) =>
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.free,driver_version', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 5000, maxBuffer: 65536 },
      (error, stdout) =>
        resolve({
          gpus: error ? [] : parseMusicGpus(stdout),
          memory: musicMemory(),
          checkedAt: Math.floor(Date.now() / 1000),
          ...(error ? { error: 'NVIDIA hardware detection unavailable' } : {})
        })
    )
  )
}
