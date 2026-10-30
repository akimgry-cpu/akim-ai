export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('AKIM AI is running.');
    }
    if (request.method === 'GET' && url.pathname === '/setup') {
      if (!env.SETUP_KEY || url.searchParams.get('key') !== env.SETUP_KEY) return new Response('Forbidden', { status: 403 });
      const webhookUrl = `${url.origin}/telegram`;
      const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl })
      });
      return new Response(await r.text(), { headers: { 'content-type': 'application/json' } });
    }
    if (request.method === 'POST' && url.pathname === '/telegram') {
      const update = await request.json();
      const msg = update.message;
      if (!msg?.chat?.id || !msg.text) return new Response('ok');
      const chatId = msg.chat.id;
      const text = msg.text.trim();
      let answer;
      if (text === '/start') {
        answer = 'Привет! Я AKIM AI 🤖\n\nЯ помогу с учёбой, спортом, бизнесом и повседневными задачами. Просто напиши свой вопрос.\n\nКоманды: /study — учёба, /sport — спорт, /business — бизнес.';
      } else {
        let prompt = text;
        if (text.startsWith('/study')) prompt = `Ты помощник по учёбе. Объясняй простым русским языком, по шагам. Запрос: ${text.replace('/study','').trim()}`;
        if (text.startsWith('/sport')) prompt = `Ты спортивный помощник по футболу, тренировкам и спортивному менеджменту. Не выдумывай факты. Запрос: ${text.replace('/sport','').trim()}`;
        if (text.startsWith('/business')) prompt = `Ты помощник по бизнесу и менеджменту. Отвечай структурно и практично. Запрос: ${text.replace('/business','').trim()}`;
        try {
          const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
              { role: 'system', content: 'Ты AKIM AI — персональный русскоязычный ИИ-помощник. Отвечай понятно, дружелюбно и по делу. Не утверждай, что выполняешь действия вне чата, если это не так.' },
              { role: 'user', content: prompt }
            ]
          });
          answer = result.response || 'Не получилось сформировать ответ. Попробуй ещё раз.';
        } catch (e) {
          answer = 'Не удалось обратиться к ИИ. Проверь, что подключена привязка Workers AI (AI) и бесплатный лимит не исчерпан.';
        }
      }
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: answer.slice(0, 4000) })
      });
      return new Response('ok');
    }
    return new Response('Not found', { status: 404 });
  }
};
