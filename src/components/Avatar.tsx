import { useState } from 'react'
import { avatarColour, initials } from '../lib/avatar-core.js'
import { useAvatarUrl } from '../lib/avatar'

/** Profile photo, or initials on a colour from the user ID when there is no photo or it can't load.
 *  Decorative: the person's name is always shown next to it. */
export function Avatar({ userId, name, path, size = 32, className = '' }:
  { userId: string | null | undefined; name: string | null | undefined; path?: string | null; size?: number; className?: string }) {
  const url = useAvatarUrl(path)
  const [failed, setFailed] = useState<string | null>(null)
  const showPhoto = url && failed !== url
  return (
    <span className={`avatar ${className}`.trim()} aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: showPhoto ? undefined : avatarColour(userId) }}>
      {showPhoto ? <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(url)} />
        : initials(name)}
    </span>
  )
}
