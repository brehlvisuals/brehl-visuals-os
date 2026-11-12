// Profilbild (rund). Ohne Bild: Initiale auf Marken-Verlauf.
import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export function Avatar({ person, size = 32, ring = false, className = '' }) {
  const name = person?.full_name || person?.email || '?'
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) }
  const ringCls = ring ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.95)]' : ''
  if (person?.avatar_url) {
    return <img src={person.avatar_url} alt={name} style={style} className={`rounded-full object-cover flex-shrink-0 ${ringCls} ${className}`} loading="lazy" />
  }
  return (
    <span style={{ ...style, background: 'linear-gradient(135deg,#38b6ff,#ff6b01 55%,#7c3aed)' }}
      className={`rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0 ${ringCls} ${className}`}>
      {name[0].toUpperCase()}
    </span>
  )
}

// Bild auf 400×400 zuschneiden/verkleinern (spart Speicher und lädt schnell)
async function verkleinern(file) {
  const bmp = await createImageBitmap(file)
  const s = Math.min(bmp.width, bmp.height)
  const c = document.createElement('canvas')
  c.width = c.height = 400
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 400, 400)
  return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.86))
}

// Profilbild hochladen (Admin für alle, sonst nur das eigene)
export function AvatarUpload({ person, size = 40, onDone }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  async function hochladen(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true)
    try {
      const blob = await verkleinern(f)
      const path = `${person.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      const { error } = await supabase.storage.from('avatare').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (error) throw error
      const url = supabase.storage.from('avatare').getPublicUrl(path).data.publicUrl
      const { error: e2 } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', person.id)
      if (e2) throw e2
      onDone?.(url)
    } catch (err) {
      alert('Profilbild konnte nicht gespeichert werden: ' + (err?.message || err))
    }
    setBusy(false)
  }
  return (
    <button type="button" onClick={() => input.current?.click()} title="Profilbild ändern"
      className="relative group rounded-full flex-shrink-0 active:scale-95 transition-transform">
      <Avatar person={person} size={size} />
      <span className="absolute inset-0 rounded-full bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-semibold">
        {busy ? '…' : 'Ändern'}
      </span>
      {busy && <span className="absolute inset-0 rounded-full bg-black/35 flex items-center justify-center text-white text-[10px]">…</span>}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={hochladen} />
    </button>
  )
}
