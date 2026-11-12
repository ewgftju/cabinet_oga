const symbols = {
  folders: '<path d="M3 9V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2M3 10h18l-2 9H5z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  inbox: '<path d="m3 14 3-9h12l3 9v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 14h5l2 3h4l2-3h5"/>',
  building: '<path d="M3 20h18M5 20V6l9-3v17m0-12h5v12M8 8h2m-2 4h2m-2 4h2m7-4h.1m-.1 4h.1"/>',
  city: '<path d="M2 21h20M4 21V8l9-5v18m0-11h6v11M7.5 10h2m-2 4h2m-2 3h2m6-4h1m-1 3h1"/>',
  menu: '<path d="M3 5h18M3 12h18M3 19h18"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  external: '<path d="M8 5H5v14h14v-4M13 4h7v7M20 4l-9 9"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.3"/><path d="m15.5 15.5 4.5 4.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l3.5 2"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-7"/>',
  file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h5"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0z"/><circle cx="12" cy="10" r="2"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M4 20a8 8 0 0 1 16 0"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  close: '<path d="m5 5 14 14m0-14L5 19"/>',
  reply: '<path d="m9 5-6 6 6 6m-5-6h9a7 7 0 0 1 7 7"/>',
  sliders: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  active: '<path d="M2 12h5l3-7 4 14 3-7h5"/>',
  bell: '<path d="M5 17h14l-2-3v-3a5 5 0 0 0-10 0v3zm5 3h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.1"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
};
export function icon(name, size = 18) {
  return '<svg width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (symbols[name] || "") + '</svg>';
}
