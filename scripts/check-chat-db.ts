import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const accounts = await db.chatAccount.findMany({ select: { id: true, username: true, role: true, createdAt: true } })
  console.log('accounts:', JSON.stringify(accounts))
  const msgs = await db.chatMessage.count()
  console.log('messages:', msgs)
}
main().then(() => process.exit(0)).catch((e) => { console.error('ERR:', e.message); process.exit(1) })
