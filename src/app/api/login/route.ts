import { NextResponse } from 'next/server'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password.trim() : ''

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required.' },
        { status: 400 },
      )
    }

    const user = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid username or password.' },
        { status: 401 },
      )
    }

    const passwordMatches =
      (await compare(password, user.password).catch(() => false)) ||
      user.password === password

    if (!passwordMatches) {
      return NextResponse.json(
        { error: 'Invalid username or password.' },
        { status: 401 },
      )
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    })

    const redirectPath = user.role === 'admin' ? '/admin' : '/workspace'

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
      },
      redirectPath,
    })
  } catch (error) {
    console.error('Failed to process login', error)
    return NextResponse.json(
      { error: 'Unable to sign in right now. Please try again.' },
      { status: 500 },
    )
  }
}
