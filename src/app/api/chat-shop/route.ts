import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getAccountFromToken, toPublicAccount } from "@/lib/chat-auth"

export const runtime = "nodejs"

type ShopItem =
  | {
      id: string
      type: "tag"
      label: string
      tagText: string
      tagColor: string
      price: number
    }
  | {
      id: string
      type: "accessory"
      label: string
      accessory: string
      price: number
    }

// 6 name tags + 8 PFP accessories, prices 1000–10000.
const SHOP_CATALOG: ShopItem[] = [
  {
    id: "tag-gold",
    type: "tag",
    label: "Gold Tag",
    tagText: "Gold Member",
    tagColor: "#d4a017",
    price: 1000,
  },
  {
    id: "tag-vip",
    type: "tag",
    label: "VIP Tag",
    tagText: "VIP",
    tagColor: "#9b59b6",
    price: 2500,
  },
  {
    id: "tag-pro",
    type: "tag",
    label: "Pro Tag",
    tagText: "Pro User",
    tagColor: "#16a085",
    price: 4000,
  },
  {
    id: "tag-elite",
    type: "tag",
    label: "Elite Tag",
    tagText: "Elite",
    tagColor: "#e67e22",
    price: 6000,
  },
  {
    id: "tag-legend",
    type: "tag",
    label: "Legend Tag",
    tagText: "Legend",
    tagColor: "#c0392b",
    price: 8000,
  },
  {
    id: "tag-mythic",
    type: "tag",
    label: "Mythic Tag",
    tagText: "Mythic",
    tagColor: "#8e44ad",
    price: 10000,
  },
  {
    id: "acc-crown",
    type: "accessory",
    label: "Crown",
    accessory: "crown",
    price: 1000,
  },
  {
    id: "acc-halo",
    type: "accessory",
    label: "Halo",
    accessory: "halo",
    price: 2000,
  },
  {
    id: "acc-horns",
    type: "accessory",
    label: "Devil Horns",
    accessory: "horns",
    price: 3000,
  },
  {
    id: "acc-glasses",
    type: "accessory",
    label: "Cool Shades",
    accessory: "glasses",
    price: 4000,
  },
  {
    id: "acc-headphones",
    type: "accessory",
    label: "Headphones",
    accessory: "headphones",
    price: 5000,
  },
  {
    id: "acc-partyhat",
    type: "accessory",
    label: "Party Hat",
    accessory: "partyhat",
    price: 6000,
  },
  {
    id: "acc-witchhat",
    type: "accessory",
    label: "Witch Hat",
    accessory: "witchhat",
    price: 8000,
  },
  {
    id: "acc-flower",
    type: "accessory",
    label: "Flower Crown",
    accessory: "flower",
    price: 10000,
  },
]

export async function GET() {
  return NextResponse.json({ ok: true, items: SHOP_CATALOG })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { token?: string; itemId?: string }
    const token = body.token
    const itemId = (body.itemId || "").trim()
    const account = await getAccountFromToken(token)
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token." },
        { status: 401 },
      )
    }

    const item = SHOP_CATALOG.find((i) => i.id === itemId)
    if (!item) {
      return NextResponse.json(
        { ok: false, error: "That item does not exist in the shop." },
        { status: 404 },
      )
    }

    // Atomic purchase: re-check balance inside the transaction.
    const result = await db.$transaction(async (tx) => {
      const fresh = await tx.chatAccount.findUnique({
        where: { id: account.id },
      })
      if (!fresh) throw new Error("Account not found.")
      if (fresh.coins < item.price) {
        throw new Error(
          `Insufficient balance. This item costs ${item.price} coins.`,
        )
      }

      const updateData: { tag?: string; tagColor?: string; pfpAccessory?: string } = {}
      if (item.type === "tag") {
        updateData.tag = item.tagText
        updateData.tagColor = item.tagColor
      } else {
        updateData.pfpAccessory = item.accessory
      }

      const updated = await tx.chatAccount.update({
        where: { id: account.id },
        data: {
          coins: { decrement: item.price },
          ...updateData,
        },
      })

      await tx.coinTransaction.create({
        data: {
          fromId: account.id,
          toId: account.id,
          amount: item.price,
          reason: `shop_purchase:${item.id}`,
        },
      })

      return updated
    }).catch((e: Error) => e)

    if (result instanceof Error) {
      return NextResponse.json(
        { ok: false, error: result.message },
        { status: 400 },
      )
    }

    return NextResponse.json({
      ok: true,
      account: toPublicAccount(result),
      item,
    })
  } catch (err) {
    console.error("[chat-shop POST] error", err)
    return NextResponse.json(
      { ok: false, error: "Server error processing shop purchase." },
      { status: 500 },
    )
  }
}
