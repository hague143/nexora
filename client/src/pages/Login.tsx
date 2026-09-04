import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'

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
      <Button variant="outline" className="mt-3 w-full" onClick={onGoogle} disabled={busy}>Continue with Google</Button>
      <p className="mt-4 text-center text-sm text-slate-500">
        No account? <Link to="/signup" className="font-semibold text-indigo-700">Start free trial</Link>
      </p>
      <p className="mt-3 text-center text-xs text-slate-400">Demo: maya@northwind.example / demo1234</p>
    </AuthShell>
  )
}

export function Signup() {
  const { signup, google } = useAuth()
  const nav = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    try {
      await signup({
        email: String(form.get('email')),
        password: String(form.get('password')),
        full_name: String(form.get('full_name')),
        company_name: String(form.get('company_name')),
      })
      nav('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setBusy(false)
    }
  }

  async function onGoogle() {
    const email = prompt('Google account email') || ''
    const name = prompt('Full name') || email.split('@')[0]
    if (!email) return
    setBusy(true)
    try {
      await google(email, name)
      nav('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google signup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Start your Nexora trial" subtitle="Your first company workspace is created as admin.">
      <form className="space-y-3" onSubmit={onSubmit}>
        <div>
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" name="full_name" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="company_name">Company</Label>
          <Input id="company_name" name="company_name" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input id="email" name="email" type="email" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" minLength={8} required className="mt-1" />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <Button className="w-full" disabled={busy}>{busy ? 'Creating workspace…' : 'Create account'}</Button>
      </form>
      <Button variant="outline" className="mt-3 w-full" onClick={onGoogle} disabled={busy}>Continue with Google</Button>
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
