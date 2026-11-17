"use strict";
// What each card type is for and which options it needs (read from ha_cards.py).
// field kinds: entity (picker), text, select (options), modes (checkbox group), font.
(root => {
  const NAV = [{key: "key", label: "Navigation key", kind: "text"}];
  const LIST = {entityList: true};
  const info = {
    cardEntities: {label: "Entities", summary: "A list of up to six things: lights, switches, fans, blinds and sensors. Toggle them or read their values.", fields: NAV, ...LIST},
    cardGrid: {label: "Grid", summary: "Big icon buttons, six at a time. Best for quick on and off.",
      fields: [...NAV, {key: "font", label: "Button size", kind: "font", options: ["small", "medium-icon", "medium", "large"]}], ...LIST},
    cardThermo: {label: "Thermostat", summary: "Current and target temperature with up and down buttons and heating modes.",
      fields: [{key: "entity", label: "Thermostat", kind: "entity"},
        {key: "supported_modes", label: "Modes to show", kind: "modes", options: ["off", "heat", "cool", "auto", "heat_cool", "dry", "fan_only"]}, ...NAV]},
    cardMedia: {label: "Media", summary: "Now playing, with play and pause, skip, volume and power.",
      fields: [{key: "entity", label: "Media player", kind: "entity"}, ...NAV], entityList: true, listLabel: "Extra buttons"},
    cardAlarm: {label: "Alarm", summary: "Arm and disarm your alarm panel from a keypad.",
      fields: [{key: "entity", label: "Alarm panel", kind: "entity"},
        {key: "supported_modes", label: "Arm modes to show", kind: "modes", options: ["arm_home", "arm_away", "arm_night", "arm_vacation"]}, ...NAV]},
    cardUnlock: {label: "Unlock", summary: "Enter a PIN on a keypad to unlock a lock.",
      fields: [{key: "destination", label: "Lock", kind: "entity"}, ...NAV]},
    cardPower: {label: "Power", summary: "Energy flow between the grid, solar, your home and a battery.",
      fields: NAV, ...LIST},
    cardQR: {label: "QR code", summary: "Shows a QR code, for example your guest Wi-Fi.",
      fields: [{key: "qrCode", label: "QR code text or link", kind: "text"}, ...NAV], entityList: true, listLabel: "Lines under the code"},
  };
  if (typeof module !== "undefined" && module.exports) module.exports = info; else root.CARD_INFO = info;
})(typeof window !== "undefined" ? window : globalThis);
