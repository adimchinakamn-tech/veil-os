/**
 * Veil Chat — blackjack helpers.
 *
 * Written for Task 46 from the route usage in the Sulfur Chat source
 * (the original zip's @/lib/blackjack was not included).
 */

export type Card = {
  suit: "hearts" | "diamonds" | "clubs" | "spades"
  rank: "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K"
}

const SUITS: Card["suit"][] = ["hearts", "diamonds", "clubs", "spades"]
const RANKS: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function handValue(hand: Card[]): { total: number; soft: boolean } {
  let total = 0
  let aces = 0
  for (const c of hand) {
    if (c.rank === "A") {
      aces++
      total += 11
    } else if (c.rank === "K" || c.rank === "Q" || c.rank === "J" || c.rank === "10") {
      total += 10
    } else {
      total += Number(c.rank)
    }
  }
  // Downgrade aces from 11 to 1 while busting.
  let soft = aces > 0
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  if (aces === 0) soft = false
  return { total, soft }
}

export function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && handValue(hand).total === 21
}

export function isBust(hand: Card[]): boolean {
  return handValue(hand).total > 21
}

export function stringifyCards(cards: Card[]): string {
  return JSON.stringify(cards)
}

export function parseCards(json: string): Card[] {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed as Card[]
  } catch {
    return []
  }
}
