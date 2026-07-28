import { describe, expect, it } from 'vitest'
import type { ExecutorProfile } from '../../../shared/mam/domain/execution-profile'
import {
  ExecutorLocalPreflight,
  type ExecutorProbe,
  type ExecutorProbeResult
} from './executor-local-preflight'

describe('Executor local preflight', () => {
  it('detects the Codex headless structured interface and isolated config flags', () => {
    const preflight = new ExecutorLocalPreflight(
      probeWith({
        '--version': success('codex-cli 0.146.0'),
        'exec --help': success(
          '--json --output-schema --ignore-user-config --ephemeral --model -c, --config'
        )
      })
    )
    const result = preflight.check(executor('codex-cli'), binding())
    expect(result).toMatchObject({
      ok: true,
      version: 'codex-cli 0.146.0',
      capabilities: {
        supportsStructuredOutput: true,
        supportsCustomEndpoint: true,
        supportsInvocationReconnect: false
      }
    })
  })

  it('detects Codex app-server reconnect capability separately', () => {
    const preflight = new ExecutorLocalPreflight(
      probeWith({
        '--version': success('codex-cli 0.146.0'),
        'app-server --help': success('--listen generate-json-schema -c, --config')
      })
    )
    const profile = {
      ...executor('codex-cli'),
      adapterOptions: { mode: 'app-server' }
    }
    expect(preflight.check(profile, binding())).toMatchObject({
      ok: true,
      capabilities: { supportsInvocationReconnect: true }
    })
  })

  it('fails clearly for a missing executable or non-structured Grok CLI', () => {
    const missing = new ExecutorLocalPreflight(() => ({
      exitCode: null,
      stdout: '',
      stderr: 'spawn ENOENT'
    }))
    expect(missing.check(executor('grok-cli'), binding('grok'))).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'executable_unavailable' })]
    })

    const textOnly = new ExecutorLocalPreflight(
      probeWith({
        '--version': success('grok 1.0.0'),
        'agent --help': success('Interactive terminal client')
      })
    )
    expect(textOnly.check(grokExecutor(), binding('grok'))).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'structured_interface_unavailable' })]
    })
  })

  it('accepts only the verified Grok ACP stdio command surface', () => {
    const ready = new ExecutorLocalPreflight(
      probeWith({
        '--version': success('grok 0.2.110'),
        'agent --help': success('stdio --model <model> --no-leader')
      })
    )
    expect(ready.check(grokExecutor(), binding('grok'))).toMatchObject({
      ok: true,
      capabilities: {
        supportedProtocols: ['openai-completions', 'executor-native'],
        supportsCustomEndpoint: true,
        supportsStructuredOutput: true
      },
      evidence: [
        'version:grok 0.2.110',
        'grok-agent:stdio',
        'grok-agent:--model',
        'grok-agent:--no-leader'
      ]
    })
  })

  it('requires the Pi RPC machine interface', () => {
    const ready = new ExecutorLocalPreflight(
      probeWith({
        '--version': success('pi 0.81.1'),
        '--help': success('--mode rpc')
      })
    )
    expect(ready.check(executor('pi-rpc'), binding('pi'))).toMatchObject({
      ok: true,
      capabilities: {
        supportsStructuredOutput: true,
        supportsPerInstanceConfig: true,
        supportsInvocationReconnect: false
      }
    })

    const textOnly = new ExecutorLocalPreflight(
      probeWith({
        '--version': success('pi 0.81.1'),
        '--help': success('Interactive terminal client')
      })
    )
    expect(textOnly.check(executor('pi-rpc'), binding('pi'))).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'structured_interface_unavailable' })]
    })
  })
})

function executor(kind: ExecutorProfile['kind']): ExecutorProfile {
  return {
    id: `executor.${kind}`,
    version: 1,
    kind,
    executableRef: `executable.${kind}`,
    adapterOptions: { mode: 'headless' }
  }
}

function grokExecutor(): ExecutorProfile {
  return { ...executor('grok-cli'), adapterOptions: { mode: 'acp' } }
}

function binding(executablePath = 'codex') {
  const kind =
    executablePath === 'codex' ? 'codex-cli' : executablePath === 'pi' ? 'pi-rpc' : 'grok-cli'
  return {
    id: `binding.${kind}`,
    executorProfileId: `executor.${kind}`,
    executablePath,
    configRoot: '/tmp/mam-executors',
    bindingIdentity: 'local.machine'
  }
}

function probeWith(results: Readonly<Record<string, ExecutorProbeResult>>): ExecutorProbe {
  return (_executablePath, args) =>
    results[args.join(' ')] ?? { exitCode: 1, stdout: '', stderr: 'unexpected probe' }
}

function success(stdout: string): ExecutorProbeResult {
  return { exitCode: 0, stdout, stderr: '' }
}
