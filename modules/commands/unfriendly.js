/**
 * /unfriendly — Enable Unfriendly Admin Mode  (or disable Friendly Mode)
 *
 * Two-stage behaviour depending on what is currently active:
 *
 * Stage A — Friendly Mode is ON → disable it, return to default (normal).
 * Stage B — Default or already in Admin Mode → enable Unfriendly Admin Mode:
 *   • Admin / Owner  : full interaction, no restrictions at all.
 *   • Everyone else  : completely silenced — no replies, no reactions.
 *
 * Only ADMIN / OWNER can run this command.
 */

const fs = require('fs');

module.exports = {
  config: {
    name: 'unfriendly',
    aliases: ['unfriendlymode', 'adminmode', 'strictmode'],
    description: 'Unfriendly Admin Mode — only admin gets bot interaction; others silenced',
    usage: '{prefix}unfriendly',
    credit: 'Virat Bot',
    hasPrefix: true,
    permission: 'ADMIN',
    cooldown: 3,
    category: 'ADMIN'
  },

  run: async function ({ api, message }) {
    const { threadID, messageID, senderID } = message;

    // ── Permission guard ───────────────────────────────────────────────────────
    const isOwner = String(senderID) === String(global.config?.ownerID);
    const isAdmin = Array.isArray(global.config?.adminIDs) &&
                    global.config.adminIDs.includes(String(senderID));
    if (!isOwner && !isAdmin) {
      return api.sendMessage(
        '🚫 Sirf admin ya owner hi yeh mode toggle kar sakta hai.',
        threadID, messageID
      );
    }

    const fm  = global.config.friendlyMode        || {};
    const uam = global.config.unfriendlyAdminMode  || {};

    // ── Stage A: turn OFF friendly mode (back to default) ────────────────────
    if (fm.enabled) {
      global.config.friendlyMode.enabled = false;
      delete global.config.friendlyMode.enabledBy;
      delete global.config.friendlyMode.enabledAt;

      if (!global.config.unfriendlyAdminMode) global.config.unfriendlyAdminMode = {};
      global.config.unfriendlyAdminMode.enabled = false;

      _saveConfig();
      global.logger?.system(`Friendly Mode disabled by ${senderID}`);

      return api.sendMessage(
        '🔄 Friendly Mode OFF — Normal Mode ON!\n\n' +
        '• Ab main sirf commands par respond karunga.\n' +
        '• Sirf mention/tag/reply-to-bot par respond karunga.\n\n' +
        '🔒 Strict Admin Mode ke liye /unfriendly dobara run karo.',
        threadID, messageID
      );
    }

    // ── Stage B: already in default/normal → enable Unfriendly Admin Mode ────
    if (uam.enabled) {
      return api.sendMessage(
        '🔒 Unfriendly Admin Mode pehle se ON hai.\n\n' +
        '• Sirf admin/owner ke saath interact kar raha hun.\n' +
        '• Baki sab ke liye silent hun.\n\n' +
        'Wapas normal mode ke liye phir /unfriendly use karo, ya\n' +
        'Friendly Mode ke liye /friendly use karo.',
        threadID, messageID
      );
    }

    // Activate Unfriendly Admin Mode
    if (!global.config.unfriendlyAdminMode) global.config.unfriendlyAdminMode = {};
    global.config.unfriendlyAdminMode.enabled   = true;
    global.config.unfriendlyAdminMode.enabledBy = senderID;
    global.config.unfriendlyAdminMode.enabledAt = new Date().toISOString();

    // Friendly Mode must be off — they are mutually exclusive
    if (!global.config.friendlyMode) global.config.friendlyMode = {};
    global.config.friendlyMode.enabled = false;

    _saveConfig();
    global.logger?.system(`🔒 Unfriendly Admin Mode ON — enabled by ${senderID}`);

    return api.sendMessage(
      '🔒 Unfriendly Admin Mode ON!\n\n' +
      '👑 Admin ke liye:\n' +
      '  • Har message par respond karunga\n' +
      '  • Bina command ke bhi baat kar sakta hai\n' +
      '  • Sabhi instructions follow karunga\n\n' +
      '🔇 Baaki sabke liye:\n' +
      '  • Koi response nahi — completely silent\n' +
      '  • Commands bhi ignore honge\n' +
      '  • Koi mention/tag/reply bhi kaam nahi karega\n\n' +
      'Wapas aane ke liye /unfriendly (normal) ya /friendly use karo.',
      threadID, messageID
    );
  }
};

function _saveConfig() {
  try {
    fs.writeFileSync('./config.json', JSON.stringify(global.config, null, 2));
  } catch (err) {
    global.logger?.error('unfriendly: config save failed:', err.message);
  }
}
