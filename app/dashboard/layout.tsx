import DashboardNav from '@/app/components/DashboardNav'

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <>
      <DashboardNav />
      {children}
    </>
  )
}
