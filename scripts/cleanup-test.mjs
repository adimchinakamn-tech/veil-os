import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const names = ['e2echeck', 'e2efresh2', 'mirrorqa']
const accs = await p.chatAccount.findMany({ where: { username: { in: names } } })
const ids = accs.map(a => a.id)
const delMsgs = await p.chatMessage.deleteMany({ where: { accountId: { in: ids } } })
const delCoins = await p.coinTransaction.deleteMany({ where: { OR: [{ fromId: { in: ids } }, { toId: { in: ids } }] } })
const delAccs = await p.chatAccount.deleteMany({ where: { id: { in: ids } } })
console.log(JSON.stringify({ accounts: delAccs.count, messages: delMsgs.count, coinTx: delCoins.count }))
await p.$disconnect()
