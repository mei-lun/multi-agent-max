import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const acceptanceRoot = join(root, 'docs', 'acceptance')
const logRoot = join(acceptanceRoot, 'final-command-logs')
const reportPath = join(acceptanceRoot, 'final-traceability.json')
const canary = `mam-final-secret-${Date.now()}-${process.pid}`
mkdirSync(logRoot, { recursive: true })

const commands = [
  command('core', ['verify']),
  command('desktop', ['smoke:desktop']),
  command('desktop-seeded', ['smoke:desktop:seeded']),
  command('executor-probe', ['probe:executors']),
  command('pi-smoke', ['smoke:pi']),
  command('source-manifest', [
    'manifest:source',
    '--',
    process.env.MAM_SOURCE_REPOSITORY ?? join(homedir(), 'Documents', 'multi-agent-max')
  ])
]
const commandResults = Object.fromEntries(commands.map((item) => [item.id, runCommand(item)]))
const probe = readJson(join(acceptanceRoot, 'executor-interface-probe.json'))
const virtualResults = {
  'pi-probe': probeResult(probe, 'pi-rpc')
}
const allCommandResults = { ...commandResults, ...virtualResults }
const canaryHits = scanCanary(canary)
const criteria = coverage().map((criterion) => evaluateCriterion(criterion, allCommandResults))
const legacyMapping = evaluateLegacyMapping()
const overallPassed =
  criteria.every((criterion) => criterion.status === 'passed') &&
  legacyMapping.status === 'passed' &&
  canaryHits.length === 0
const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  status: overallPassed ? 'passed' : 'failed',
  scope: {
    executorKinds: ['pi-rpc'],
    deferredRequirementIds: ['MAM2-EXEC-001', 'MAM2-EXEC-002', 'MAM2-EXEC-004']
  },
  platform: process.platform,
  architecture: process.arch,
  commands: Object.entries(allCommandResults).map(([id, result]) => ({ id, ...result })),
  criteria,
  legacyMapping,
  secretCanary: { status: canaryHits.length === 0 ? 'passed' : 'failed', hitPaths: canaryHits }
}
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
process.stdout.write(
  `${JSON.stringify({ status: report.status, reportPath, failedCriteria: criteria.filter((item) => item.status !== 'passed').map((item) => item.id) }, null, 2)}\n`
)
if (!overallPassed) process.exitCode = 2

function command(id, args) {
  return { id, args, display: `pnpm ${args.join(' ')}` }
}

function runCommand(item) {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(executable, item.args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MAM_SECRET_FINAL_CANARY: canary },
    timeout: 300_000,
    maxBuffer: 20 * 1024 * 1024
  })
  const logPath = join(logRoot, `${item.id}.log`)
  const output = [
    `$ ${item.display}`,
    `exitCode=${String(result.status)}`,
    result.stdout ?? '',
    result.stderr || result.error?.message || ''
  ].join('\n')
  writeFileSync(logPath, output, 'utf8')
  return {
    status: result.status === 0 ? 'passed' : 'failed',
    command: item.display,
    exitCode: result.status,
    evidence: relative(root, logPath),
    ...(result.error ? { reason: result.error.message } : {})
  }
}

function probeResult(report, kind) {
  const item = report?.probes?.find((candidate) => candidate.kind === kind)
  return {
    status: item?.status === 'ready' ? 'passed' : 'failed',
    evidence: 'docs/acceptance/executor-interface-probe.json',
    ...(item?.status === 'ready' ? {} : { reason: String(item?.status ?? 'probe_missing') })
  }
}

function evaluateCriterion(criterion, results) {
  const missingPaths = criterion.paths.filter((path) => !existsSync(join(root, path)))
  const failedCommands = criterion.commands.filter((id) => results[id]?.status !== 'passed')
  const status = missingPaths.length === 0 && failedCommands.length === 0 ? 'passed' : 'failed'
  return {
    ...criterion,
    status,
    evidence: criterion.commands.map((id) => results[id]?.evidence).filter(Boolean),
    ...(missingPaths.length > 0 ? { missingPaths } : {}),
    ...(failedCommands.length > 0 ? { failedCommands } : {})
  }
}

function coverage() {
  const core = ['core']
  const rows = [
    row(
      'MAM2-APP-001',
      ['src/main/index.ts', 'src/renderer/src/App.tsx'],
      [...core, 'desktop', 'desktop-seeded', 'source-manifest']
    ),
    row('MAM2-APP-002', ['src/shared/mam/application-api.ts', 'src/main/ipc/mam-ipc.ts'], core),
    row(
      'MAM2-WORKFLOW-001',
      [
        'src/renderer/src/features/mam/MamWorkflowEditor.tsx',
        'src/main/mam/workflow/workflow-compiler.test.ts',
        'src/main/mam/application/workflow-run-factory.test.ts',
        'src/main/mam/application/system-node-advancement.real-git.test.ts'
      ],
      core
    ),
    row(
      'MAM2-UI-001',
      ['src/renderer/src/App.tsx', 'src/renderer/src/features/mam/MamRunsPage.test.tsx'],
      [...core, 'desktop-seeded']
    ),
    row(
      'MAM2-HUMAN-001',
      [
        'src/shared/mam/domain/human-attention.test.ts',
        'src/main/mam/state-store/human-attention-event-application.test.ts',
        'src/renderer/src/features/mam/MamHumanAttentionDialog.tsx'
      ],
      core
    ),
    row(
      'MAM2-HUMAN-002',
      [
        'src/shared/mam/domain/domain-contracts.test.ts',
        'src/main/mam/scheduler/kernel.test.ts',
        'src/renderer/src/features/mam/MamHumanReviewDialog.tsx'
      ],
      core
    ),
    row('MAM2-STATE-001', ['src/main/mam/state-store/git-state-repository.real-git.test.ts'], core),
    row('MAM2-STATE-002', ['src/main/mam/state-store/git-state-repository.real-git.test.ts'], core),
    row('MAM2-STATE-003', ['src/main/mam/state-store/git-state-repository.real-git.test.ts'], core),
    row(
      'MAM2-STATE-004',
      ['src/main/desktop-seeded-project.smoke.ts'],
      [...core, 'desktop-seeded']
    ),
    row(
      'MAM2-ASSIGN-001',
      ['src/main/mam/application/mam-ui-command-service.real-git.test.ts'],
      core
    ),
    row(
      'MAM2-PRESENCE-001',
      ['src/main/mam/state-store/git-state-repository.real-git.test.ts'],
      core
    ),
    row(
      'MAM2-EXEC-003',
      ['src/main/mam/executors/pi-rpc-real-process.test.ts'],
      [...core, 'pi-probe', 'pi-smoke']
    ),
    row(
      'MAM2-RESULT-001',
      [
        'src/main/mam/artifacts/attempt-result-builder.ts',
        'src/main/mam/application/mam-attempt-execution-service.real-git.test.ts'
      ],
      core
    ),
    row(
      'MAM2-RESOURCE-001',
      [
        'src/main/mam/profiles/attempt-resource-materializer.ts',
        'src/main/mam/application/executor-capability-bridge.test.ts',
        'src/main/mam/profiles/attempt-config-resolver.test.ts'
      ],
      core
    ),
    row(
      'MAM2-SECURITY-001',
      [
        'src/main/mam/gateways/capability-gateways.test.ts',
        'src/main/mam/diagnostics/diagnostics-recorder.ts'
      ],
      core
    ),
    row(
      'MAM2-ARTIFACT-001',
      [
        'src/main/mam/application/attempt-artifact-validator.ts',
        'src/renderer/src/features/mam/MamAttemptPanel.tsx'
      ],
      core
    ),
    row(
      'MAM2-REVIEW-001',
      [
        'src/main/mam/application/review-panel-advancement.ts',
        'src/main/mam/review/review-event-flow.test.ts'
      ],
      core
    ),
    row(
      'MAM2-MERGE-001',
      [
        'src/main/mam/application/mam-merge-queue-execution-service.ts',
        'src/main/mam/application/merge-queue.acceptance.real-git.test.ts',
        'src/main/mam/application/workflow-run-projection.test.ts'
      ],
      core
    ),
    row(
      'MAM2-RECOVERY-001',
      ['src/main/mam/state-store/attempt-recovery-projection.test.ts'],
      core
    ),
    row(
      'MAM2-OBS-001',
      [
        'src/main/mam/diagnostics/diagnostics-recorder.test.ts',
        'src/main/mam/executors/pi-rpc-real-process.test.ts'
      ],
      [...core, 'pi-smoke']
    ),
    row(
      'MAM2-E2E-001',
      ['src/main/mam/application/mam-attempt-execution-service.real-git.test.ts'],
      core
    ),
    row('MAM2-E2E-002', ['src/main/mam/state-store/git-state-repository.real-git.test.ts'], core),
    row(
      'MAM2-E2E-003',
      [
        'src/main/mam/review/review-event-flow.test.ts',
        'src/main/mam/state-store/git-state-repository.real-git.test.ts',
        'src/main/mam/application/review-disagreement-resolution.test.ts'
      ],
      core
    )
  ]
  const invariantPaths = [
    'src/main/mam/scheduler/scheduler-command-authority.ts',
    'src/main/mam/state-store/git-state-repository.real-git.test.ts'
  ]
  for (let index = 1; index <= 10; index += 1)
    rows.push(row(`INV-${String(index).padStart(3, '0')}`, invariantPaths, core))
  for (let index = 11; index <= 16; index += 1)
    rows.push(row(`INV2-${String(index).padStart(3, '0')}`, invariantPaths, core))
  return rows
}

function row(id, paths, commands) {
  return { id, criterion: 'current-authority-acceptance', paths, commands }
}

function evaluateLegacyMapping() {
  const path = join(root, 'docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md')
  const source = readFileSync(path, 'utf8')
  const required = [
    'MAM-APP-001',
    'MAM-STATE-001',
    'MAM-DEVICE-001',
    'MAM-RUNTIME-001',
    'MAM-SECURITY-001',
    'MAM-OBS-001',
    'MAM-E2E-001',
    'INV-001',
    'INV-010',
    'M0-N1',
    'M3-N1',
    'M6-N2',
    'M10-N4'
  ]
  const missing = required.filter((id) => !source.includes(id))
  return {
    status: missing.length === 0 ? 'passed' : 'failed',
    evidence: relative(root, path),
    ...(missing.length > 0 ? { missing } : {})
  }
}

function scanCanary(value) {
  const hits = []
  for (const path of walk(logRoot)) {
    if (readFileSync(path, 'utf8').includes(value)) hits.push(relative(root, path))
  }
  return hits
}

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}
