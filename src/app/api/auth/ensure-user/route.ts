import { NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

const DEFAULT_ROLE = 'admin' as const

const buildDisplayName = (input: {
  firstName?: string | null
  lastName?: string | null
  username?: string | null
  email?: string | null
}) => {
  const name = [input.firstName, input.lastName].filter(Boolean).join(' ').trim()
  if (name) return name
  if (input.username) return input.username
  if (input.email) return input.email
  return 'New User'
}

const buildUsername = (input: {
  username?: string | null
  email?: string | null
  fallbackId: string
}) => {
  if (input.username) return input.username
  if (input.email) return input.email
  return `user-${input.fallbackId.slice(0, 8)}`
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const existingUser = await prisma.user.findFirst({
      where: { auth_user_id: userId },
      select: { id: true, role: true, workspace_id: true },
    })

    if (existingUser) {
      return NextResponse.json({
        created: false,
        role: existingUser.role,
        userId: existingUser.id,
        workspaceId: existingUser.workspace_id,
      })
    }

    if (!process.env.CLERK_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Clerk secret key is not configured on the server.' },
        { status: 500 },
      )
    }

    const body = await request.json().catch(() => null)
    const requestedName = typeof body?.name === 'string' ? body.name.trim() : ''

    const client = await clerkClient()
    const clerkUser = await client.users.getUser(userId)
    const primaryEmail =
      clerkUser.emailAddresses?.find(
        (address) => address.id === clerkUser.primaryEmailAddressId,
      )?.emailAddress ?? clerkUser.emailAddresses?.[0]?.emailAddress

    const fallbackDisplayName = buildDisplayName({
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      username: clerkUser.username,
      email: primaryEmail,
    })

    if (!requestedName) {
      return NextResponse.json({
        created: false,
        needsProfile: true,
        suggestedName: fallbackDisplayName,
        email: primaryEmail ?? null,
      })
    }

    const displayName = requestedName
    const username = buildUsername({
      username: clerkUser.username,
      email: primaryEmail,
      fallbackId: userId,
    })
    const password = crypto.randomBytes(24).toString('hex')

    const { user, workspace } = await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { name: `${displayName} Workspace` },
      })

      const user = await tx.user.create({
        data: {
          name: displayName,
          username,
          password,
          role: DEFAULT_ROLE,
          auth_user_id: userId,
          workspace_id: workspace.id,
        },
      })

      return { user, workspace }
    })

    await client.users.updateUser(userId, {
      publicMetadata: {
        ...(clerkUser.publicMetadata ?? {}),
        role: DEFAULT_ROLE,
      },
    })

    return NextResponse.json({
      created: true,
      role: DEFAULT_ROLE,
      userId: user.id,
      workspaceId: workspace.id,
    })
  } catch (error) {
    console.error('Failed to initialize auth user', error)
    return NextResponse.json(
      { error: 'Unable to complete sign-in right now. Please try again.' },
      { status: 500 },
    )
  }
}
