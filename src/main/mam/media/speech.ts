export function geminiSpeechBody(prompt: string, voice = 'Kore') {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt.trim() }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  }
}
export function geminiSpeechBytes(raw: Buffer): Buffer {
  const value = JSON.parse(raw.toString()) as {
    candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType?: string } }[] } }[]
  }
  const inline = value.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
  if (!inline || inline.data.length > 44 * 1024 * 1024) throw new Error('Invalid Gemini audio')
  const pcm = Buffer.from(inline.data, 'base64')
  if (!/audio\/(L16|pcm)/i.test(inline.mimeType ?? 'audio/L16') || !pcm.length || pcm.length % 2)
    throw new Error('Unsupported Gemini audio')
  const rate = Number(inline.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000)
  if (!Number.isInteger(rate) || rate < 8000 || rate > 96000) throw new Error('Invalid PCM rate')
  const wav = Buffer.alloc(44 + pcm.length)
  wav.write('RIFF')
  wav.writeUInt32LE(36 + pcm.length, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24)
  wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(pcm.length, 40)
  pcm.copy(wav, 44)
  return wav
}
