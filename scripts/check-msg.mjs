import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const rows = await p.chatMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 3, select: { content: true, createdAt: true, accountId: true } })
const acc = await p.chatAccount.findUnique({ where: { username: 'e2efresh2' } })
console.log(JSON.stringify({ latest: rows, account: acc ? { username: acc.username, coins: acc.coins } : null }))
await p.$disconnect()
