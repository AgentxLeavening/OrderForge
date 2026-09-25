import DashboardNav from '@/app/components/DashboardNav'

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-screen bg-gray-950">
      <DashboardNav />
      {/* min-w-0 lets wide content (the kanban board) scroll inside its own
          area instead of stretching the page past the sidebar. */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
