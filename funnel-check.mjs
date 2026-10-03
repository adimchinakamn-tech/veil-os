import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const rows = await p.devRequest.findMany({ where: { status: 'pending' }, select: { id: true, title: true, body: true, createdAt: true } })
console.log(JSON.stringify(rows))
await p.$disconnect()
