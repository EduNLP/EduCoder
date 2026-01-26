import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import LoginView from './login/LoginView'

export default async function RootPage() {
  const user = await currentUser()

  if (user) {
    redirect('/workspace')
  }

  return <LoginView />
}
