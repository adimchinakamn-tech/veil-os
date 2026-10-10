import { db } from "@/lib/db"
async function main() {
  const accounts = await db.chatAccount.findMany({ select: { id: true, username: true, legacy: true, coins: true } })
  console.log("Accounts:", accounts.length)
  console.log(JSON.stringify(accounts.slice(0, 40), null, 1))
  const msgs = await db.chatMessage.count()
  console.log("Messages:", msgs)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
