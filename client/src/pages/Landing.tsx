import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight, Building2, Check, ClipboardCheck, Coins, Factory, Handshake,
  Layers, ShieldCheck, Sparkles, Truck, Users, Wallet, Workflow,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Navbar } from '@/components/landing/Navbar'
import { HeroChat } from '@/components/landing/HeroChat'
import { DemoModal } from '@/components/landing/DemoModal'

const fade = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
}

export function Landing() {
  const [demoOpen, setDemoOpen] = useState(false)

  return (
    <div id="top" className="min-h-screen bg-slate-50 text-slate-900">
      <Navbar onDemo={() => setDemoOpen(true)} />
      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(79,70,229,0.12),_transparent_50%),radial-gradient(ellipse_at_bottom_left,_rgba(245,158,11,0.10),_transparent_45%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 md:grid-cols-2 md:py-24">
          <motion.div initial="hidden" animate="show" variants={fade}>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              <Sparkles className="h-3.5 w-3.5" /> AI operations copilot
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-950 md:text-5xl">
              Replace manual admin work with a single AI command.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-slate-600">
              Nexora turns everyday language into governed workflow actions across finance, HR, procurement, and supply chain — with permissions, audit trails, and instant confirmation.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link to="/signup">Start Free Trial <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button size="lg" variant="outline" onClick={() => setDemoOpen(true)}>Watch Demo</Button>
            </div>
            <p className="mt-4 text-xs text-slate-500">No credit card. Seed workspace ready in under a minute.</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6 }}>
            <HeroChat />
          </motion.div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-6 text-sm font-medium text-slate-500">
          {['Helios Retail', 'Harbor Labs', 'Kite Logistics', 'Vellum Health', 'Northline Energy', 'Aster Group'].map((n) => (
            <span key={n} className="tracking-wide">{n}</span>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-4 py-20">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fade} className="mb-10">
          <h2 className="text-3xl font-bold">How it works</h2>
          <p className="mt-2 text-slate-600">Three steps from a sentence to a recorded, auditable action.</p>
        </motion.div>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { n: '01', title: 'Type a request in plain language', body: 'Ask the way you would Slack a colleague: approve an expense, book leave, or raise a purchase order.', icon: Sparkles },
            { n: '02', title: 'AI reads intent, context, and permissions', body: 'Nexora maps department, entity, fields, and whether your role can execute — never guessing past policy.', icon: ShieldCheck },
            { n: '03', title: 'Record created, workflow triggered', body: 'A workflow action is logged, downstream systems are notified, and you get instant confirmation in chat.', icon: Workflow },
          ].map((s) => (
            <motion.div key={s.n} initial="hidden" whileInView="show" viewport={{ once: true }} variants={fade} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <s.icon className="h-6 w-6 text-indigo-600" />
              <p className="mt-4 text-xs font-bold tracking-widest text-amber-600">{s.n}</p>
              <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="product" className="bg-indigo-950 py-20 text-white">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-3xl font-bold">Built for operators, not tickets</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {[
              { title: 'Reduce admin load', body: 'Collapse forms, email chains, and spreadsheet updates into one command bar your whole company can use.', icon: Layers },
              { title: 'Connect departments', body: 'Finance, HR, and procurement share one action log so handoffs stop disappearing between systems.', icon: Handshake },
              { title: 'Automate processes', body: 'Confirmed actions fan out to n8n and the rest of your stack without custom glue for every request.', icon: Workflow },
              { title: 'Real-time data for decisions', body: 'Every command becomes a structured record you can filter, audit, and report on the same day.', icon: ClipboardCheck },
            ].map((c) => (
              <div key={c.title} className="rounded-xl border border-white/10 bg-white/5 p-6">
                <c.icon className="h-6 w-6 text-amber-400" />
                <h3 className="mt-3 text-lg font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm text-indigo-100/80">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-3xl font-bold">Where teams use Nexora</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { title: 'Finance', desc: 'Invoice approvals, expense reports, and petty cash without waiting on a shared inbox.', icon: Wallet },
            { title: 'HR', desc: 'Onboarding checklists and leave requests that respect manager permissions automatically.', icon: Users },
            { title: 'Procurement', desc: 'Raise and approve purchase orders with amounts extracted from the original sentence.', icon: Coins },
            { title: 'Supply Chain', desc: 'Kick warehouse and shipment updates into motion and keep a company-wide trail.', icon: Truck },
            { title: 'Quality', desc: 'Log inspections and non-conformances as structured actions instead of buried notes.', icon: Factory },
            { title: 'Company ops', desc: 'One copilot across functions so policy, not tribal knowledge, decides what can run.', icon: Building2 },
          ].map((u) => (
            <div key={u.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <u.icon className="h-5 w-5 text-indigo-600" />
              <h3 className="mt-3 font-semibold">{u.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{u.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-3xl font-bold">Operators who stopped chasing forms</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { quote: 'Our controllers used to spend mornings in three tools. Now they type the approval once and the audit row already exists.', name: 'Elena Voss', role: 'VP Finance, Harbor Labs' },
              { quote: 'Leave requests used to stall in email. Nexora checks role, logs the action, and HR sees the same status we do.', name: 'Marcus Adeyemi', role: 'People Ops, Kite Logistics' },
              { quote: 'Procurement finally has a trail that matches what buyers actually said — not what they remembered to enter later.', name: 'Sofia Rahman', role: 'Head of Ops, Aster Group' },
            ].map((t) => (
              <blockquote key={t.name} className="rounded-xl border border-slate-200 bg-slate-50 p-6">
                <p className="text-sm leading-relaxed text-slate-700">“{t.quote}”</p>
                <footer className="mt-4 text-sm font-semibold text-slate-900">{t.name}</footer>
                <p className="text-xs text-slate-500">{t.role}</p>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-3xl font-bold">Simple plans for growing ops teams</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            { name: 'Pilot', price: '$0', items: ['1 workspace', 'Command Center', 'Activity log', 'Email support'] },
            { name: 'Company', price: '$49', items: ['Unlimited operators', 'Department tables', 'Role-based approvals', 'n8n webhook'] },
            { name: 'Enterprise', price: 'Talk to us', items: ['SSO & SCIM', 'Custom departments', 'Dedicated success', 'SLA'] },
          ].map((p, i) => (
            <div key={p.name} className={`rounded-xl border p-6 shadow-sm ${i === 1 ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
              <h3 className="font-semibold">{p.name}</h3>
              <p className="mt-2 text-3xl font-extrabold">{p.price}<span className="text-sm font-medium text-slate-500">{p.price.startsWith('$') ? '/seat' : ''}</span></p>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {p.items.map((it) => (
                  <li key={it} className="flex items-center gap-2"><Check className="h-4 w-4 text-indigo-600" />{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section id="about" className="bg-slate-900 py-20 text-center text-white">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-3xl font-bold">Ready to retire the admin pile?</h2>
          <p className="mt-3 text-slate-300">Start a free workspace, or book a walkthrough with your finance and HR owners in the same room.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" variant="amber" asChild>
              <Link to="/signup">Start Free Trial</Link>
            </Button>
            <Button size="lg" variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={() => setDemoOpen(true)}>
              Book a Demo
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 bg-slate-950 py-10 text-sm text-slate-400">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 md:flex-row md:justify-between">
          <div>
            <p className="font-bold text-white">Nexora</p>
            <p className="mt-1 max-w-xs">AI-powered enterprise operations copilot. Original product, original copy.</p>
          </div>
          <div className="flex gap-10">
            <div className="space-y-2">
              <p className="font-semibold text-slate-200">Product</p>
              <a href="#how">How it Works</a>
              <a href="#pricing" className="block">Pricing</a>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-slate-200">Company</p>
              <a href="#about" className="block">About</a>
              <Link to="/login" className="block">Sign in</Link>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-6xl px-4 text-xs">© {new Date().getFullYear()} Nexora Labs. All rights reserved.</p>
      </footer>
    </div>
  )
}
