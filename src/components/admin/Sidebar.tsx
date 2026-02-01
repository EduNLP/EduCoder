'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FileText, Users, Settings, LogOut, FileCheck, ScrollText, Video, Sparkles, LayoutGrid } from 'lucide-react'
import { useClerk } from '@clerk/nextjs'

const menuItems = [
  {
    name: 'Workspace',
    href: '/workspace',
    icon: LayoutGrid,
  },
  {
    name: 'Transcripts',
    href: '/admin/transcripts',
    icon: FileText,
  },
  {
    name: 'Annotators',
    href: '/admin/annotators',
    icon: Users,
  },
  {
    name: 'Annotations',
    href: '/admin/annotations',
    icon: FileCheck,
  },
  {
    name: 'LLM Annotations',
    href: '/admin/llm-annotations',
    icon: Sparkles,
  },
  {
    name: 'Videos',
    href: '/admin/videos',
    icon: Video,
  },
  {
    name: 'Logs',
    href: '/admin/logs',
    icon: ScrollText,
    isTemporarilyHidden: true,
  },
  {
    name: 'Settings',
    href: '/admin/settings',
    icon: Settings,
    isTemporarilyHidden: true,
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { signOut } = useClerk()

  const handleLogout = async () => {
    try {
      await signOut({ redirectUrl: '/' })
    } catch (error) {
      console.error('Admin sign out failed, redirecting to login anyway.', error)
      router.push('/')
    }
  }

  return (
    <div className="fixed left-0 top-0 h-screen w-64 bg-gray-900 text-white shadow-lg">
      {/* Logo/Header */}
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <p className="text-sm text-gray-400 mt-1">Transcript Management</p>
      </div>

      {/* Navigation */}
      <nav className="p-4 space-y-2">
        {menuItems
          .filter((item) => !item.isTemporarilyHidden)
          .map((item) => {
          const isActive = pathname?.startsWith(item.href)
          const Icon = item.icon
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-primary-600 text-white shadow-lg'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.name}</span>
            </Link>
          )
        })}
      </nav>

      {/* Logout Button */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-800">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-gray-300 hover:bg-red-600 hover:text-white transition-all duration-200"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </div>
  )
}
