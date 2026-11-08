import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import {
  assertAncestors,
  stateSchema,
  verifyPackage,
  validateActive,
  type State
} from './persistence'
import {
  componentManifestSchema,
  componentInstallRequestSchema,
  componentVersionRequestSchema,
  componentIdRequestSchema,
  componentCatalog,
  type ComponentId,
  type ComponentManifest,
  type ComponentCatalogEntry
} from '../../../../shared/mam/components'

export type ComponentRegistryOptions = {
  root: string
  hostVersion: string
  hostApiVersion: string
  platform?: string
  arch?: string
  capabilities?: string[]
  resources?: string[]
}
export class ComponentRegistry {
  private state: State = { schemaVersion: 1, installed: [], active: {} }
  private queue: Promise<unknown> = Promise.resolve()
  private leases = new Map<string, number>()
  private ready: Promise<void>
  constructor(private options: ComponentRegistryOptions) {
    this.ready = this.initialize()
  }
  private async initialize() {
    await assertAncestors(path.join(this.options.root, 'registry.json'))
    await fs.mkdir(this.options.root, { recursive: true })
    let content: string
    try {
      content = await fs.readFile(path.join(this.options.root, 'registry.json'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      content = JSON.stringify(this.state)
    }
    const raw = stateSchema.parse(JSON.parse(content))
    validateActive(raw)
    for (const entry of raw.installed)
      await verifyPackage(this.directory(entry.manifest), entry.manifest)
    this.state = raw
    for (const name of await fs.readdir(this.options.root))
      if (name.startsWith('.stage-'))
        await fs.rm(path.join(this.options.root, name), { recursive: true, force: true })
  }
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.ready
      const before = structuredClone(this.state)
      try {
        return await action()
      } catch (e) {
        this.state = before
        throw e
      }
    })
    this.queue = next.catch(() => {})
    return next
  }
  private async save() {
    await assertAncestors(path.join(this.options.root, 'registry.json'))
    const temp = path.join(this.options.root, `.registry-${randomUUID()}`)
    try {
      const file = await fs.open(temp, 'wx')
      try {
        await file.writeFile(JSON.stringify(this.state))
        await file.sync()
      } finally {
        await file.close()
      }
      await fs.rename(temp, path.join(this.options.root, 'registry.json'))
      if (process.platform !== 'win32') {
        const directory = await fs.open(this.options.root, 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      }
    } finally {
      await fs.rm(temp, { force: true })
    }
  }
  private directory(m: ComponentManifest) {
    return path.join(this.options.root, 'packages', m.id, m.version)
  }
  private missing(m: ComponentManifest) {
    return m.resources.filter((r) => !this.options.resources?.includes(r))
  }
  private compatible(m: ComponentManifest) {
    const a = this.options.hostVersion.split('.').map(Number),
      b = m.minimumHostVersion.split('.').map(Number)
    const versionOK =
      a[0]! > b[0]! || (a[0] === b[0] && (a[1]! > b[1]! || (a[1] === b[1] && a[2]! >= b[2]!)))
    return (
      versionOK &&
      m.hostApiVersion === this.options.hostApiVersion &&
      m.platforms.some(
        (p) =>
          p.os === (this.options.platform ?? process.platform) &&
          p.arch === (this.options.arch ?? process.arch)
      ) &&
      m.operations.every((o) =>
        o.requiredCapabilities.every((c) => this.options.capabilities?.includes(c))
      )
    )
  }
  async list(): Promise<ComponentCatalogEntry[]> {
    await this.ready
    await this.queue
    for (const entry of this.state.installed)
      await verifyPackage(this.directory(entry.manifest), entry.manifest)
    return structuredClone(
      componentCatalog.map((catalog) => ({
        ...catalog,
        available: false,
        versions: this.state.installed
          .filter((r) => r.manifest.id === catalog.id)
          .map((r) => ({
            ...r,
            enabled: this.state.active[catalog.id] === r.manifest.version,
            status: !this.compatible(r.manifest)
              ? 'unsupported'
              : this.missing(r.manifest).length
                ? 'resources-missing'
                : 'installed',
            missingResources: this.missing(r.manifest)
          }))
      }))
    )
  }
  install(input: unknown, authorizeManifest?: (manifest: ComponentManifest) => void) {
    return this.mutate(async () => {
      const request = componentInstallRequestSchema.parse(input)
      const source = path.resolve(request.sourceDirectory)
      await assertAncestors(source)
      if (!(await fs.lstat(source)).isDirectory() || (await fs.lstat(source)).isSymbolicLink())
        throw new Error('Unsafe package directory')
      const manifestPath = path.join(source, 'manifest.json')
      const stat = await fs.lstat(manifestPath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
        throw new Error('Invalid manifest file')
      const manifest = componentManifestSchema.parse(
        JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      )
      authorizeManifest?.(structuredClone(manifest))
      if (!this.compatible(manifest))
        throw new Error('Incompatible host, platform, or capabilities')
      if (
        this.state.installed.some(
          (r) => r.manifest.id === manifest.id && r.manifest.version === manifest.version
        )
      )
        throw new Error('Version already installed')
      const stage = path.join(this.options.root, `.stage-${randomUUID()}`)
      await fs.mkdir(stage)
      try {
        let total = 0
        for (const [relative, hash] of Object.entries(manifest.files)) {
          let current = source
          for (const segment of relative.split('/')) {
            current = path.join(current, segment)
            if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symlink in package')
          }
          const file = await fs.lstat(current)
          if (
            !file.isFile() ||
            file.size > 32 * 1024 * 1024 ||
            (total += file.size) > 128 * 1024 * 1024
          )
            throw new Error('Package file limit')
          const bytes = await fs.readFile(current)
          if (createHash('sha256').update(bytes).digest('hex') !== hash)
            throw new Error('Package content hash mismatch')
          const target = path.join(stage, relative)
          await fs.mkdir(path.dirname(target), { recursive: true })
          await fs.writeFile(target, bytes, { flag: 'wx' })
        }
        const target = this.directory(manifest)
        await assertAncestors(target)
        await fs.mkdir(path.dirname(target), { recursive: true })
        // An unregistered publication is an interrupted install, never an installed version.
        await fs.rm(target, { recursive: true, force: true })
        await fs.rename(stage, target)
        this.state.installed.push({ manifest, verification: 'trusted-local-import' })
        await this.save()
        return structuredClone(manifest)
      } finally {
        await fs.rm(stage, { recursive: true, force: true })
      }
    })
  }
  enable(input: unknown) {
    return this.mutate(async () => {
      const { id, version } = componentVersionRequestSchema.parse(input)
      const m = this.state.installed.find(
        (r) => r.manifest.id === id && r.manifest.version === version
      )?.manifest
      if (!m || !this.compatible(m) || this.missing(m).length)
        throw new Error('Component unavailable')
      if (m.dependencies.some((d) => this.state.active[d.id] !== d.version))
        throw new Error('Dependency unavailable')
      if (
        this.state.installed.some(
          (r) =>
            this.state.active[r.manifest.id] === r.manifest.version &&
            r.manifest.dependencies.some((d) => d.id === id && d.version !== version)
        )
      )
        throw new Error('Active dependent version conflict')
      // Existing leases retain their immutable package version during activation.
      this.state.active[id] = version
      await this.save()
    })
  }
  disable(input: unknown) {
    return this.mutate(async () => {
      const { id } = componentIdRequestSchema.parse(input)
      this.assertUnused(id)
      delete this.state.active[id]
      await this.save()
    })
  }
  private assertUnused(id: ComponentId) {
    if (
      this.leases.get(id) ||
      this.state.installed.some(
        (r) =>
          this.state.active[r.manifest.id] === r.manifest.version &&
          r.manifest.dependencies.some((d) => d.id === id)
      )
    )
      throw new Error('Component in use by job or dependent')
  }
  remove(input: unknown) {
    return this.mutate(async () => {
      const { id, version } = componentVersionRequestSchema.parse(input)
      this.assertUnused(id)
      const entry = this.state.installed.find(
        (r) => r.manifest.id === id && r.manifest.version === version
      )
      if (!entry) throw new Error('Version not installed')
      await assertAncestors(this.directory(entry.manifest))
      this.state.installed = this.state.installed.filter((r) => r !== entry)
      if (this.state.active[id] === version) delete this.state.active[id]
      await this.save()
      // The durable removal already committed; failed physical cleanup is recoverable.
      await fs.rm(this.directory(entry.manifest), { recursive: true, force: true }).catch(() => {})
    })
  }
  acquire(id: ComponentId) {
    return this.acquireVersion(id)
  }
  acquireVersion(id: ComponentId, version?: string) {
    return this.mutate(async () => {
      const manifest = this.state.installed.find(
        (r) => r.manifest.id === id && r.manifest.version === (version ?? this.state.active[id])
      )?.manifest
      if (!manifest || !this.compatible(manifest) || this.missing(manifest).length)
        throw new Error('Component unavailable')
      validateActive(this.state)
      const closure = new Map<ComponentId, ComponentManifest>()
      const visit = async (m: ComponentManifest): Promise<void> => {
        if (closure.has(m.id)) return
        closure.set(m.id, m)
        await verifyPackage(this.directory(m), m)
        for (const dependency of m.dependencies) {
          const found = this.state.installed.find(
            (r) => r.manifest.id === dependency.id && r.manifest.version === dependency.version
          )?.manifest
          if (!found) throw new Error('Dependency unavailable')
          await visit(found)
        }
      }
      await visit(manifest)
      for (const key of closure.keys()) this.leases.set(key, (this.leases.get(key) ?? 0) + 1)
      let released = false
      return {
        manifest: structuredClone(manifest),
        packageDirectory: this.directory(manifest),
        release: () => {
          if (!released) {
            released = true
            for (const key of closure.keys()) this.leases.set(key, (this.leases.get(key) ?? 1) - 1)
          }
        }
      }
    })
  }
}
