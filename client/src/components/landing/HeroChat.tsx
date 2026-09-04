import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Sparkles } from 'lucide-react'

const COMMAND = "Approve Sarah's expense report for $200"
const REPLY = "Approved Sarah's $200 expense report"

export function HeroChat() {
  const [typed, setTyped] = useState('')
  const [showReply, setShowReply] = useState(false)

  useEffect(() => {
    setTyped('')
    setShowReply(false)
    let i = 0
    const id = window.setInterval(() => {
      i += 1
      setTyped(COMMAND.slice(0, i))
      if (i >= COMMAND.length) {
        window.clearInterval(id)
        window.setTimeout(() => setShowReply(true), 420)
      }
    }, 38)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-indigo-100/60">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Sparkles className="h-4 w-4 text-indigo-600" />
          Command Center
        </div>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Live</span>
      </div>
      <div className="space-y-3">
        <div className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-3 text-sm text-white">
          {typed}
          <motion.span
            className="ml-0.5 inline-block h-4 w-0.5 bg-white align-middle"
            animate={{ opacity: typed.length === COMMAND.length ? 0 : [1, 0] }}
            transition={{ repeat: Infinity, duration: 0.7 }}
          />
        </div>
        {showReply && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-[92%] rounded-2xl rounded-bl-md border border-slate-100 bg-slate-50 px-4 py-3"
          >
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
              <div>
                <p className="text-sm font-medium text-slate-800">{REPLY}</p>
                <p className="mt-1 text-xs text-slate-500">Finance · expense · logged to Activity Log</p>
                <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Success</span>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
