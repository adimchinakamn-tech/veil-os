"use client";

/**
 * Veil Chat — the full-screen chat section.
 *
 * A thin shell: everything interesting (auth screen, blurred-wallpaper
 * backdrop, header, back button) lives in chat-app.tsx. This wrapper
 * exists so the start page can mount the chat like every other section
 * overlay and keep it alive (socket connected) once opened.
 *
 * The parent (page.tsx) renders this inside a fixed inset-0 layer with
 * NO extra dim/blur — the chat paints its own frosted-wallpaper look.
 */

import { ChatApp } from "@/components/veil/chat-app";

export function ChatSection({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full w-full overflow-hidden">
      <ChatApp onBack={onBack} />
    </div>
  );
}
