import { readFileSync, writeFileSync } from 'node:fs'
import { signCatalog, verifyCatalog, manifestHash } from './creative-catalog-signature.mjs'
const [action, input, keyFile, keyIdOrOutput, output] = process.argv.slice(2)
const json = (file) => JSON.parse(readFileSync(file, 'utf8'))
if (action === 'sign')
  writeFileSync(
    output,
    JSON.stringify(signCatalog(json(input), keyIdOrOutput, readFileSync(keyFile)), null, 2),
    { flag: 'wx' }
  )
else if (action === 'verify')
  console.log(JSON.stringify(verifyCatalog(json(input), json(keyFile)), null, 2))
else if (action === 'verify-package') {
  const catalog = verifyCatalog(json(input), json(keyFile)),
    manifest = json(keyIdOrOutput)
  if (
    !catalog.packages.some(
      (p) =>
        p.id === manifest.id &&
        p.version === manifest.version &&
        p.manifestSha256 === manifestHash(manifest)
    )
  )
    throw Error('Package not authorized by catalog')
  console.log(
    'Signed package manifest verified; activate explicitly after normal byte-verified local import'
  )
} else
  throw Error(
    'Use sign <catalog> <private.pem> <keyId> <output>, verify <signed> <trusted-keys.json>, verify-package <signed> <trusted-keys.json> <manifest>'
  )
