import {build} from 'esbuild'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'constellation-'))
try{const file=path.join(dir,'core.mjs');await build({entryPoints:[path.join(root,'vendor/levelup/baseline-6542241/src/lib/constellation.ts')],outfile:file,bundle:true,platform:'node',format:'esm'});const c=await import(pathToFileURL(file).href),graph=c.createDefaultConstellationGraph();assert.ok(graph.nodes.length);const saved=c.serializeConstellationGraph(graph);assert.equal(c.normalizeConstellationGraph(saved).nodes.length,graph.nodes.length);const layers=c.constellationExecutionLayers(graph.nodes,graph.edges);assert.ok(layers);assert.ok(Object.keys(c.CONSTELLATION_NODE_DEFINITIONS).length>=12);assert.ok(c.BUILT_IN_CONSTELLATION_BLUEPRINTS.length);console.log('Original DAG normalization, serialization, execution layers,12 node definitions, built-in blueprints passed')}finally{await rm(dir,{recursive:true,force:true})}
