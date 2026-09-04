import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Send, Sparkles } from 'lucide-react'
import { api, type ParseResult } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'

type Bubble = {
  id: string
  role: 'user' | 'assistant'
  text: string
  status?: string
}

const SUGGESTIONS = [
  "Approve Sarah's expense report for $200",
  'Create a leave request for Priya next Friday',
  'Reject the Apex Logistics invoice',
  'Raise a purchase order for safety gloves, qty 40, $320',
  'Create a shipment to Dallas DC',
  'Log a quality issue for sensor drift',
]

export function CommandCenter() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const [input, setInput] = useState(params.get('q') || '')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<Bubble[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: `Hi ${user?.full_name.split(' ')[0] || 'there'}. Type a request in plain language. I'll parse intent, check your ${user?.role} permissions, and log the workflow action.`,
      status: 'success',
    },
  ])

  async function submit(command: string) {
    const text = command.trim()
    if (!text || busy) return
    setInput('')
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', text }])
    setBusy(true)
    try {
      const result = await api<ParseResult>('/api/command', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      const extra = result.parsed
        ? ` · ${String((result.parsed as { department?: string }).department || '')} / ${String((result.parsed as { action?: string }).action || '')}`
        : ''
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', text: `${result.summary}${extra}`, status: result.status },
      ])
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: err instanceof Error ? err.message : 'Command failed',
          status: 'needs_info',
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const q = params.get('q')
    if (q) setInput(q)
  }, [params])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit(input)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(input)
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-3xl flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Command Center</h1>
        <p className="text-sm text-slate-500">Natural language in. Governed workflow out.</p>
      </div>
      <div className="flex-1 space-y-3 overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={m.role === 'user' ? 'ml-auto max-w-[85%]' : 'max-w-[90%]'}
          >
            <div
              className={
                m.role === 'user'
                  ? 'rounded-2xl rounded-br-md bg-indigo-600 px-4 py-3 text-sm text-white'
                  : 'rounded-2xl rounded-bl-md border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-800'
              }
            >
              <p>{m.text}</p>
              {m.role === 'assistant' && m.status && (
                <div className="mt-2">
                  <Badge status={m.status} />
                </div>
              )}
            </div>
          </motion.div>
        ))}
        {busy && <p className="text-xs text-slate-400">Parsing intent…</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
            onClick={() => submit(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit} className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-end gap-2">
          <Sparkles className="mb-2 h-4 w-4 text-indigo-600" />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            placeholder="Type a request or command..."
            className="flex-1 resize-none bg-transparent text-sm outline-none"
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
