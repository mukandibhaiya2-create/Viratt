/**
 * Facebook Messenger Bot - Main Entry Point
 * This file initializes the bot and loads all required modules
 */

const fs = require('fs-extra');
const path = require('path');
const mongoose = require('mongoose');
const chalk = require('chalk');
const moment = require('moment-timezone');

// Set global variables
global.client = {};
global.config = {};
global.utils = {};
global.api = {};
global.startTime = new Date();

// Load global modules
require('./utils/global');

const logger = global.logger;
logger.system('Starting bot...');

// Log configuration loaded
try {
  console.log(chalk.green('[CONFIG]'), 'Loaded configuration successfully');
} catch (error) {
  console.error(chalk.red('[ERROR]'), 'Failed to load config.json:', error.message);
  process.exit(1);
}

// Create public directory if it doesn't exist
if (!fs.existsSync('./public')) {
  fs.mkdirSync('./public', { recursive: true });
  logger.system('Created public directory for web server');
}

// Connect to MongoDB
mongoose.set('strictQuery', false);
console.log('[CONSOLE] Attempting to connect to MongoDB with URI:', global.config.mongoURI);
mongoose.connect(global.config.mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('[CONSOLE] MongoDB connection successful');
  logger.database('Connected to MongoDB successfully');
  
  // Start HTTP server for preview
  const server = require('./utils/server');
  server.startServer();

  // â”€â”€ Dedup + Friendly Mode Gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // The FCA MQTT layer can emit the same message through multiple internal
  // paths simultaneously (enhanced listener + base listener). This guard
  // ensures handleCommand is only invoked ONCE per unique messageID, fixing
  // double-response bugs without touching any obfuscated code.
  const _origHandleCommand = global.handleCommand;
  const _seenMessages = new Map(); // messageID â†’ timestamp
  const _DEDUP_TTL = 4000;        // 4 s window â€” covers any MQTT re-delivery

  global.handleCommand = function dedupFriendlyGate(api, message, ...rest) {
    // â”€â”€ 1. Deduplication â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (message?.messageID) {
      const now = Date.now();
      if (_seenMessages.has(message.messageID)) {
        return; // already queued for processing â€” drop duplicate silently
      }
      _seenMessages.set(message.messageID, now);
      // Prune entries older than the TTL to avoid unbounded growth
      if (_seenMessages.size > 300) {
        for (const [id, ts] of _seenMessages) {
          if (now - ts > _DEDUP_TTL) _seenMessages.delete(id);
        }
      }
    }

    // â”€â”€ 2. Mode-aware message gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //
    // Three mutually-exclusive modes control which messages reach the handlers:
    //
    //  â€¢ Friendly Mode ON          â†’ pass ALL messages (bot is open to everyone)
    //  â€¢ Unfriendly Admin Mode ON  â†’ only admin/owner messages pass; others blocked
    //  â€¢ Default (both OFF)        â†’ only commands + bot-addressed messages pass
    //
    if (message?.type === 'message') {
      const _str      = v => String(v || '');
      const senderID  = _str(message.senderID);
      const botID     = _str(global.client?.botID || global.config?.botID);
      const ownerID   = _str(global.config?.ownerID);
      const adminIDs  = (global.config?.adminIDs || []).map(_str);
      const isPrivileged = senderID === ownerID || adminIDs.includes(senderID);

      // Never filter out our own messages or the owner
      if (senderID !== botID && senderID !== ownerID) {
        const fm  = global.config?.friendlyMode        || {};
        const uam = global.config?.unfriendlyAdminMode  || {};

        if (fm.enabled) {
          // â”€â”€ Friendly Mode: pass everything â€” no filtering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          // (fall through to handler)

        } else if (uam.enabled) {
          // â”€â”€ Unfriendly Admin Mode: block everyone except admin/owner â”€â”€â”€â”€â”€
          if (!isPrivileged) return; // silently drop

        } else {
          // â”€â”€ Default mode: only pass command-prefix messages and targeted â”€
          // The obfuscated handleCommand already routes prefix commands.
          // For the bot.js handleEvent path we let everything through here;
          // bot.js's own shouldTrigger() does the fine-grained filtering.
          // This gate only blocks messages that are clearly not commands AND
          // not directed at the bot (no mention, no reply-to-bot, no prefix).
          const prefix     = _str(global.config?.prefix || '/');
          const body       = _str(message.body);
          const hasPrefix  = body.startsWith(prefix);
          const mentions   = message.mentions || {};
          const isMentioned = botID && Object.keys(mentions).some(uid => _str(uid) === botID);
          const isReply     = botID && _str(message.messageReply?.senderID) === botID;
          const isGroupChat = _str(message.threadID) !== senderID;
          const hasBotWord  = /bot/i.test(body);

          if (isGroupChat && !hasPrefix && !isMentioned && !isReply && !hasBotWord) {
            return; // not a command and bot not addressed â€” drop silently
          }
        }
      }
    }

    // â”€â”€ 3. Delegate to original handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (typeof _origHandleCommand === 'function') {
      return _origHandleCommand.call(this, api, message, ...rest);
    }
  };
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Load main bot file after database connection
  require('./main.js');

  // Poll until the FCA API is reachable, then send a startup message to the owner.
  // The obfuscated main.js may store the api on global.client.api, global.api (module),
  // or call global.api.setApi() â€” we check all candidates.
  const apiUtil = require('./utils/api');
  let _startupSent = false;
  let _startupTicks = 0;
  const _startupInterval = setInterval(() => {
    if (_startupSent) return;
    _startupTicks++;
    if (_startupTicks > 60) { // give up after 60 seconds
      clearInterval(_startupInterval);
      logger.warn('âš ï¸ Could not locate FCA API after 60s â€” startup message not sent');
      return;
    }

    // Check all known locations where the obfuscated main.js stores the FCA api
    const candidates = [
      global.broadcastSystem && global.broadcastSystem.api,
      global.sessionManager && global.sessionManager.api,
      global.autoSend && global.autoSend.api,
      apiUtil.getApi(),
      global.client && global.client.api,
    ];
    const fbApi = candidates.find(c => c && typeof c.sendMessage === 'function');
    if (!fbApi) return;

    _startupSent = true;
    clearInterval(_startupInterval);
    logger.system(`ðŸ” FCA API located â€” sending startup message`);

    // Send startup message to the admin group thread
    const targetThread = global.config.adminInboxThreadID || global.config.ownerID;
    if (!targetThread) return;
    fbApi.sendMessage({ body: 'ðŸŸ¢ Bot is online' }, targetThread, (err) => {
      if (err) {
        logger.error(`âŒ Failed to send startup message to ${targetThread}: ${err.message || JSON.stringify(err)}`);
      } else {
        logger.system(`âœ… Startup message sent to thread (${targetThread})`);
      }
    });
  }, 1000);
})
.catch(err => {
  console.error('[CONSOLE] MongoDB connection error:', err.message);
  logger.error('MongoDB connection error:', err.message);
  process.exit(1);
});

// Add global error handlers for better logging
process.on('uncaughtException', (err) => {
  global.logger.error('âŒ Uncaught Exception:');
  global.logger.error(err);
  console.error('âŒ Uncaught Exception:');
  console.error(err);
  // Don't exit the process to keep the bot running
});

process.on('unhandledRejection', (reason, promise) => {
  const timestamp = new Date().toISOString();
  
  // Enhanced logging with highlighting
  if (global.logger && global.logger.error) {
    global.logger.error('ðŸš¨ UNHANDLED PROMISE REJECTION DETECTED ðŸš¨');
    global.logger.error('ðŸ“ Location:', promise);
    global.logger.error('ðŸ”¥ Reason:', reason);
    global.logger.error('â° Timestamp:', timestamp);
  }
  
  // Create highlighted error box in console
  console.error('\n' + 'ðŸš¨'.repeat(25));
  console.error('âŒ UNHANDLED PROMISE REJECTION DETECTED');
  console.error('ðŸ“ Promise:', promise);
  console.error('ðŸ”¥ Reason:', reason);
  console.error('â° Time:', timestamp);
  console.error('ðŸš¨'.repeat(25) + '\n');
  
  // Don't exit the process to keep the bot running
});

logger.system('Bot initialization complete');
