import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { EMPTY_PROFILE, type Profile, type ProfileApi } from '../lib/profile'
import { errorMessage, toRoleError } from '../lib/roles'

type TextKey = Exclude<keyof Profile, 'availableFrom'>

export function ProfilePage({ api, onBack, onSaved }: { api: ProfileApi; onBack: () => void; onSaved: (p: Profile) => void }) {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE)
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let live = true
    api.get()
      .then((p) => { if (live) { if (p) setProfile(p); setLoaded(true) } })
      .catch(() => { if (live) { setMsg("Couldn't load your profile. Reload the page."); setLoaded(true) } })
    return () => { live = false }
  }, [api])

  const field = (k: TextKey) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile((p) => ({ ...p, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg('Saving…')
    try {
      const saved = await api.save(profile)
      setProfile(saved)
      onSaved(saved)
      setMsg('Saved')
    } catch (err) {
      setMsg(errorMessage(toRoleError(err)))
    }
  }

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>My profile</h1>
          <p className="sub">Private to you. Documents are written only from what you put here and the job posting.</p>
        </div>
        <div className="top-side"><button className="btn" onClick={onBack}>Back to pipeline</button></div>
      </header>
      {!loaded ? <p className="notice">Loading…</p> : (
        <form className="form profile" onSubmit={submit}>
          <label className="full"><span>Headline</span>
            <input id="pf-headline" value={profile.headline} onChange={field('headline')} placeholder="Freelance AI & GCP data engineer" /></label>
          <label><span>Rate</span><input id="pf-rate" value={profile.rate} onChange={field('rate')} placeholder="€100/h or £650/day" /></label>
          <label><span>Available from</span>
            <input id="pf-available" type="date" value={profile.availableFrom ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, availableFrom: e.target.value || null }))} /></label>
          <label><span>Location</span><input id="pf-location" value={profile.location} onChange={field('location')} /></label>
          <label><span>Preferences</span><input id="pf-preferences" value={profile.preferences} onChange={field('preferences')} placeholder="Remote, outside IR35" /></label>
          <label className="full"><span>CV</span>
            <textarea id="pf-cv" className="cv" maxLength={40000} value={profile.cvText} onChange={field('cvText')}
              placeholder="Paste your CV here, as plain text or markdown" /></label>
          <label className="full"><span>Always mention</span>
            <textarea id="pf-always" value={profile.alwaysMention} onChange={field('alwaysMention')} /></label>
          <label className="full"><span>Never mention</span>
            <textarea id="pf-never" value={profile.neverMention} onChange={field('neverMention')} /></label>
          <div className="actions full">
            <button className="btn primary" type="submit">Save profile</button>
            <span className="msg" role="status">{msg}</span>
          </div>
        </form>
      )}
    </main>
  )
}
