/**
 * /friendly — Enable Friendly Mode
 *
 * Friendly Mode: bot participates openly in group chats.
 * • Responds to ALL messages from ALL users (not just commands).
 * • Responds to @mentions, tags, and replies-to-bot.
 * • Behaves like a normal group participant.
 *
 * Only ADMIN / OWNER can toggle this.
 */

const fs = require('fs');

module.exports = {
  config: {
    name: 'friendly',
    aliases: ['friendlymode', 'friendon'],
    description: 'Enable Friendly Mode — bot responds to everyone in the group',
    usage: '{prefix}friendly',
    credit: 'Virat Bot',
    hasPrefix: true,
    permission: 'ADMIN',
    cooldown: 3,
    category: 'ADMIN'
  },

  run: async function ({ api, message }) {
    const { threadID, messageID, senderID } = message;

    // ── Permission guard (double-check beyond framework) ──────────────────────
    const isOwner = String(senderID) === String(global.config?.ownerID);
    const isAdmin = Array.isArray(global.config?.adminIDs) &&
                    global.config.adminIDs.includes(String(senderID));
    if (!isOwner && !isAdmin) {
      return api.sendMessage(
        '🚫 Sirf admin ya owner hi Friendly Mode toggle kar sakta hai.',
        threadID, messageID
      );
    }

    // ── Check current mode state ──────────────────────────────────────────────
    const fm  = global.config.friendlyMode  || {};
    const uam = global.config.unfriendlyAdminMode || {};

    if (fm.enabled && !uam.enabled) {
      return api.sendMessage(
        '✅ Friendly Mode pehle se ON hai.\n\n' +
        '• Main group ke sabhi users ke saath baat kar raha hun.\n' +
        '• Band karne ke liye /unfriendly use karo.',
        threadID, messageID
      );
    }

    // ── Activate Friendly Mode, deactivate Unfriendly Admin Mode ─────────────
    if (!global.config.friendlyMode) global.config.friendlyMode = {};
    global.config.friendlyMode.enabled   = true;
    global.config.friendlyMode.enabledBy = senderID;
    global.config.friendlyMode.enabledAt = new Date().toISOString();

    // Ensure Unfriendly Admin Mode is off — they are mutually exclusive
    if (!global.config.unfriendlyAdminMode) global.config.unfriendlyAdminMode = {};
    global.config.unfriendlyAdminMode.enabled = false;

    // Persist
    try {
      fs.writeFileSync('./config.json', JSON.stringify(global.config, null, 2));
    } catch (err) {
      global.logger?.error('friendly: config save failed:', err.message);
    }

    global.logger?.system(`✅ Friendly Mode ON — enabled by ${senderID}`);

    return api.sendMessage(
      '🤝 Friendly Mode ON!\n\n' +
      '✅ Kya change hua:\n' +
      '  • Main ab group ke SABHI users se baat karunga\n' +
      '  • Kisi bhi message ka reply dunga — commands ke bina bhi\n' +
      '  • Tag, mention, aur replies par bhi respond karunga\n' +
      '  • Ek normal group member ki tarah behave karunga\n\n' +
      '🔒 Band karne ke liye /unfriendly use karo.',
      threadID, messageID
    );
  }
};
