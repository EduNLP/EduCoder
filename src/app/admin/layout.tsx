import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Sidebar from '@/components/admin/Sidebar'

export const metadata: Metadata = {
  title: 'Admin Dashboard',
  description: 'Transcript annotation management system',
}

export default function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="ml-64 flex-1 bg-gray-50">{children}</main>
    </div>
  )
}
