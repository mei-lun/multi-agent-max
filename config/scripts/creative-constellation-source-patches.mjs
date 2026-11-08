import { readFile } from 'node:fs/promises'
// UI and package worker must normalize the same file ports before planning edges.
export const constellationFilePortsPlugin = {
  name: 'owned-file-content-ports',
  setup(builder) {
    builder.onLoad({ filter: /[\\/]lib[\\/]constellation\.ts$/ }, async (args) => {
      let contents = await readFile(args.path, 'utf8')
      const marker = '  if (!attachments.length) return {};'
      if (!contents.includes(marker)) throw Error('File output transform anchor changed')
      contents = contents.replace(
        marker,
        marker +
          '\n  if (!text?.trim() && attachments.some(item => item.kind === "file")) text = attachments.map(item => item.content || "Unparsed file: " + item.name).join("\\n");'
      )
      return { contents, loader: 'ts' }
    })
  }
}
