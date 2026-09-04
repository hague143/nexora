import { cn, statusLabel, statusTone } from '@/lib/utils'

export function Badge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', statusTone(status), className)}>
      {statusLabel(status)}
    </span>
  )
}
