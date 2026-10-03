/**
 * Seed the Veil Chat operator account.
 *
 * The chat UI grants super-admin (OWNER) powers purely by username match
 * (SUPER_ADMIN_USERNAME = "Veil" in chat-app.tsx; same constant server-side
 * in chat-mod/chat-cleanup). This script makes sure that account EXISTS so
 * the user can actually log in as it.
 *
 * Idempotent — upserts by username. Run: bun scripts/seed-veil-operator.ts
 */
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const db = new PrismaClient()

const USERNAME = "Veil"
const PASSWORD = process.env.VEIL_OPERATOR_PW || "T@@OTgs45+HAPP"

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const account = await db.chatAccount.upsert({
    where: { username: USERNAME },
    update: {}, // never clobber an existing operator account
    create: {
      username: USERNAME,
      passwordHash,
      displayName: "Veil",
      avatarColor: "#fb923c", // orange — matches the dock button
      bio: "Veil operator.",
      role: "admin",
      coins: 10000,
    },
  })
  console.log(
    `operator ready: ${account.username} (id=${account.id}, role=${account.role}, coins=${account.coins}) — password: ${PASSWORD}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
