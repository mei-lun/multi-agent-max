declare module 'cross-spawn' {
  import type { spawnSync } from 'node:child_process'
  const crossSpawn: { sync: typeof spawnSync }
  export default crossSpawn
}
