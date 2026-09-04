import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function Navbar({ onDemo }: { onDemo: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={cn('sticky top-0 z-50 transition-all', scrolled ? 'glass border-b border-slate-200/70 shadow-sm' : 'bg-transparent')}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <a href="#top" className="flex items-center gap-2 font-bold text-slate-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-amber-400">N</span>
          Nexora
        </a>
        <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
          <a href="#product" className="hover:text-indigo-700">Product</a>
          <a href="#how" className="hover:text-indigo-700">How it Works</a>
          <a href="#pricing" className="hover:text-indigo-700">Pricing</a>
          <a href="#about" className="hover:text-indigo-700">About</a>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="hidden sm:inline-flex" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
          <Button onClick={onDemo}>Book a Demo</Button>
        </div>
      </div>
    </header>
  )
}
