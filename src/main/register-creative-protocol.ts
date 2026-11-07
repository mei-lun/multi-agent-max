import { protocol } from 'electron'

export function registerCreativeProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'mam-component', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}
