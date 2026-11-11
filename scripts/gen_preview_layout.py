#!/usr/bin/env python3
"""Generate the editor preview's layout JSON from the HMI project text exports.

Reads HMI/US/portrait/n2t-out-visual/*.txt (Nextion editor exports, 320x480
portrait) and writes the add-on's frontend/layouts/us-p.json. Run it again
whenever the HMI sources change; tests/test_preview_layout.py fails if the
committed JSON drifts from the sources.
"""
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HMI = ROOT / 'HMI/US/portrait/n2t-out-visual'
OUTPUT = ROOT / 'nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager/frontend/layouts/us-p.json'
PAGES = ['cardEntities', 'cardGrid', 'cardGrid2', 'screensaver', 'screensaver2', 'screensaver3']
SCREEN = {'width': 320, 'height': 480}

VISUAL = {'Text', 'Button', 'Picture', 'Number', 'Slider', 'Hotspot', 'Crop', 'Gauge',
          'Progress', 'Dual-state', 'Scrolling', 'Waveform', 'QR', 'Xfloat', 'Checkbox', 'Radio'}
KEYS = {'x coordinate': ('x', int), 'y coordinate': ('y', int), 'Width': ('w', int),
        'Height': ('h', int), 'Font ID': ('font', int), 'Font Color': ('pco', int),
        'Back. Color': ('bco', int), 'Horizontal Alignment': ('xcen', str),
        'Vertical Alignment': ('ycen', str), 'Fill': ('fill', str),
        'Word wrap': ('wrap', lambda value: value == 'enabled')}


def parse_page(text):
    """Parse one exported page into {name, width, height, bco, components}."""
    page = {'name': None, 'width': SCREEN['width'], 'height': SCREEN['height'], 'components': []}
    current = None
    in_attributes = False
    for line in text.splitlines():
        header = re.match(r'^(\S[^\n]*?)\s+(\S+)\s*$', line) if line and not line[0].isspace() else None
        if header:
            kind_part = header.group(1)
            kind = kind_part.split(' ')[0]
            name = header.group(2)
            in_attributes = False
            if kind == 'Page':
                page['name'] = name
                current = page
            elif kind in VISUAL:
                current = {'name': name, 'type': kind}
                page['components'].append(current)
            else:
                current = None  # variables, timers, ... have no pixels
            continue
        stripped = line.strip()
        if stripped == 'Attributes':
            in_attributes = True
            continue
        if stripped in ('Events',):
            in_attributes = False
            continue
        if not in_attributes or current is None or ':' not in line:
            continue
        key, _, value = line.partition(':')
        key, value = key.strip(), value.strip()
        if key == 'Width' and current is page:
            page['width'] = int(value)
        elif key == 'Back. Color' and current is page:
            page['bco'] = int(value)
        elif current is not page and key in KEYS:
            field, cast = KEYS[key]
            current[field] = cast(value)
    return page


def parse_bindings(script, instruction):
    """Which command field feeds which component, read from the page's message handler.

    ``script`` is the page text from HMI/.../n2t-out (it contains the Nextion event code).
    Returns [{"comp", "attr": "txt" | "pco", "field"}] for the ``if(tInstruction.txt=="<instruction>"``
    block: ``spstr strCommand.txt,<comp>.txt,"~",N`` copies field N into the text and
    ``covx tTmp.txt,<comp>.pco`` after ``spstr ...tTmp.txt,"~",N`` copies field N into the colour.
    """
    lines = script.splitlines()
    start = next((i for i, line in enumerate(lines)
                  if re.search(rf'tInstruction\.txt=="{re.escape(instruction)}"', line)), None)
    if start is None:
        return []
    depth, seen_open, bindings, tmp_field = 0, False, [], None
    for line in lines[start:]:
        depth += line.count('{') - line.count('}')
        seen_open = seen_open or '{' in line
        found = re.search(r'spstr strCommand\.txt,(\w+)\.txt,"~",(\d+)', line)
        if found and found.group(1) == 'tTmp':
            tmp_field = int(found.group(2))
        elif found:
            bindings.append({'comp': found.group(1), 'attr': 'txt', 'field': int(found.group(2))})
        color = re.search(r'covx tTmp\.txt,(\w+)\.pco,0,0', line)
        if color and tmp_field is not None:
            bindings.append({'comp': color.group(1), 'attr': 'pco', 'field': tmp_field})
        if seen_open and depth <= 0:
            break
    return bindings


def build_layout(hmi_dir):
    hmi_dir = Path(hmi_dir)
    scripts = hmi_dir.parent / 'n2t-out'
    pages = {}
    for name in PAGES:
        source = hmi_dir / f'{name}.txt'
        if source.is_file():
            pages[name] = parse_page(source.read_text(encoding='utf-8', errors='replace'))
            script = scripts / f'{name}.txt'
            if name.startswith('screensaver') and script.is_file():
                text = script.read_text(encoding='utf-8', errors='replace')
                pages[name]['bindings'] = {kind: parse_bindings(text, kind)
                                           for kind in ('weatherUpdate', 'statusUpdate')}
    return {'us-p': pages}


if __name__ == '__main__':
    hmi = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_HMI
    layout = build_layout(hmi)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(layout, indent=1, sort_keys=True) + '\n')
    print(f'wrote {OUTPUT}')
