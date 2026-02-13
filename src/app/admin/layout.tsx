import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import Sidebar from '@/components/admin/Sidebar'
import { AdminVideoUploadProvider } from '@/context/AdminVideoUploadContext'

export const metadata: Metadata = {
  title: 'Admin Dashboard',
  description: 'Transcript annotation management system',
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const user = await currentUser()
  const role = (user?.publicMetadata?.role as string | undefined) ?? null

  if (!user) {
    redirect('/')
  }

  if (role !== 'admin') {
    redirect('/workspace')
  }

  return (
    <AdminVideoUploadProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="ml-64 flex-1 bg-gray-50">
          {children}
        </main>
      </div>
    </AdminVideoUploadProvider>
  )
}
