import 'dotenv/config';
import fs from 'node:fs';
import OpenAI from 'openai';
import { Telegraf, Markup } from 'telegraf';

const { TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, OPENAI_MODEL = 'gpt-5.5', OWNER_TELEGRAM_ID } = process.env;
if (!TELEGRAM_BOT_TOKEN) throw new Error('Не задан TELEGRAM_BOT_TOKEN в .env');
if (!OPENAI_API_KEY) throw new Error('Не задан OPENAI_API_KEY в .env');

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const ai = new OpenAI({ apiKey: OPENAI_API_KEY });
const STORE = new URL('./data.json', import.meta.url);
const MODES = {
  general: 'Универсальный помощник: помогай с повседневными вопросами, решениями и планированием.',
  study: 'Репетитор: объясняй простыми словами, помогай готовиться к контрольным, решай задания пошагово и проверяй понимание.',
  sport: 'Спортивный помощник: футбол, тренировки, физическая подготовка, спортивный менеджмент и анализ. Не выдумывай статистику.',
  business: 'Бизнес-аналитик: помогай с бизнес-идеями, моделями, рынком, бюджетами и расчётами. Показывай допущения.',
  plan: 'Персональный организатор: превращай цели в конкретные задачи, планы и приоритеты.'
};
const MODE_NAMES = { general: 'Универсальный', study: 'Учёба', sport: 'Спорт', business: 'Бизнес', plan: 'Планирование' };
const SYSTEM = `Ты — AKIM AI, персональный ИИ-ассистент. Общайся на русском, дружелюбно и по делу. Объясняй сложное простыми словами, структурируй ответы. Учитывай, что пользователь учится на направлении менеджмента спортивных индустрий, интересуется футболом и спортом. Не выдумывай факты, источники, статистику или выполненные действия. Если не хватает данных — задай один конкретный вопрос. Не проси присылать пароли, API-ключи или другие секреты. Ты не можешь самостоятельно отправлять сообщения, бронировать, оплачивать или создавать события без подключённого сервиса и явного подтверждения.`;

function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; }
}
const store = loadStore();
function saveStore() { fs.writeFileSync(STORE, JSON.stringify(store, null, 2)); }
function userState(id) {
  store[id] ??= { mode: 'general', history: [] };
  return store[id];
}
function allowed(ctx) {
  return !OWNER_TELEGRAM_ID || String(ctx.from?.id) === String(OWNER_TELEGRAM_ID);
}
async function guard(ctx, next) {
  if (!allowed(ctx)) {
    await ctx.reply('Этот AKIM AI настроен как личный помощник и доступ закрыт.');
    return;
  }
  return next();
}
bot.use(guard);

const menu = Markup.inlineKeyboard([
  [Markup.button.callback('🎓 Учёба', 'mode:study'), Markup.button.callback('⚽ Спорт', 'mode:sport')],
  [Markup.button.callback('💼 Бизнес', 'mode:business'), Markup.button.callback('📅 Планирование', 'mode:plan')],
  [Markup.button.callback('🤖 Универсальный', 'mode:general'), Markup.button.callback('🧹 Очистить память', 'clear')]
]);

bot.start(async (ctx) => {
  const s = userState(ctx.from.id);
  await ctx.reply(`Привет! Я AKIM AI — твой персональный ИИ-помощник.\n\nСейчас режим: ${MODE_NAMES[s.mode]}.\nНапиши вопрос или выбери направление ниже.`, menu);
});
bot.help(async (ctx) => ctx.reply('Команды:\n/start — главное меню\n/mode — выбрать режим\n/study — режим учёбы\n/sport — режим спорта\n/business — режим бизнеса\n/plan — режим планирования\n/reset — очистить историю диалога\n\nПросто отправь мне сообщение — отвечу как ИИ-помощник.'));
bot.command('mode', async (ctx) => ctx.reply('Выбери режим:', menu));
for (const [key, command] of Object.entries({ study: 'study', sport: 'sport', business: 'business', plan: 'plan' })) {
  bot.command(command, async (ctx) => {
    userState(ctx.from.id).mode = key; saveStore();
    await ctx.reply(`Включён режим: ${MODE_NAMES[key]}. Что будем делать?`);
  });
}
bot.command('reset', async (ctx) => {
  const s = userState(ctx.from.id); s.history = []; saveStore();
  await ctx.reply('История диалога очищена. Режим и настройки сохранены.');
});
bot.action(/^mode:(.+)$/, async (ctx) => {
  const mode = ctx.match[1];
  if (!MODES[mode]) return ctx.answerCbQuery('Неизвестный режим');
  userState(ctx.from.id).mode = mode; saveStore();
  await ctx.answerCbQuery(`Режим: ${MODE_NAMES[mode]}`);
  await ctx.reply(`Переключил на режим «${MODE_NAMES[mode]}».`);
});
bot.action('clear', async (ctx) => {
  userState(ctx.from.id).history = []; saveStore();
  await ctx.answerCbQuery('История очищена');
  await ctx.reply('История диалога очищена.');
});

function splitText(text, max = 3900) {
  const chunks = [];
  while (text.length > max) {
    let cut = text.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    chunks.push(text.slice(0, cut)); text = text.slice(cut).trimStart();
  }
  if (text) chunks.push(text);
  return chunks;
}

bot.on('text', async (ctx) => {
  const prompt = ctx.message.text?.trim();
  if (!prompt || prompt.startsWith('/')) return;
  const s = userState(ctx.from.id);
  const wait = await ctx.reply('⏳ Думаю…');
  try {
    const input = [...s.history.slice(-16), { role: 'user', content: prompt }];
    const response = await ai.responses.create({
      model: OPENAI_MODEL,
      instructions: `${SYSTEM}\nТекущий режим: ${MODE_NAMES[s.mode]}. ${MODES[s.mode]}`,
      input
    });
    const answer = response.output_text?.trim() || 'Не получилось сформировать ответ. Попробуй ещё раз.';
    s.history = [...input, { role: 'assistant', content: answer }].slice(-18);
    saveStore();
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    for (const part of splitText(answer)) await ctx.reply(part);
  } catch (err) {
    console.error(err);
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    const message = err?.status === 401 ? 'Не принят OpenAI API-ключ. Проверь OPENAI_API_KEY.' : 'Не удалось получить ответ. Проверь API-ключ, баланс API и подключение к интернету.';
    await ctx.reply(message);
  }
});

bot.catch((err) => console.error('Telegram bot error:', err));
await bot.launch();
console.log('AKIM AI Telegram bot is running.');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
