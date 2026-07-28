import { spawn } from 'node:child_process'
import type { CodexHeadlessInvocation } from './codex-headless-invocation'

const MAX_OUTPUT_BYTES = 20 * 1024 * 1024

export type CodexProcessResult = Readonly<{
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
}>

export type CodexProcessRunner = (
  invocation: CodexHeadlessInvocation,
  timeoutMs: number
) => Promise<CodexProcessResult>

export const runCodexProcess: CodexProcessRunner = (invocation, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(invocation.executablePath, [...invocation.args], {
      cwd: invocation.cwd,
      env: { ...invocation.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM')
        reject(new Error('codex_stdout_limit_exceeded'))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM')
        reject(new Error('codex_stderr_limit_exceeded'))
        return
      }
      stderr.push(chunk)
    })
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer)
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut
      })
    })
    child.stdin.end(inputBytes(invocation.input))
  })

function inputBytes(input: string): Buffer {
  return Buffer.from(input.endsWith('\n') ? input : `${input}\n`, 'utf8')
}
