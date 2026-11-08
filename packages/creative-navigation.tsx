import { useEffect, useState } from 'react'
const names: Record<string, string> = {
  'creative.image': '图片',
  'creative.video': '视频',
  'creative.speech': '语音',
  'creative.writing': '写作',
  'creative.spine': 'Spine',
  'creative.music': '音乐',
  'creative.model3d': '3D',
  'creative.constellation': '星图'
}
export function CreativeNavigation() {
  const [items, setItems] = useState<{ id: string }[]>([])
  const [error, setError] = useState('')
  const host = (
    window as unknown as { componentHost?: { request(input: unknown): Promise<unknown> } }
  ).componentHost
  useEffect(() => {
    void host
      ?.request({ action: 'listComponents' })
      .then((value) => setItems(value as { id: string }[]))
      .catch((reason) => setError(String(reason)))
  }, [host])
  return (
    <>
      <nav aria-label="已安装的创作工作台" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setError('')
              void host
                ?.request({ action: 'openComponent', componentId: item.id })
                .catch((reason) => setError(String(reason)))
            }}
          >
            {names[item.id] || item.id}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
