/** Envío simple al chat de Telegram (mismo bot que el webhook). */
export async function sendTelegramText(
  chatId: number,
  text: string
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4090),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("[telegram-notify] sendMessage failed:", res.status, body);
  }
}
