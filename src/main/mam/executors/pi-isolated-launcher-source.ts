export const PI_ISOLATED_LAUNCHER_SOURCE = `import { spawn } from 'node:child_process'

const executable = process.env.MAM_PI_EXECUTABLE
const nodeExecutable = process.env.MAM_PI_NODE_EXECUTABLE
const allowedKeysSource = process.env.MAM_PI_ENVIRONMENT_KEYS
if (!executable || !nodeExecutable || !allowedKeysSource) {
  console.error('missing isolated Pi launcher configuration')
  process.exit(64)
}

const childEnvironment = {}
for (const key of JSON.parse(allowedKeysSource)) {
  const value = process.env[key]
  if (value !== undefined) childEnvironment[key] = value
}

// RpcClient starts this launcher with PATH's node; Pi must use the preflight runtime.
const child = spawn(nodeExecutable, [executable, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: ['inherit', 'inherit', 'pipe'],
  windowsHide: true
})
const secrets = Object.entries(childEnvironment)
  .filter(([key]) => /(?:key|token|secret|password|credential)/i.test(key))
  .map(([, value]) => value)
  .filter(Boolean)
let stderrCarry = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => {
  const combined = stderrCarry + chunk
  // Forward complete error lines before the launcher is terminated, keeping partial lines for redaction.
  const lineEnd = combined.lastIndexOf('\\n') + 1
  if (lineEnd) process.stderr.write(redact(combined.slice(0, lineEnd)))
  stderrCarry = combined.slice(lineEnd)
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
