export const PI_ISOLATED_LAUNCHER_SOURCE = `import { spawn } from 'node:child_process'

const executable = process.env.MAM_PI_EXECUTABLE
const allowedKeysSource = process.env.MAM_PI_ENVIRONMENT_KEYS
if (!executable || !allowedKeysSource) {
  console.error('missing isolated Pi launcher configuration')
  process.exit(64)
}

const childEnvironment = {}
for (const key of JSON.parse(allowedKeysSource)) {
  const value = process.env[key]
  if (value !== undefined) childEnvironment[key] = value
}

const child = spawn(process.execPath, [executable, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: ['inherit', 'inherit', 'pipe'],
  windowsHide: true
})
const secrets = Object.entries(childEnvironment)
  .filter(([key]) => /(?:key|token|secret|password|credential)/i.test(key))
  .map(([, value]) => value)
  .filter(Boolean)
const carryLength = Math.max(512, ...secrets.map((secret) => secret.length))
let stderrCarry = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => {
  const combined = stderrCarry + chunk
  if (combined.length <= carryLength) {
    stderrCarry = combined
    return
  }
  process.stderr.write(redact(combined.slice(0, -carryLength)))
  stderrCarry = combined.slice(-carryLength)
})
child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 70
})
child.on('close', (code, signal) => {
  if (stderrCarry) process.stderr.write(redact(stderrCarry))
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 70)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

function redact(value) {
  let redacted = value
    .replace(/Bearer\\s+[^\\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\\b(?:sk|xai|api)-[A-Za-z0-9_-]{8,}\\b/g, '[REDACTED]')
    .replace(/mam-canary-secret-[A-Za-z0-9_-]+/g, '[REDACTED]')
  for (const secret of secrets) redacted = redacted.replaceAll(secret, '[REDACTED]')
  return redacted
}
`
