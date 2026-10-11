import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

export function Login() {
  const { login, google } = useAuth()
  const nav = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    try {
      await login(String(form.get('email')), String(form.get('password')))
      nav('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  async function onGoogle() {
    setBusy(true)
    setError('')
    try {
      await google('maya@northwind.example', 'Maya Chen')
      nav('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Sign in to Nexora" subtitle="Use the demo workspace or your own account.">
      <form className="space-y-3" onSubmit={onSubmit}>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue="maya@northwind.example" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" defaultValue="demo1234" required className="mt-1" />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <Button className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <Button variant="outline" className="mt-3 w-full" onClick={onGoogle} disabled={busy}>Explore the demo workspace</Button>
      <p className="mt-4 text-center text-sm text-slate-500">
        No account? <Link to="/signup" className="font-semibold text-indigo-700">Start free trial</Link>
      </p>
      <p className="mt-3 text-center text-xs text-slate-400">Demo: maya@northwind.example / demo1234</p>
    </AuthShell>
  )
}

export function Signup() {
  const { signup } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [invite, setInvite] = useState<{ email: string; company_name: string; role: string } | null>(null)
  const [inviteChecked, setInviteChecked] = useState(false)
  const [showRequest, setShowRequest] = useState(false)
  const [requestSent, setRequestSent] = useState(false)
  const [noticeMsg, setNoticeMsg] = useState('')

  useEffect(() => {
    const token = params.get('invite')
    if (!token) { setInviteChecked(true); return }
    api<{ email: string; company_name: string; role: string }>(`/api/access/invite/${token}`)
      .then(setInvite)
      .catch(() => setError('This invite link is invalid or expired.'))
      .finally(() => setInviteChecked(true))
  }, [params])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    try {
      await signup({
        email: invite?.email || String(form.get('email')),
        password: String(form.get('password')),
        full_name: String(form.get('full_name')),
        company_name: String(form.get('company_name') || ''),
      })
      nav('/app')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Signup failed'
      setError(msg)
      if (msg.includes('not been invited')) setShowRequest(true)
    } finally {
      setBusy(false)
    }
  }

  async function onRequestAccess(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    try {
      const d = await api<{ message: string }>('/api/access/request', {
        method: 'POST',
        body: JSON.stringify({
          email: String(form.get('req_email')),
          full_name: String(form.get('req_name')),
          company_name: String(form.get('req_company')),
        }),
      })
      setRequestSent(true)
      setError('')
      setNoticeMsg(d.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  if (!inviteChecked) {
    return <AuthShell title="Start your Nexora trial" subtitle="Checking your invite…"><p className="text-sm text-slate-500">Loading…</p></AuthShell>
  }

  return (
    <AuthShell
      title={invite ? 'Join your workspace' : 'Start your Nexora trial'}
      subtitle={invite ? `You've been invited to join ${invite.company_name} as ${invite.role}.` : 'Create your company workspace as admin — or join with an invite.'}
    >
      <form className="space-y-3" onSubmit={onSubmit}>
        <div>
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" name="full_name" required className="mt-1" />
        </div>
        {!invite && (
          <div>
            <Label htmlFor="company_name">Company <span className="font-normal text-slate-400">(leave blank if you were invited)</span></Label>
            <Input id="company_name" name="company_name" className="mt-1" placeholder="Acme Corp" />
          </div>
        )}
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email" name="email" type="email" required className="mt-1"
            defaultValue={invite?.email || ''} readOnly={!!invite}
          />
          {invite && <p className="mt-1 text-xs text-slate-400">This must match the invited email address.</p>}
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" minLength={8} required className="mt-1" />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {noticeMsg && <p className="text-sm text-emerald-600">{noticeMsg}</p>}
        <Button className="w-full" disabled={busy}>{busy ? 'Creating account…' : invite ? 'Join workspace' : 'Create account'}</Button>
      </form>

      {!invite && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {!showRequest ? (
            <button onClick={() => setShowRequest(true)} className="text-sm font-semibold text-indigo-700 hover:underline">
              Don't have an invite? Request access →
            </button>
          ) : requestSent ? (
            <p className="text-sm text-emerald-600">Request sent! Your admin will review it — you'll be able to sign up once approved.</p>
          ) : (
            <form onSubmit={onRequestAccess} className="space-y-3">
              <p className="text-sm font-medium">Request access to a workspace</p>
              <div>
                <Label htmlFor="req_name">Full name</Label>
                <Input id="req_name" name="req_name" required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="req_email">Gmail address</Label>
                <Input id="req_email" name="req_email" type="email" required className="mt-1" placeholder="you@gmail.com" />
              </div>
              <div>
                <Label htmlFor="req_company">Company name</Label>
                <Input id="req_company" name="req_company" required className="mt-1" placeholder="The company you work for" />
              </div>
              <Button variant="outline" className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</Button>
            </form>
          )}
        </div>
      )}

      <p className="mt-4 text-center text-sm text-slate-500">
        Already have access? <Link to="/login" className="font-semibold text-indigo-700">Sign in</Link>
      </p>
    </AuthShell>
  )
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-indigo-950 p-10 text-white md:flex">
        <Link to="/" className="text-lg font-bold">Nexora</Link>
        <div>
          <p className="text-2xl font-semibold leading-snug">Type the work. Keep the audit trail.</p>
          <p className="mt-3 max-w-sm text-sm text-indigo-100/80">Nexora is the operations copilot that turns everyday language into permissioned workflow actions.</p>
        </div>
        <p className="text-xs text-indigo-200/60">Indigo primary · amber accent</p>
      </div>
      <div className="grid place-items-center p-6">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 inline-block font-bold text-indigo-700 md:hidden">Nexora</Link>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  )
}
