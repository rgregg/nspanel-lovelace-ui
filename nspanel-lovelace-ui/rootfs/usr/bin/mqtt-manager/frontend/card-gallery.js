"use strict";
// "Choose a card type" dialog. Cards the preview can draw (entities, grid) show a thumbnail rendered by the
// add-on from sample data; the other card types show a drawn sketch of their screen.
(() => {
  const SCALE = 0.42, WIDTH = 320, HEIGHT = 480;
  let thumbnails = null;

  function at(parent, cls, x, y, w, h, text) {
    const node = element("div", text, `sk ${cls}`);
    Object.assign(node.style, {left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`});
    parent.append(node); return node;
  }
  function icon(parent, name, x, y, size, color) {
    const node = at(parent, "sk-icon mdi mdi-" + name, x, y, size, size);
    node.style.fontSize = `${size}px`; if (color) node.style.color = color; return node;
  }
  function keypad(screen, top) {
    "123456789*0#".split("").forEach((key, i) => at(screen, "sk-key", 30 + (i % 3) * 90, top + Math.floor(i / 3) * 62, 80, 54, key));
  }
  const SKETCHES = {
    // Used only when the add-on could not render a real thumbnail.
    cardEntities(s) {
      at(s, "sk-title", 0, 20, 320, 40, "Entities");
      ["lightbulb", "fan", "blinds", "thermometer"].forEach((name, i) => { icon(s, name, 24, 90 + i * 84, 44); at(s, "sk-line", 84, 90 + i * 84, 150, 44, "Name"); at(s, "sk-bar", 240, 106 + i * 84, 56, 12); });
    },
    cardGrid(s) {
      at(s, "sk-title", 0, 20, 320, 40, "Grid");
      ["lightbulb", "fan", "blinds", "power-plug", "television", "lock"].forEach((name, i) => icon(s, name, 40 + (i % 2) * 140, 90 + Math.floor(i / 2) * 120, 80));
    },
    cardThermo(s) {
      at(s, "sk-title", 0, 20, 320, 40, "Thermostat");
      at(s, "sk-big", 0, 90, 320, 100, "21.5°");
      icon(s, "minus-circle-outline", 40, 220, 64); at(s, "sk-big sk-mid", 110, 220, 100, 64, "22°"); icon(s, "plus-circle-outline", 216, 220, 64);
      ["fire", "snowflake", "thermostat-auto", "power"].forEach((name, i) => icon(s, name, 28 + i * 70, 350, 44, i === 0 ? "#ff9800" : null));
    },
    cardMedia(s) {
      at(s, "sk-title", 0, 20, 320, 40, "Living room");
      icon(s, "music", 90, 80, 140, "#6ab7ff");
      at(s, "sk-line", 0, 240, 320, 34, "Song title"); at(s, "sk-line sk-dim", 0, 276, 320, 30, "Artist");
      icon(s, "skip-previous", 50, 330, 56); icon(s, "pause", 132, 322, 72); icon(s, "skip-next", 220, 330, 56);
      at(s, "sk-bar", 30, 430, 260, 8);
    },
    cardAlarm(s) {
      icon(s, "shield-home", 124, 20, 72, "#0da035"); at(s, "sk-title", 0, 100, 320, 36, "Disarmed");
      keypad(s, 160); at(s, "sk-key sk-wide", 30, 410, 260, 44, "Arm away");
    },
    cardUnlock(s) {
      icon(s, "lock", 124, 20, 72, "#ff0000"); at(s, "sk-title", 0, 100, 320, 36, "Front door");
      keypad(s, 160); at(s, "sk-key sk-wide", 30, 410, 260, 44, "Unlock");
    },
    cardPower(s) {
      at(s, "sk-title", 0, 20, 320, 40, "Energy");
      at(s, "sk-link", 158, 140, 4, 80); at(s, "sk-link", 158, 260, 4, 80); at(s, "sk-link", 80, 238, 70, 4); at(s, "sk-link", 170, 238, 70, 4);
      icon(s, "solar-power", 128, 80, 64, "#ffc107"); icon(s, "home", 128, 206, 64); icon(s, "transmission-tower", 16, 206, 64); icon(s, "battery-70", 128, 346, 64, "#2f9e6f");
    },
    cardQR(s) {
      at(s, "sk-title", 0, 20, 320, 40, "Guest Wi-Fi");
      const code = at(s, "sk-qr", 50, 80, 220, 220);
      for (let i = 0; i < 169; i++) { const x = i % 13, y = Math.floor(i / 13), corner = (x < 4 && y < 4) || (x > 8 && y < 4) || (x < 4 && y > 8); code.append(element("i", undefined, corner || (x * 7 + y * 13 + x * y) % 3 === 0 ? "on" : "")); }
      at(s, "sk-line", 0, 330, 320, 34, "Scan to join"); at(s, "sk-line sk-dim", 0, 368, 320, 30, "Password: ****");
    },
  };
  function sketch(type) {
    const screen = element("div", undefined, "pv-screen sk-screen");
    SKETCHES[type]?.(screen);
    return screen;
  }
  function framed(screen) {
    const frame = element("div", undefined, "thumb");
    Object.assign(frame.style, {width: `${WIDTH * SCALE}px`, height: `${HEIGHT * SCALE}px`});
    Object.assign(screen.style, {transform: `scale(${SCALE})`, transformOrigin: "top left"});
    frame.append(screen); return frame;
  }
  async function loadThumbnails() {
    if (thumbnails) return thumbnails;
    try {
      const [data, layout] = await Promise.all([api("thumbnails"), NSPreview.loadLayout()]);
      thumbnails = {};
      for (const [type, entry] of Object.entries(data.thumbnails || {})) {
        if (!entry.commands?.length || entry.errors?.length) continue;
        thumbnails[type] = NSPreview.drawCard(layout, {type, commands: entry.commands},
          {icons: entry.icons || {}, time: "", date: ""});
      }
    } catch (error) { thumbnails = {}; }  // no thumbnails: tiles fall back to a sketch
    return thumbnails;
  }
  async function choose(currentType) {
    const dialog = $("card-gallery"), grid = $("gallery-grid");
    grid.replaceChildren(); grid.append(element("p", "Loading card types..."));
    return new Promise(resolve => {
      let finished = false;
      const done = value => { if (finished) return; finished = true; if (dialog.open) dialog.close(); resolve(value); };
      // Escape and Cancel work from the first moment, even while thumbnails are still loading.
      dialog.onclose = () => done(null);
      $("gallery-cancel").onclick = () => done(null);
      dialog.showModal();
      loadThumbnails().then(real => {
        if (finished) return;
        grid.replaceChildren();
        for (const [type, info] of Object.entries(window.CARD_INFO)) {
          const tile = element("button", undefined, "gallery-tile");
          tile.type = "button"; tile.setAttribute("aria-pressed", String(type === currentType));
          tile.append(framed(real[type]?.cloneNode(true) || sketch(type)), element("strong", info.label), element("span", info.summary));
          tile.onclick = () => done(type);
          grid.append(tile);
        }
      });
    });
  }
  window.CardGallery = {choose};
})();
