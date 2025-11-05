import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const EXCHANGE_RATE = parseFloat(process.env.EXCHANGE_RATE_MVR_TO_USDT || '0.065');
const ADMIN_WALLET = process.env.ADMIN_WALLET_ADDRESS;

// Create HTTP server for Vercel
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Dhicoins Telegram Bot is running');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌐 HTTP server running on port ${PORT}`);
});

// Store user sessions
const userSessions = new Map();
const pendingOrders = new Map();

// Helper function to parse amount input
function parseAmountInput(input) {
  const text = input.toLowerCase().trim();

  // Handle text-based amounts
  const textNumbers = {
    'half': 0.5,
    'quarter': 0.25,
    'one': 1,
    'two': 2,
    'three': 3,
    'four': 4,
    'five': 5,
    'six': 6,
    'seven': 7,
    'eight': 8,
    'nine': 9,
    'ten': 10
  };

  // Check for "X and a half" or "X and half"
  const andHalfMatch = text.match(/(one|two|three|four|five|six|seven|eight|nine|ten)\s+and\s+a?\s*half/);
  if (andHalfMatch) {
    const baseNum = textNumbers[andHalfMatch[1]];
    const currency = text.includes('mvr') ? 'MVR' : 'USDT';
    return { amount: baseNum + 0.5, currency };
  }

  // Check for text numbers
  for (const [word, value] of Object.entries(textNumbers)) {
    if (text.includes(word)) {
      const currency = text.includes('mvr') ? 'MVR' : 'USDT';
      return { amount: value, currency };
    }
  }

  // Extract numeric value (supports decimals)
  const numMatch = text.match(/(\d+\.?\d*)/);
  if (!numMatch) return null;

  const amount = parseFloat(numMatch[1]);
  if (isNaN(amount) || amount <= 0) return null;

  // Determine currency
  const currency = text.includes('mvr') ? 'MVR' : 'USDT';

  return { amount, currency };
}

// Helper to convert between currencies
function convertAmount(amount, fromCurrency) {
  if (fromCurrency === 'MVR') {
    return {
      usdt: (amount * EXCHANGE_RATE).toFixed(2),
      mvr: amount.toFixed(2)
    };
  } else {
    return {
      usdt: amount.toFixed(2),
      mvr: (amount / EXCHANGE_RATE).toFixed(2)
    };
  }
}

// Main keyboard
const mainKeyboard = {
  keyboard: [
    [{ text: 'Buy USDT' }],
    [{ text: 'Sell USDT' }]
  ],
  resize_keyboard: true,
  persistent: true
};

// Admin approval keyboard
function getAdminKeyboard(orderId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve_${orderId}` },
        { text: '❌ Reject', callback_data: `reject_${orderId}` }
      ]
    ]
  };
}

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSessions.delete(chatId);

  bot.sendMessage(chatId,
    '🌟 Welcome to Dhicoins USDT Bot\n\nChoose an option below:',
    { reply_markup: mainKeyboard }
  );
});

// Handle main menu buttons
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '/start') return;

  // Check if user is in a session
  const session = userSessions.get(chatId);

  if (text === 'Buy USDT') {
    userSessions.set(chatId, { action: 'buy', step: 'amount' });
    bot.sendMessage(chatId,
      '💵 Enter the amount you\'d like to buy in USDT or MVR.\n\n' +
      'Examples:\n' +
      '• 100 USDT\n' +
      '• 1500 MVR\n' +
      '• 0.5 USDT\n' +
      '• half USDT\n' +
      '• one and a half MVR\n\n' +
      'The equivalent will be displayed automatically.'
    );
    return;
  }

  if (text === 'Sell USDT') {
    bot.sendMessage(chatId, '🔄 Sell USDT feature coming soon!', { reply_markup: mainKeyboard });
    return;
  }

  // Handle buy flow
  if (session && session.action === 'buy') {
    if (session.step === 'amount') {
      const parsed = parseAmountInput(text);

      if (!parsed) {
        bot.sendMessage(chatId,
          '❌ Invalid amount format.\n\n' +
          'Please enter a valid amount like:\n' +
          '• 100 USDT\n' +
          '• 1500 MVR\n' +
          '• 0.5 USDT'
        );
        return;
      }

      const converted = convertAmount(parsed.amount, parsed.currency);

      session.converted = converted;
      session.step = 'wallet';
      userSessions.set(chatId, session);

      bot.sendMessage(chatId,
        `💰 Amount Summary:\n\n` +
        `USDT: ${converted.usdt}\n` +
        `MVR: ${converted.mvr}\n\n` +
        `📋 Please enter your TRC20 USDT wallet address to receive the funds.`
      );
      return;
    }

    if (session.step === 'wallet') {
      const walletAddress = text.trim();

      // Basic TRC20 validation (starts with T and 34 characters)
      if (!walletAddress.startsWith('T') || walletAddress.length !== 34) {
        bot.sendMessage(chatId,
          '❌ Invalid TRC20 wallet address.\n\n' +
          'Please enter a valid TRC20 address (starts with T and 34 characters long).'
        );
        return;
      }

      session.walletAddress = walletAddress;
      session.step = 'bank';
      userSessions.set(chatId, session);

      bot.sendMessage(chatId,
        '🏦 Please enter your bank name for MVR transfer verification.'
      );
      return;
    }

    if (session.step === 'bank') {
      const bankName = text.trim();

      if (bankName.length < 2) {
        bot.sendMessage(chatId, '❌ Please enter a valid bank name.');
        return;
      }

      session.bankName = bankName;
      session.step = 'receipt';
      userSessions.set(chatId, session);

      bot.sendMessage(chatId,
        `💳 Bank Details for Payment:\n\n` +
        `Account Name: Dhicoins\n` +
        `Bank: BML\n` +
        `Account Number: 7730000123456\n\n` +
        `Amount to transfer: ${session.converted.mvr} MVR\n\n` +
        `📸 After making the payment, please upload your payment receipt/screenshot.`
      );
      return;
    }
  }
});

// Handle photo uploads (receipts)
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions.get(chatId);

  if (session && session.action === 'buy' && session.step === 'receipt') {
    const photo = msg.photo[msg.photo.length - 1]; // Get highest resolution
    const orderId = `ORDER_${Date.now()}_${chatId}`;

    // Store pending order
    pendingOrders.set(orderId, {
      userId: chatId,
      userName: msg.from.first_name || 'User',
      userUsername: msg.from.username || 'N/A',
      usdt: session.converted.usdt,
      mvr: session.converted.mvr,
      walletAddress: session.walletAddress,
      bankName: session.bankName,
      photoId: photo.file_id,
      timestamp: new Date().toISOString()
    });

    // Send to admin for approval
    try {
      await bot.sendPhoto(ADMIN_CHAT_ID, photo.file_id, {
        caption:
          `🔔 NEW BUY ORDER\n\n` +
          `Order ID: ${orderId}\n` +
          `User: ${msg.from.first_name} (@${msg.from.username || 'N/A'})\n` +
          `User ID: ${chatId}\n\n` +
          `💵 Amount:\n` +
          `USDT: ${session.converted.usdt}\n` +
          `MVR: ${session.converted.mvr}\n\n` +
          `📋 Wallet: ${session.walletAddress}\n` +
          `🏦 Bank: ${session.bankName}\n\n` +
          `⏰ ${new Date().toLocaleString()}`,
        reply_markup: getAdminKeyboard(orderId)
      });

      bot.sendMessage(chatId,
        `✅ Order submitted successfully!\n\n` +
        `Order ID: ${orderId}\n\n` +
        `Your order is being reviewed by our admin. ` +
        `You will receive a notification once it's processed.\n\n` +
        `Thank you for using Dhicoins! 🚀`,
        { reply_markup: mainKeyboard }
      );

      userSessions.delete(chatId);
    } catch (error) {
      console.error('Error sending to admin:', error);
      bot.sendMessage(chatId,
        '❌ An error occurred while submitting your order. Please try again or contact support.',
        { reply_markup: mainKeyboard }
      );
    }
  }
});

// Handle admin callbacks
bot.on('callback_query', async (query) => {
  const adminChatId = query.message.chat.id;

  // Only allow admin to approve/reject
  if (adminChatId.toString() !== ADMIN_CHAT_ID) {
    bot.answerCallbackQuery(query.id, { text: '⛔ Unauthorized' });
    return;
  }

  const [action, orderId] = query.data.split('_');
  const order = pendingOrders.get(`ORDER_${orderId}`);

  if (!order) {
    bot.answerCallbackQuery(query.id, { text: '❌ Order not found or already processed' });
    return;
  }

  if (action === 'approve') {
    // Send approval to user with USDT sending instructions
    try {
      await bot.sendMessage(order.userId,
        `✅ YOUR ORDER HAS BEEN APPROVED!\n\n` +
        `Order ID: ORDER_${orderId}\n` +
        `Amount: ${order.usdt} USDT\n\n` +
        `💸 USDT Transfer Details:\n` +
        `You will receive ${order.usdt} USDT to:\n` +
        `${order.walletAddress}\n\n` +
        `⚡ Admin is processing your transfer now.\n` +
        `Please check your wallet in a few minutes.\n\n` +
        `📝 Instructions for Admin:\n` +
        `Send ${order.usdt} USDT from admin wallet:\n` +
        `${ADMIN_WALLET}\n` +
        `To user wallet:\n` +
        `${order.walletAddress}\n\n` +
        `Thank you for choosing Dhicoins! 🌟`
      );

      // Update admin message
      await bot.editMessageCaption(
        query.message.caption + '\n\n✅ APPROVED',
        {
          chat_id: adminChatId,
          message_id: query.message.message_id,
          reply_markup: { inline_keyboard: [] }
        }
      );

      bot.answerCallbackQuery(query.id, {
        text: `✅ Order approved! Please send ${order.usdt} USDT to ${order.walletAddress}`
      });

      pendingOrders.delete(`ORDER_${orderId}`);
    } catch (error) {
      console.error('Error approving order:', error);
      bot.answerCallbackQuery(query.id, { text: '❌ Error processing approval' });
    }
  } else if (action === 'reject') {
    // Send rejection to user
    try {
      await bot.sendMessage(order.userId,
        `❌ ORDER REJECTED\n\n` +
        `Order ID: ORDER_${orderId}\n` +
        `Amount: ${order.usdt} USDT\n\n` +
        `Your order has been rejected. This may be due to:\n` +
        `• Invalid payment receipt\n` +
        `• Incorrect amount transferred\n` +
        `• Other verification issues\n\n` +
        `Please contact support for more information or try again.`,
        { reply_markup: mainKeyboard }
      );

      // Update admin message
      await bot.editMessageCaption(
        query.message.caption + '\n\n❌ REJECTED',
        {
          chat_id: adminChatId,
          message_id: query.message.message_id,
          reply_markup: { inline_keyboard: [] }
        }
      );

      bot.answerCallbackQuery(query.id, { text: '❌ Order rejected' });

      pendingOrders.delete(`ORDER_${orderId}`);
    } catch (error) {
      console.error('Error rejecting order:', error);
      bot.answerCallbackQuery(query.id, { text: '❌ Error processing rejection' });
    }
  }
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('🤖 Dhicoins Telegram Bot is running...');
